import { NextRequest, NextResponse } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';
import { normalizePost, Comment } from './helpers';
import { dealiasSoftPosts } from '@/lib/soft-posts';

const hafDb = new HAFSQL_Database();

// Module-level cache (limited effectiveness in Vercel)
const cache: Map<string, { total?: number; rows?: Comment[]; timestamp: number }> = new Map();
const activeUpdates = new Set<string>(); // Track ongoing background updates
const cacheTTL = 300000; // 5 minutes for main query results
const totalTTL = 60000; // 1 minute for total

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > cacheTTL) {
      cache.delete(key);
    }
  }
}

const DEFAULT_PAGE = Number(process.env.DEFAULT_PAGE) || 1;
const DEFAULT_FEED_LIMIT = Number(process.env.DEFAULT_FEED_LIMIT) || 25;
const PARENT_PERMLINK = process.env.PARENT_PERMLINK || '';

interface FeedData {
  total: number;
  rows: Comment[];
}

async function fetchTotal(
  hafDb: HAFSQL_Database,
  community: string,
  parentPermlink: string,
  author?: string
): Promise<number> {
  const tagFilter = `{"tags": ["${community}"]}`;
  const countLabel = `HAFSQL COUNT Query [${Date.now()}]`;
  console.time(countLabel);

  const query = `
    SELECT COUNT(*) AS total
    FROM comments c
    WHERE
      (
        (
          c.parent_author = 'peak.snaps'
          AND c.parent_permlink LIKE 'snap-container-%'
          AND c.json_metadata @> @tag_filter
        )
        OR c.parent_permlink = @parent_permlink
      )
      ${author ? 'AND c.author = @author' : ''}
      AND c.deleted = false;
  `;

  const totalResult = await hafDb.executeQuery(query, [
    { name: 'tag_filter', value: tagFilter },
    { name: 'parent_permlink', value: parentPermlink },
    ...(author ? [{ name: 'author', value: author }] : []),
  ]);
  console.timeEnd(countLabel);
  return parseInt(totalResult.rows[0].total, 10);
}

async function fetchFeedData(
  hafDb: HAFSQL_Database,
  community: string,
  parentPermlink: string,
  limit: number,
  offset: number,
  author?: string
): Promise<FeedData> {
  const tagFilter = `{"tags": ["${community}"]}`;

  const mainLabel = `HAFSQL Main Query [${Date.now()}]`;
  // Two phases. The old query joined every vote of EVERY snap in the community
  // and grouped by ~30 columns before LIMIT, which grew with the community
  // (~50s and a 500 at ~5.7k snaps). Now the page is picked first from
  // comments alone, and votes / reply count / account are looked up only for
  // the rows on that page. Same columns and aliases as before.
  const query = `
    WITH page AS (
      SELECT
        c.body, c.author, c.permlink, c.parent_author, c.parent_permlink,
        c.created, c.last_edited, c.cashout_time, c.remaining_till_cashout, c.last_payout,
        c.tags, c.category, c.json_metadata, c.root_author, c.root_permlink,
        c.pending_payout_value, c.author_rewards, c.author_rewards_in_hive, c.total_payout_value,
        c.curator_payout_value, c.beneficiary_payout_value, c.total_rshares, c.net_rshares, c.total_vote_weight,
        c.beneficiaries, c.max_accepted_payout, c.percent_hbd, c.allow_votes, c.allow_curation_rewards, c.deleted
      FROM comments c
      WHERE
        (
          (
            c.parent_author = 'peak.snaps'
            AND c.parent_permlink LIKE 'snap-container-%'
            AND c.json_metadata @> @tag_filter
          )
          OR c.parent_permlink = @parent_permlink
        )
        ${author ? 'AND c.author = @author' : ''}
        AND c.deleted = false
      ORDER BY c.created DESC
      LIMIT @limit
      OFFSET @offset
    )
    SELECT
      p.body, p.author, p.permlink, p.parent_author, p.parent_permlink,
      p.created, p.last_edited, p.cashout_time, p.remaining_till_cashout, p.last_payout,
      p.tags, p.category, p.json_metadata AS post_json_metadata, p.root_author, p.root_permlink,
      p.pending_payout_value, p.author_rewards, p.author_rewards_in_hive, p.total_payout_value,
      p.curator_payout_value, p.beneficiary_payout_value, p.total_rshares, p.net_rshares, p.total_vote_weight,
      p.beneficiaries, p.max_accepted_payout, p.percent_hbd, p.allow_votes, p.allow_curation_rewards, p.deleted,
      (
        SELECT COUNT(*)
        FROM comments ch
        WHERE ch.parent_author = p.author
          AND ch.parent_permlink = p.permlink
          AND ch.deleted = false
      ) AS children,
      a.json_metadata AS user_json_metadata, a.reputation, a.followers, a.followings,
      (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'id', v.id,
              'timestamp', v.timestamp,
              'voter', v.voter,
              'weight', v.weight,
              'rshares', v.rshares,
              'total_vote_weight', v.total_vote_weight,
              'pending_payout', v.pending_payout,
              'pending_payout_symbol', v.pending_payout_symbol
            )
          ),
          '[]'
        )
        FROM operation_effective_comment_vote_view v
        WHERE v.author = p.author AND v.permlink = p.permlink
      ) AS votes
    FROM page p
    LEFT JOIN accounts a ON a.name = p.author
    ORDER BY p.created DESC;
  `;

  // The total and the page are independent: run them at the same time.
  const [total, hafRows] = await Promise.all([
    fetchTotal(hafDb, community, parentPermlink, author),
    (async () => {
      console.time(mainLabel);
      try {
        return await hafDb.executeQuery(query, [
          { name: 'tag_filter', value: tagFilter },
          { name: 'parent_permlink', value: parentPermlink },
          { name: 'limit', value: limit },
          { name: 'offset', value: offset },
          ...(author ? [{ name: 'author', value: author }] : []),
        ]);
      } finally {
        console.timeEnd(mainLabel);
      }
    })(),
  ]);

  const rows = hafRows.rows.map(row => normalizePost(row, 'haf'));
  const dealiasedRows = await dealiasSoftPosts(rows);
  return { total, rows: dealiasedRows };
}

