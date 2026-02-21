/**
 * POST /api/v2/composeBlog
 * 
 * Create a full blog post on Skatehive via API
 * 
 * Requires API key authentication via Bearer token
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey, checkRateLimit } from '@/app/utils/apiAuth';
import HiveClient from '@/lib/hive/hiveclient';
import { PrivateKey } from '@hiveio/dhive';

interface ComposeBlogRequest {
  author: string; // Required: Hive username
  posting_key: string; // Required: User's posting key
  title: string;
  body: string;
  tags?: string[];
  images?: string[];
  thumbnail?: string;
  beneficiaries?: Array<{
    account: string;
    weight: number; // 1-10000 (0.01% - 100%)
  }>;
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
  
  // 2. Rate limiting
  const rateLimit = checkRateLimit(request.headers.get('authorization') || '', 20, 60000);
  
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
  let data: ComposeBlogRequest;
  
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
  
  if (!data.title || !data.title.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: 'Title is required'
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
  
  if (!data.thumbnail) {
    return NextResponse.json(
      {
        success: false,
        error: 'Thumbnail is required'
      },
      { status: 400 }
    );
  }
  
  // Validate beneficiaries
  if (data.beneficiaries && data.beneficiaries.length > 0) {
    const totalWeight = data.beneficiaries.reduce((sum, b) => sum + b.weight, 0);
    if (totalWeight > 10000) {
      return NextResponse.json(
        {
          success: false,
          error: 'Total beneficiary weight cannot exceed 10000 (100%)'
        },
        { status: 400 }
      );
    }
  }
  
  // 4. Generate permlink from title
  const permlink = data.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 255) + '-' + Date.now();
  
  // 5. Prepare metadata
  const tags = data.tags || ['hive-173115', 'skateboarding'];
  if (!tags.includes('hive-173115')) {
    tags.unshift('hive-173115');
  }
  
  const metadata = {
    app: `Skatehive API (${authResult.apiKeyName})`,
    tags,
    image: data.images || [data.thumbnail],
    format: 'markdown'
  };
  
  // 6. Post to Hive
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
    
    // Create comment operation
    const commentOp = [
      'comment',
      {
        parent_author: '',
        parent_permlink: 'hive-173115',
        author,
        permlink,
        title: data.title,
        body: data.body,
        json_metadata: JSON.stringify(metadata)
      }
    ];
    
    const operations = [commentOp];
    
    // Add comment_options if beneficiaries are specified
    if (data.beneficiaries && data.beneficiaries.length > 0) {
      const commentOptionsOp = [
        'comment_options',
        {
          author,
          permlink,
          max_accepted_payout: '1000000.000 HBD',
          percent_hbd: 10000,
          allow_votes: true,
          allow_curation_rewards: true,
          extensions: [
            [0, {
              beneficiaries: data.beneficiaries.map(b => ({
                account: b.account,
                weight: b.weight
              }))
            }]
          ]
        }
      ];
      operations.push(commentOptionsOp);
    }
    
    // Broadcast transaction
    const result = await HiveClient.broadcast.sendOperations(
      operations,
      privateKey
    );
    
    console.log('✅ Blog post created:', {
      author,
      permlink,
      title: data.title,
      apiKey: authResult.apiKeyName,
      txId: result.id
    });
    
    return NextResponse.json(
      {
        success: true,
        data: {
          author,
          permlink,
          title: data.title,
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
    console.error('❌ Failed to create blog post:', error);
    
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
