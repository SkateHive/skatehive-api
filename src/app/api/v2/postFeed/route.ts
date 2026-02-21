/**
 * POST /api/v2/postFeed
 * 
 * Create a snap/short post on Skatehive feed via API
 * 
 * Requires API key authentication via Bearer token
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, checkRateLimit } from '@/app/utils/apiAuth';
import HiveClient from '@/lib/hive/hiveclient';
import { PrivateKey } from '@hiveio/dhive';
import { HIVE_CONFIG } from '@/config/app.config';

interface PostFeedRequest {
  author: string; // Required: Hive username
  posting_key: string; // Required: User's posting key
  body: string;
  images?: string[]; // IPFS URLs or regular URLs
  video_url?: string; // 3Speak iframe URL or IPFS video
  parent_author?: string; // Default: thread author
  parent_permlink?: string; // Default: latest snap-container
}

/**
 * Get latest snap container permlink
 */
async function getLatestSnapContainer(): Promise<string> {
  try {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const expectedPermlink = `snap-container-${dateStr}`;
    
    // Check if today's container exists
    const content = await HiveClient.database.call('get_content', [
      HIVE_CONFIG.THREADS.AUTHOR,
      expectedPermlink
    ]);
    
    if (content && content.id > 0) {
      return expectedPermlink;
    }
    
    // Fallback to main thread
    return HIVE_CONFIG.THREADS.PERMLINK;
  } catch (error) {
    console.error('Error getting snap container:', error);
    return HIVE_CONFIG.THREADS.PERMLINK;
  }
}

/**
 * Extract hashtags from text
 */
function extractHashtags(text: string): string[] {
  const hashtagRegex = /#(\w+)/g;
  const matches = text.match(hashtagRegex) || [];
  return matches.map(hashtag => hashtag.slice(1)); // Remove '#'
}

export async function POST(request: NextRequest) {
  // 1. Validate API key
  const authResult = validateApiKey(request);
  
  if (!authResult.isValid) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error
      },
      { status: 401 }
    );
  }
  
  // 2. Rate limiting (more permissive for feed posts)
  const rateLimit = checkRateLimit(
    request.headers.get('authorization') || '',
    50, // 50 posts per minute
    60000
  );
  
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded',
        resetAt: new Date(rateLimit.resetAt).toISOString()
      },
      { 
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': rateLimit.resetAt.toString()
        }
      }
    );
  }
  
  // 3. Parse and validate request body
  let data: PostFeedRequest;
  
  try {
    data = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid JSON body'
      },
      { status: 400 }
    );
  }
  
  // Validate required fields
  if (!data.author || !data.author.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Author (Hive username) is required'
      },
      { status: 400 }
    );
  }
  
  if (!data.posting_key || !data.posting_key.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Posting key is required'
      },
      { status: 400 }
    );
  }
  
  if (!data.body || !data.body.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Body is required'
      },
      { status: 400 }
    );
  }
  
  // 4. Get parent permlink (latest snap container)
  const parentAuthor = data.parent_author || HIVE_CONFIG.THREADS.AUTHOR;
  const parentPermlink = data.parent_permlink || await getLatestSnapContainer();
  
  // 5. Generate permlink
  const permlink = crypto.randomUUID();
  
  // 6. Extract hashtags from body
  const hashtags = extractHashtags(data.body);
  const tags = [
    HIVE_CONFIG.COMMUNITY_TAG,
    parentPermlink,
    ...hashtags
  ];
  
  // 7. Prepare metadata
  const metadata: any = {
    app: `Skatehive API (${authResult.apiKeyName})`,
    tags,
  };
  
  if (data.images && data.images.length > 0) {
    metadata.images = data.images;
  }
  
  if (data.video_url) {
    metadata.video = {
      url: data.video_url,
      platform: '3speak'
    };
  }
  
  // 8. Build final body with images/video
  let finalBody = data.body;
  
  // Append images
  if (data.images && data.images.length > 0) {
    const imageMarkdown = data.images
      .map(url => `\n![](${url})`)
      .join('');
    finalBody += imageMarkdown;
  }
  
  // Append video iframe
  if (data.video_url) {
    // If it's an IPFS hash, wrap in 3speak iframe
    if (data.video_url.includes('ipfs')) {
      const hash = data.video_url.split('/').pop()?.split('?')[0] || '';
      finalBody += `\n<iframe src="https://3speak.tv/embed?v=${hash}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`;
    } else {
      finalBody += `\n${data.video_url}\n`;
    }
  }
  
  // 9. Post to Hive
  try {
    const author = data.author;
    let privateKey: PrivateKey;
    
    try {
      privateKey = PrivateKey.fromString(data.posting_key);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid posting key format'
        },
        { status: 400 }
      );
    }
    
    // Create comment operation (snap = comment without title)
    const commentOp = [
      'comment',
      {
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        author,
        permlink,
        title: '', // Snaps don't have titles
        body: finalBody,
        json_metadata: JSON.stringify(metadata)
      }
    ];
    
    // Broadcast transaction
    const result = await HiveClient.broadcast.sendOperations(
      [commentOp],
      privateKey
    );
    
    console.log('✅ Feed post created:', {
      author,
      permlink,
      parent: `${parentAuthor}/${parentPermlink}`,
      apiKey: authResult.apiKeyName,
      txId: result.id
    });
    
    return NextResponse.json(
      {
        success: true,
        data: {
          author,
          permlink,
          parent_author: parentAuthor,
          parent_permlink: parentPermlink,
          url: `https://skatehive.app/post/${author}/${permlink}`,
          hive_url: `https://peakd.com/@${author}/${permlink}`,
          transaction_id: result.id
        }
      },
      { 
        status: 201,
        headers: {
          'X-RateLimit-Remaining': rateLimit.remaining.toString()
        }
      }
    );
    
  } catch (error: any) {
    console.error('❌ Failed to create feed post:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to post to blockchain',
        details: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}
