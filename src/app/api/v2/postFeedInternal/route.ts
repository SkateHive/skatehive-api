/**
 * POST /api/v2/postFeedInternal
 *
 * Internal posting endpoint for SkateHive services.
 * Uses author alias -> env-managed key mapping (no posting key in request body).
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, checkRateLimit } from '@/app/utils/apiAuth';
import { postFeedAsAlias, PostingAlias } from '@/lib/feed-posting';

interface PostFeedInternalRequest {
  author_alias: PostingAlias;
  body: string;
  images?: string[];
  video_url?: string;
  parent_author?: string;
  parent_permlink?: string;
  tags?: string[];
  context?: string;
}

const ALLOWED_ALIASES: PostingAlias[] = ['skateuser', 'skatedev', 'skatehacker'];

export async function POST(request: NextRequest) {
  const authResult = validateApiKey(request);
  if (!authResult.isValid) {
    return NextResponse.json({ success: false, error: authResult.error }, { status: 401 });
  }

  const rateLimit = checkRateLimit(request.headers.get('authorization') || '', 80, 60000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded',
        resetAt: new Date(rateLimit.resetAt).toISOString(),
      },
      { status: 429 }
    );
  }

  let data: PostFeedInternalRequest;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!data.author_alias || !ALLOWED_ALIASES.includes(data.author_alias)) {
    return NextResponse.json({ success: false, error: 'Invalid author_alias' }, { status: 400 });
  }

  if (!data.body || !data.body.trim()) {
    return NextResponse.json({ success: false, error: 'Body is required' }, { status: 400 });
  }

  try {
    const result = await postFeedAsAlias(data.author_alias, {
      body: data.body,
      images: data.images,
      videoUrl: data.video_url,
      parentAuthor: data.parent_author,
      parentPermlink: data.parent_permlink,
      extraTags: data.tags,
      appLabel: data.context ? `Skatehive API (${data.context})` : `Skatehive API (${authResult.apiKeyName})`,
    });

    return NextResponse.json({
      success: true,
      data: {
        author: result.author,
        permlink: result.permlink,
        parent_author: result.parentAuthor,
        parent_permlink: result.parentPermlink,
        transaction_id: result.txId,
        url: `https://skatehive.app/post/${result.author}/${result.permlink}`,
        hive_url: `https://peakd.com/@${result.author}/${result.permlink}`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to post feed item',
      },
      { status: 500 }
    );
  }
}
