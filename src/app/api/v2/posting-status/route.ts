/**
 * GET /api/v2/posting-status
 * 
 * Health check and configuration status for posting endpoints
 * Public endpoint (no authentication required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { HiveClient } from '@/lib/hive-client';

const COMMUNITY_TAG = 'hive-173115';
const THREAD_AUTHOR = process.env.NEXT_PUBLIC_SKATEHIVE_THREAD_AUTHOR || 'peak.snaps';
const THREAD_PERMLINK = process.env.NEXT_PUBLIC_SKATEHIVE_THREAD_PERMLINK || 'nxvsjarvmp';

export async function GET(request: NextRequest) {
  try {
    // Check if parent account exists
    let parentAccountExists = false;
    let latestSnapContainer = null;
    
    try {
      const account = await HiveClient.database.call('get_accounts', [[THREAD_AUTHOR]]);
      parentAccountExists = account && account.length > 0;
      
      if (parentAccountExists) {
        // Try to get latest snap container
        const result = await HiveClient.database.call(
          'get_discussions_by_author_before_date',
          [THREAD_AUTHOR, '', new Date().toISOString(), 1]
        );
        
        if (result && result.length > 0) {
          latestSnapContainer = result[0].permlink;
        }
      }
    } catch (error) {
      console.error('Error checking parent account:', error);
    }
    
    return NextResponse.json(
      {
        success: true,
        status: 'operational',
        config: {
          community_tag: COMMUNITY_TAG,
          parent_author: THREAD_AUTHOR,
          parent_author_exists: parentAccountExists,
          fallback_permlink: THREAD_PERMLINK,
          latest_snap_container: latestSnapContainer
        },
        endpoints: {
          composeBlog: {
            path: '/api/v2/composeBlog',
            method: 'POST',
            rate_limit: '20 requests/minute',
            requires: ['API key', 'author', 'posting_key', 'title', 'body', 'thumbnail']
          },
          postFeed: {
            path: '/api/v2/postFeed',
            method: 'POST',
            rate_limit: '50 requests/minute',
            requires: ['API key', 'author', 'posting_key', 'body'],
            optional: ['images', 'video_url', 'parent_author', 'parent_permlink']
          }
        },
        usage: {
          authentication: 'Bearer token in Authorization header',
          documentation: '/api/v2/API_POSTING.md'
        }
      },
      { 
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=0, must-revalidate', 'CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30', 'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30'
        }
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check status',
        details: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}
