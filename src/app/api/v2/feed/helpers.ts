import * as sql from 'mssql';
import { HiveSQL_Database } from "@/lib/hivesql_database";

// Updated Comment interface to include optional vote fields for HAFSQL compatibility
export interface Comment {
  id: number;
  author: string;
  permlink: string;
  parent_author: string;
  parent_permlink: string;
  title: string;
  body: string;
  post_json_metadata: string;
  created: Date;
  last_edited: null;
  cashout_time: null;
  remaining_till_cashout: null;
  last_payout: Date;
  tags: null;
  category: string;
  root_author: null;
  root_permlink: null;
  pending_payout_value: string;
  author_rewards: string;
  author_rewards_in_hive: null;
  total_payout_value: string;
  curator_payout_value: string;
  beneficiary_payout_value: null;
  total_rshares: null;
  net_rshares: null;
  total_vote_weight: null;
  max_accepted_payout: string;
  percent_hbd: number;
  allow_votes: boolean;
  allow_curation_rewards: boolean;
  deleted: number;
  beneficiaries: string;
  url: string;
  user_json_metadata: string | null;
  reputation: null;
  followers: null;
  followings: null;
  votes: {
    id: number;
    timestamp: string;
    voter: string;
    weight: number;
    rshares?: number;
    total_vote_weight?: number;
    pending_payout?: number;
    pending_payout_symbol?: string;
  }[];
  is_soft_post?: boolean;
  soft_post_author?: string;
  soft_post_display_name?: string;
  soft_post_avatar?: string;
}

// Normalize votes from HAFSQL (Postgres)
export function normalizeHafVotes(votes: any[]) {
  if (!Array.isArray(votes)) return [];
  return votes
    .map(v => ({
      id: v.id,
      voter: v.voter,
      weight: Number(v.weight),
      timestamp: v.timestamp,
      rshares: Number(v.rshares),
      total_vote_weight: Number(v.total_vote_weight),
      pending_payout: Number(v.pending_payout || 0),
      pending_payout_symbol: v.pending_payout_symbol,
    }))
    .sort((a, b) => a.voter.localeCompare(b.voter));
}

// Normalize votes from HiveSQL (MSSQL)
export function normalizeHiveVotes(votesString: string): any[] {
  try {
    const parsed = JSON.parse(votesString);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(v => ({
        id: v.id,
        voter: v.voter,
        weight: Number(v.weight),
        timestamp: v.timestamp,
        rshares: Number(v.rshares || 0),
        total_vote_weight: Number(v.total_vote_weight || 0),
        pending_payout: Number(v.pending_payout || 0),
        pending_payout_symbol: v.pending_payout_symbol || null,
      }))
      .sort((a, b) => a.voter.localeCompare(b.voter));
  } catch (e) {
    console.warn('Failed to parse HiveSQL votes:', e);
    return [];
  }
}

// Normalize a post for comparison and frontend
export function normalizePost(post: any, source: 'haf' | 'hive'): Comment {
  return {
    id: post.id || 0,
    author: post.author,
    permlink: post.permlink,
    parent_author: post.parent_author || '',
    parent_permlink: post.parent_permlink,
    title: post.title || '',
    body: (post.body || '').trim(),
    post_json_metadata: post.post_json_metadata || '{}',
    created: new Date(post.created),
    last_edited: null,
    cashout_time: null,
    remaining_till_cashout: null,
    last_payout: post.last_payout ? new Date(post.last_payout) : new Date(),
    tags: null,
    category: post.category || '',
    root_author: null,
    root_permlink: null,
    pending_payout_value: String(post.pending_payout_value || '0'),
    author_rewards: String(post.author_rewards || '0'),
    author_rewards_in_hive: null,
    total_payout_value: String(post.total_payout_value || '0'),
    curator_payout_value: String(post.curator_payout_value || '0'),
    beneficiary_payout_value: null,
    total_rshares: null,
    net_rshares: null,
    total_vote_weight: null,
    max_accepted_payout: post.max_accepted_payout ? String(post.max_accepted_payout) : '0.0',
    percent_hbd: Number(post.percent_hbd || 0),
    allow_votes: Boolean(post.allow_votes),
    allow_curation_rewards: Boolean(post.allow_curation_rewards),
    deleted: Number(post.deleted || 0),
    beneficiaries: post.beneficiaries || '',
    url: post.url || '',
    user_json_metadata: post.user_json_metadata || null,
    reputation: null,
    followers: null,
    followings: null,
    votes: source === 'haf' ? normalizeHafVotes(post.votes) : normalizeHiveVotes(post.votes),
  };
}

