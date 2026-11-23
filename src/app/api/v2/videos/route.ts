import { NextRequest, NextResponse, after } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';
import { extractVideosFromPost, VideoEntry } from '@/lib/video-extraction';
import { resolveThumbnails } from '@/lib/video-thumbnails';
import { buildVideoPostsQuery } from '@/lib/video-posts-query';
import { normalizeHafVotes } from '@/app/api/v2/feed/helpers';
import { SwrCache, type SwrState } from '@/lib/swr-cache';

const hafDb = new HAFSQL_Database();

// Freshness budget. New posts show up within FRESH_MS in the normal case; a
// request after a quiet period can get a response up to STALE_MS old while a
// refresh runs in the background (instead of blocking on a cold scan).
const FRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;

// Edge cache. s-maxage matches FRESH_MS. stale-while-revalidate lets the
// Vercel edge answer instantly with the previous page while it refetches, so
// the first request after a quiet period doesn't pay the cold path.
const EDGE_CACHE = 's-maxage=60, stale-while-revalidate=300';
// A page served from this process's STALE entry must not be stored by the
// edge as if it were fresh, or the two stale windows stack (memory 5 min +
// edge 6 min). Keep it at the edge only briefly; the background refresh has
// a fresh page ready by the next revalidation. Worst-case content age stays
// ~7 min (fresh memory 60s + edge 60s + 300s stale).
const EDGE_CACHE_FOR_STALE = 's-maxage=5, stale-while-revalidate=60';

// Run background refreshes after the response is sent. after() keeps the
// function alive for them on Vercel; outside a request scope (tests, scripts)
// fall back to a detached promise.
function scheduleAfterResponse(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

type VideosPage = { videos: VideoEntry[]; hasMore: boolean; timing: Timing };
type Timing = { dbMs: number; thumbsMs: number; batches: number; thumbsCut?: boolean };

// Wall-clock cap on thumbnail resolution inside the request. Missing
// thumbnails may need a Pinata lookup (up to 5s each, re-done on every cold
// instance). Past the budget the page goes out with what it has: those
// entries keep thumbnailUrl null (mobile already has an on-device
// fallback), and resolution finishes after the response so the next refresh
// picks the results up.
const THUMBS_BUDGET_MS = 1500;

// Whole pages, keyed by query. Shared by concurrent requests and retries.
const pageCache = new SwrCache<VideosPage>({ freshMs: FRESH_MS, staleMs: STALE_MS, schedule: scheduleAfterResponse });
// Raw HAFSQL batches. Pages scan from offset 0, so page 2 and 3 reuse the
// batches page 1 already loaded instead of re-running the same query.
const batchCache = new SwrCache<any[]>({ freshMs: FRESH_MS, staleMs: FRESH_MS, maxEntries: 100 });

const PARENT_PERMLINK = process.env.PARENT_PERMLINK || '';

// Fetch posts from HAFSQL with a lean SELECT (no user metadata, no body-heavy fields we don't need)
async function fetchVideoPostsBatch(
  community: string,
  parentPermlink: string,
  author: string,
  limit: number,
  offset: number,
): Promise<any[]> {
  const key = `${community}:${parentPermlink}:${author}:${limit}:${offset}`;
  const { value } = await batchCache.get(key, async () => {
    const { query, params } = buildVideoPostsQuery(community, parentPermlink, author, limit, offset);
    const result = await hafDb.executeQuery(query, params);
    // Normalize votes from HAFSQL json_agg
    return result.rows.map(row => ({
      ...row,
      votes: normalizeHafVotes(row.votes),
    }));
  });
  return value;
}

/**
 * Fetch enough posts to fill the requested video count.
 * Not every post has a video, so we overfetch and iterate.
 */
async function fetchVideos(
  community: string,
  parentPermlink: string,
  author: string,
  targetCount: number,
  page: number,
): Promise<VideosPage> {
  const videos: VideoEntry[] = [];
  const BATCH_SIZE = targetCount * 3; // overfetch ratio
  const MAX_ITERATIONS = 4; // safety cap
  const startOffset = (page - 1) * targetCount;
  const timing: Timing = { dbMs: 0, thumbsMs: 0, batches: 0 };

  // We need to skip `startOffset` worth of video entries, then collect `targetCount`
  let dbOffset = 0;
  let skippedVideos = 0;
  let iterations = 0;

  while (videos.length < targetCount && iterations < MAX_ITERATIONS) {
    iterations++;
    const t0 = Date.now();
    const rows = await fetchVideoPostsBatch(community, parentPermlink, author, BATCH_SIZE, dbOffset);
    timing.dbMs += Date.now() - t0;
    timing.batches++;

    if (rows.length === 0) break; // no more posts

    for (const row of rows) {
      const entries = extractVideosFromPost(row);
      for (const entry of entries) {
        if (skippedVideos < startOffset) {
          skippedVideos++;
          continue;
        }
        videos.push(entry);
        if (videos.length >= targetCount) break;
      }
      if (videos.length >= targetCount) break;
    }

    dbOffset += BATCH_SIZE;

    // If this batch was full but we still need more, keep going
    if (rows.length < BATCH_SIZE) break;
  }

  // Check if there are more videos by seeing if we exhausted the batch
  const hasMore = videos.length >= targetCount;

  // Resolve thumbnails: metadata/body (already set) -> our cache -> Pinata -> transcoder
  const t1 = Date.now();
  const resolving = resolveThumbnails(videos);
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    budgetTimer = setTimeout(() => resolve(null), THUMBS_BUDGET_MS);
  });
  const raced = await Promise.race([resolving, budget]);
  clearTimeout(budgetTimer);
  let resolvedVideos: VideoEntry[];
  if (raced) {
    resolvedVideos = raced;
  } else {
    timing.thumbsCut = true;
    resolvedVideos = videos;
    scheduleAfterResponse(async () => {
      await resolving.catch((err) => console.error('[videos] thumbnail resolution failed:', err));
    });
  }
  timing.thumbsMs = Date.now() - t1;

  return { videos: resolvedVideos, hasMore, timing };
}

