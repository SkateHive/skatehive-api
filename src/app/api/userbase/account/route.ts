import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/utils/supabase/supabaseClient";
import { getBearerUserId } from "@/lib/userbase/session";
import { authenticateAppClient } from "@/lib/userbase/appClient";

export const runtime = "nodejs";

// Account deletion (App Store guideline 5.1.1(v)).
//
//   DELETE /api/userbase/account
//   Authorization: Bearer <first-party userbase session token>
//   {"confirm":"DELETE"}
//
// 200 {success:true}  user and everything tied to it deleted, every session
//                     gone (cascade). A repeat call then gets 401.
// 400                 body is not {"confirm":"DELETE"}
// 401                 no valid session. The account may still exist: clients
//                     must sign in again, never treat this as deleted.
// 403                 partner-app credentials: a partner can never delete an
//                     account on the shared userbase.
// 503 / 500           nothing was deleted (the delete is one transaction).
//
// Bearer only, never the web cookie, so a cross-site request can't trigger it.
// Posts already on the Hive blockchain are not (and cannot be) touched.
// The work is done by public.userbase_account_delete (see
// src/lib/userbase/migrations/account_delete_fn.sql).

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status });

export async function DELETE(req: NextRequest) {
  if (authenticateAppClient(req.headers).kind !== "none") {
    return json(403, { success: false, error: "Account deletion is only available in Skatehive apps" });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || (body as { confirm?: unknown }).confirm !== "DELETE") {
    return json(400, { success: false, error: 'Send {"confirm":"DELETE"} to delete the account' });
  }

  if (!supabaseAdmin) {
    return json(503, { success: false, error: "Userbase backend not configured" });
  }

  const userId = await getBearerUserId(req);
  if (!userId) return json(401, { success: false, error: "Unauthorized" });

  const { data, error } = await supabaseAdmin.rpc("userbase_account_delete", { p_user_id: userId });
  if (error) {
    // Codes only: no user id or email in logs.
    console.error("[userbase/account] delete failed", error.code);
    // Function not applied yet (PostgREST: PGRST202, Postgres: 42883).
    const missing = error.code === "PGRST202" || error.code === "42883";
    return json(missing ? 503 : 500, { success: false, error: "Account deletion failed, nothing was deleted" });
  }
  // false: the user row vanished between session lookup and delete.
  if (data !== true) return json(401, { success: false, error: "Unauthorized" });

  return json(200, { success: true });
}