// Compare two normalized posts
export function comparePosts(postA: Comment, postB: Comment) {
  if (
    postA.author !== postB.author ||
    postA.permlink !== postB.permlink ||
    postA.parent_permlink !== postB.parent_permlink ||
    postA.created.toISOString() !== postB.created.toISOString() ||
    postA.body !== postB.body ||
    postA.pending_payout_value !== postB.pending_payout_value
  ) {
    return false;
  }
  if (postA.votes.length !== postB.votes.length) return false;
  for (let i = 0; i < postA.votes.length; i++) {
    const va = postA.votes[i];
    const vb = postB.votes[i];
    if (va.voter !== vb.voter || va.weight !== vb.weight) {
      return false;
    }
  }
  return true;
}

// Verbose comparison for debugging
export function comparePostsVerbose(postA: Comment, postB: Comment) {
  const differences: string[] = [];
  if (postA.author !== postB.author)
    differences.push(`author: ${postA.author} !== ${postB.author}`);
  if (postA.permlink !== postB.permlink)
    differences.push(`permlink: ${postA.permlink} !== ${postB.permlink}`);
  if (postA.parent_permlink !== postB.parent_permlink)
    differences.push(`parent_permlink: ${postA.parent_permlink} !== ${postB.parent_permlink}`);
  if (postA.created.toISOString() !== postB.created.toISOString())
    differences.push(`created: ${postA.created.toISOString()} !== ${postB.created.toISOString()}`);
  if (postA.body !== postB.body)
    differences.push(`body: ${postA.body} !== ${postB.body}`);
  if (postA.pending_payout_value !== postB.pending_payout_value)
    differences.push(`pending_payout_value: ${postA.pending_payout_value} !== ${postB.pending_payout_value}`);
  if (postA.votes.length !== postB.votes.length) {
    differences.push(`votes.length: ${postA.votes.length} !== ${postB.votes.length}`);
  } else {
    for (let i = 0; i < postA.votes.length; i++) {
      const va = postA.votes[i];
      const vb = postB.votes[i];
      if (va.voter !== vb.voter) {
        differences.push(`votes[${i}].voter: ${va.voter} !== ${vb.voter}`);
      }
      if (va.weight !== vb.weight) {
        differences.push(`votes[${i}].weight: ${va.weight} !== ${vb.weight}`);
      }
    }
  }
  if (differences.length > 0) {
    console.log(`❌ Post mismatch: ${postA.author}/${postA.permlink}`);
    differences.forEach(diff => console.log(` - ${diff}`));
    return false;
  }
  return true;
}