function serverTiming(state: SwrState, totalMs: number, timing: Timing): string {
  // db/thumbs describe the run that BUILT this page (it may be an earlier,
  // cached run); total and cache describe this request.
  return [
    `cache;desc="${state}"`,
    `total;dur=${totalMs}`,
    `db;dur=${timing.dbMs};desc="${timing.batches} batch(es)"`,
    `thumbs;dur=${timing.thumbsMs}${timing.thumbsCut ? ';desc="budget"' : ''}`,
  ].join(', ');
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const community = searchParams.get('community_code') || process.env.MY_COMMUNITY_CATEGORY || 'hive-173115';
  const author = (searchParams.get('author') || '').trim().toLowerCase();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));

  try {
    const cacheKey = `videos:${community}:${author}:${page}:${limit}`;
    const { value, state } = await pageCache.get(cacheKey, () =>
      fetchVideos(community, PARENT_PERMLINK, author, limit, page),
    );
    console.log(`[videos] ${state}: ${cacheKey}, ${value.videos.length} videos, ${Date.now() - started}ms`);

    return NextResponse.json({
      success: true,
      data: value.videos,
      pagination: {
        currentPage: page,
        limit,
        hasNextPage: value.hasMore,
        nextPage: value.hasMore ? page + 1 : null,
      },
    }, {
      status: 200,
      headers: {
        'Cache-Control': state === 'stale' ? EDGE_CACHE_FOR_STALE : EDGE_CACHE,
        // Mirrors the other v2 reads (#34); passes to the Vercel edge untouched.
        'CDN-Cache-Control': state === 'stale' ? EDGE_CACHE_FOR_STALE : EDGE_CACHE,
        'Server-Timing': serverTiming(state, Date.now() - started, value.timing),
      },
    });

  } catch (error) {
    console.error('[videos] Failed to fetch:', error);
    return NextResponse.json({
      success: false,
      data: [],
      pagination: {
        currentPage: page,
        limit,
        hasNextPage: false,
        nextPage: null,
      },
    }, { status: 500 });
  }
}

