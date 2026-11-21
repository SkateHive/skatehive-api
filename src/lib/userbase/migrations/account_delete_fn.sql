-- Account deletion (App Store guideline 5.1.1(v)) for
-- DELETE /api/userbase/account (src/app/api/userbase/account/route.ts).
--
-- NOT applied. The owner applies it to the production Supabase project (SQL
-- editor, as postgres). Safe to run more than once. Until it is applied the
-- route answers 503 (function missing), never a partial delete.
--
-- Owner decision (2026-11-20): hard delete, no tombstone, including the
-- user's partner-app posts with their events and outbox.
--
-- Why a function and not deletes from the route: supabase-js has no
-- transactions. Everything below commits or rolls back as one unit, so an
-- account can never end up half deleted.
--
-- What a plain `delete from userbase_users` gets wrong today:
--   1. userbase_app_posts.user_id is ON DELETE RESTRICT (0038), and its
--      events/outbox are RESTRICT to the post. Anyone with an app post fails.
--   2. userbase_sponsorships.sponsor_user_id is NOT NULL but ON DELETE SET NULL
--      (0015). Deleting anyone who sponsored an account fails. Fixed below.
--   3. userbase_app_post_events is append-only by trigger. Fixed below with a
--      narrow exception that only this function can use.
--   4. Rows keyed by email instead of user_id (OTP codes, received invites)
--      have no FK and would survive.
-- Everything else tied to the user goes by ON DELETE CASCADE: auth_methods,
-- sessions, app_sessions, identities, hive_keys (custodied Hive keys),
-- community/app memberships, app moderators, notifications, soft posts/votes,
-- scheduled posts, whatsapp links/codes/posts, invites sent, identity
-- challenges, magic links, sponsorships of the user (as lite account).
-- SET NULL (kept, unlinked): merge audit, invites received by user_id, and
-- reviewed_by on other people's posts (the post guard allows that case).
--
-- Optional tables (instagram, crosspost, invites, app posts) are guarded with
-- to_regclass, so this applies whatever has been migrated in production.
--
-- Before applying, check that the owner role bypasses RLS (the 0038 tables use
-- FORCE ROW LEVEL SECURITY):  select rolbypassrls from pg_roles where rolname = 'postgres';
-- If it is false, the app-post deletes match no rows, the RESTRICT FK fires,
-- and the whole call rolls back (503, nothing deleted). It fails safe, but users
-- with app posts could not be deleted until that is fixed.

-- 2. Sponsor deleted -> keep the sponsorship row, drop the link (as the column
-- comment in 0015 already says).
alter table public.userbase_sponsorships
  alter column sponsor_user_id drop not null;

-- 3. Append-only stays append-only, except while userbase_account_delete() is
-- erasing that user's own posts. The setting is transaction-local and set only
-- inside the function; service_role has no DELETE grant on the events table
-- anyway, so nothing else can reach this branch.
create or replace function public.userbase_app__append_only()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_erase text := current_setting('userbase.erase_user_id', true);
begin
  if tg_op = 'DELETE' and tg_table_name = 'userbase_app_post_events'
     and coalesce(v_erase, '') <> ''
     and exists (select 1 from public.userbase_app_posts p
                 where p.id = old.post_id and p.user_id = v_erase::uuid) then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'UB409';
end;
$$;

-- Returns true when the user was deleted, false when no such user exists.
-- Raises on any failure, which rolls everything back.
create or replace function public.userbase_account_delete(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emails text[];
begin
  if p_user_id is null then
    return false;
  end if;

  -- Lock the row: a concurrent login or delete for the same user waits here.
  perform 1 from public.userbase_users where id = p_user_id for update;
  if not found then
    return false;
  end if;

  select coalesce(array_agg(distinct lower(btrim(identifier))), '{}')
    into v_emails
    from public.userbase_auth_methods
    where user_id = p_user_id and type = 'email_magic' and identifier is not null;

  -- 1 + 3. Partner-app posts, their events and outbox (RESTRICT FKs).
  if to_regclass('public.userbase_app_posts') is not null then
    perform set_config('userbase.erase_user_id', p_user_id::text, true);
    delete from public.userbase_app_post_outbox o
      using public.userbase_app_posts p
      where o.post_id = p.id and p.user_id = p_user_id;
    delete from public.userbase_app_post_events e
      using public.userbase_app_posts p
      where e.post_id = p.id and p.user_id = p_user_id;
    delete from public.userbase_app_posts where user_id = p_user_id;
    perform set_config('userbase.erase_user_id', '', true);
  end if;

  -- Content of the user's posts queued or kept for Instagram crossposting
  -- (FKs are SET NULL, which would keep the content).
  if to_regclass('public.userbase_crosspost_queue') is not null then
    delete from public.userbase_crosspost_queue where user_id = p_user_id;
  end if;
  if to_regclass('public.userbase_instagram_posts') is not null then
    delete from public.userbase_instagram_posts where user_id = p_user_id;
  end if;

  -- 4. Rows keyed by email.
  if cardinality(v_emails) > 0 then
    delete from public.userbase_email_otps where lower(email) = any (v_emails);
    if to_regclass('public.userbase_invites') is not null then
      delete from public.userbase_invites where lower(invitee_email) = any (v_emails);
    end if;
  end if;

  -- The user and everything that cascades from it, sessions included.
  delete from public.userbase_users where id = p_user_id;
  return true;
end;
$$;

revoke all on function public.userbase_account_delete(uuid) from public, anon, authenticated;
grant execute on function public.userbase_account_delete(uuid) to service_role;

-- Check after applying (should return false, deletes nothing):
--   select public.userbase_account_delete('00000000-0000-0000-0000-000000000000');