export async function fetchComments(
  db: HiveSQL_Database,
  limit: number,
  offset: number,
  community: string,
  parentPermlink: string
): Promise<Comment[]> {
  const query = `
    SELECT
        c.ID AS id,
        c.author,
        c.permlink,
        c.parent_author,
        c.parent_permlink,
        c.title,
        c.body,
        c.json_metadata AS post_json_metadata,
        c.created,
        NULL AS last_edited,
        NULL AS cashout_time,
        NULL AS remaining_till_cashout,
        c.last_payout,
        NULL AS tags,
        c.category,
        NULL AS root_author,
        NULL AS root_permlink,
        CAST(c.pending_payout_value AS NVARCHAR) AS pending_payout_value,
        CAST(c.author_rewards AS NVARCHAR) AS author_rewards,
        NULL AS author_rewards_in_hive,
        CAST(c.total_payout_value AS NVARCHAR) AS total_payout_value,
        CAST(c.curator_payout_value AS NVARCHAR) AS curator_payout_value,
        NULL AS beneficiary_payout_value,
        NULL AS total_rshares,
        NULL AS net_rshares,
        NULL AS total_vote_weight,
        CAST(c.max_accepted_payout AS NVARCHAR) + '.0' AS max_accepted_payout,
        c.percent_hbd,
        c.allow_votes,
        c.allow_curation_rewards,
        0 AS deleted,
        c.beneficiaries,
        c.url
    FROM DBHive.dbo.Comments c
    WHERE 
        (
            (
                c.parent_permlink LIKE 'snap-container-%'
                AND ISJSON(c.json_metadata) = 1
                AND EXISTS (
                    SELECT 1
                    FROM OPENJSON(c.json_metadata, '$.tags') WITH (tag NVARCHAR(MAX) '$')
                    WHERE tag = @community
                )
            )
            OR c.parent_permlink = @parent_permlink
        )
    ORDER BY c.created DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;
  `;

  const { recordset } = await db.executeQuery(query, [
    { name: 'limit', type: sql.Int, value: limit },
    { name: 'offset', type: sql.Int, value: offset },
    { name: 'community', type: sql.NVarChar, value: community },
    { name: 'parent_permlink', type: sql.NVarChar, value: parentPermlink },
  ]);

  return recordset;
}

export async function fetchAccounts(db: HiveSQL_Database, authors: string[]): Promise<{ author: string; user_json_metadata: string }[]> {
  if (!authors.length) return [];

  const query = `
    SELECT 
        a.name AS author,
        a.json_metadata AS user_json_metadata
    FROM DBHive.dbo.Accounts a
    WHERE a.name IN (${authors.map((_, i) => `@author${i}`).join(',')})
  `;

  const inputs = authors.map((author, i) => ({
    name: `author${i}`,
    type: sql.NVarChar,
    value: author,
  }));

  const { recordset } = await db.executeQuery(query, inputs);
  return recordset;
}

export async function fetchVotes(
  db: HiveSQL_Database,
  authorPermlinks: { author: string; permlink: string }[]
): Promise<{ author: string; permlink: string; votes: string }[]> {
  if (!authorPermlinks.length) return [];

  const query = `
    SELECT 
        v.author,
        v.permlink,
        ISNULL(
          (
            SELECT 
                v2.id AS id,
                FORMAT(v2.[timestamp], 'yyyy-MM-ddTHH:mm:ss') AS [timestamp],
                v2.voter AS voter,
                v2.weight AS weight
                -- v2.rshares AS rshares,
                -- v2.total_vote_weight AS total_vote_weight,
                -- v2.pending_payout AS pending_payout,
                -- v2.pending_payout_symbol AS pending_payout_symbol
            FROM DBHive.dbo.TxVotes v2
            WHERE v2.author = v.author AND v2.permlink = v.permlink
            FOR JSON PATH
          ), '[]'
        ) AS votes
    FROM DBHive.dbo.TxVotes v
    WHERE v.author IN (${authorPermlinks.map((_, i) => `@author${i}`).join(',')})
        AND v.permlink IN (${authorPermlinks.map((_, i) => `@permlink${i}`).join(',')})
    GROUP BY v.author, v.permlink;
  `;

  const inputs = authorPermlinks.flatMap((ap, i) => [
    { name: `author${i}`, type: sql.NVarChar, value: ap.author },
    { name: `permlink${i}`, type: sql.NVarChar, value: ap.permlink },
  ]);

  const { recordset } = await db.executeQuery(query, inputs);
  return recordset; // Keep votes as a JSON string
}