async function updateCacheInBackground(
  hafDb: HAFSQL_Database,
  community: string,
  parentPermlink: string,
  limit: number,
  offset: number,
  cacheKey: string,
  author?: string
) {
  if (activeUpdates.has(cacheKey)) {
    console.log('Skipping duplicate background update for:', cacheKey);
    return;
  }
  activeUpdates.add(cacheKey);
  try {
    console.log('Starting background cache update for:', cacheKey);
    const feedData = await fetchFeedData(hafDb, community, parentPermlink, limit, offset, author);
    cache.set(cacheKey, { total: feedData.total, rows: feedData.rows, timestamp: Date.now() });
    console.log('Background cache update completed:', cacheKey);
  } catch (error) {
    console.error('Background cache update failed:', {
      cacheKey,
      error,
      activeConnections: hafDb.getActiveConnections(),
    });
  } finally {
    activeUpdates.delete(cacheKey);
  }
}

export async function GET(request: NextRequest) {
  console.log('Fetching FEED data...');

  const { searchParams } = new URL(request.url);
  const COMMUNITY = searchParams.get('community_code') || process.env.MY_COMMUNITY_CATEGORY || 'hive-173115';
  const author = searchParams.get('author') || undefined;
  const page = Math.max(1, Number(searchParams.get('page')) || DEFAULT_PAGE);
  const limit = Math.max(1, Number(searchParams.get('limit')) || DEFAULT_FEED_LIMIT);
  const offset = (page - 1) * limit;

  let resultsRows: Comment[] = [];
  let total = 0;

  try {
    console.log(`🔗 Active HAFSQL connections: ${hafDb.getActiveConnections()}`);
    cleanupCache();

    const cacheKey = `feed:${COMMUNITY}:${PARENT_PERMLINK}:${author || 'all'}:${page}:${limit}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      resultsRows = cached.rows || [];
      total = cached.total || 0;
      console.log('📁 Using cached rows:', { rowCount: resultsRows.length });
    } else {
      console.log('Cache miss, fetching data synchronously');
      const feedData = await fetchFeedData(hafDb, COMMUNITY, PARENT_PERMLINK, limit, offset, author);
      total = feedData.total;
      resultsRows = feedData.rows;
      cache.set(cacheKey, { total, rows: resultsRows, timestamp: Date.now() });
    }

    // Schedule background cache update
    setTimeout(() => updateCacheInBackground(hafDb, COMMUNITY, PARENT_PERMLINK, limit, offset, cacheKey, author), 0);

    console.log('✅ Returning response to client');
    return NextResponse.json({
      success: true,
      data: resultsRows,
      pagination: {
        currentPage: page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
        nextPage: page * limit < total ? page + 1 : null,
        prevPage: page > 1 ? page - 1 : null,
      },
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=0, must-revalidate', 'CDN-Cache-Control': 's-maxage=300, stale-while-revalidate=150', 'Vercel-CDN-Cache-Control': 's-maxage=300, stale-while-revalidate=150',
      },
    });

  } catch (hafError) {
    console.error('⚠️ Failed to fetch data from HAFSQL:', {
      error: hafError,
      activeConnections: hafDb.getActiveConnections(),
    });
    return NextResponse.json({
      success: false,
      data: [],
      pagination: {
        currentPage: page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
      },
    }, { status: 500 });
  }
}