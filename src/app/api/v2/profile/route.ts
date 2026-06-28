import { NextRequest, NextResponse } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';
import { HiveClient } from '@/lib/hive-client';

const db = new HAFSQL_Database();

export async function GET(request: NextRequest) {
  console.log("Fetching profile data...");
  
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username') || "SPECTATOR";
    
    // Get account information
    const { rows, headers } = await db.executeQuery(`
      SELECT 
        a.name,
        a.reputation,
        a.json_metadata,
        a.posting_metadata,
        a.followers,
        a.followings,
        a.created_at,
        a.last_vote_time,
        a.last_root_post,
        a.last_post,
        a.total_posts,
        a.incoming_hp,
        a.outgoing_hp,
        a.creator,
        a.reward_hive_balance,
        a.reward_hbd_balance,
        a.reward_vests_balance,
        a.reward_vests_balance_hp,
        a.vesting_withdraw_rate,
        a.proxy,
        a.last_update
      FROM accounts a
      WHERE a.name = @username
    `, [{ name: 'username', value: username }]);

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Account not found'
        },
        { status: 404 }
      );
    }

    // Get total posts count
    const { rows: totalPostsRows } = await db.executeQuery(`
      SELECT COUNT(*) AS total
      FROM comments c
      WHERE c.author = @username
      AND c.parent_permlink SIMILAR TO 'snap-container-%'
      AND c.json_metadata @> '{"tags": ["hive-173115"]}'
      AND c.deleted = false;
    `, [{ name: 'username', value: username }]);

    // Get following? information
    const { rows: rowsFollowing } = await db.executeQuery(`
      SELECT Count(f.following_name) 
      FROM follows f
      JOIN community_subs cs ON f.following_name = cs.account_name 
      WHERE 
      f.follower_name = @username AND
      cs.community_name = 'hive-173115';
    `, [{ name: 'username', value: username }]);

    // Get followers? information
    const { rows: rowsFollowers } = await db.executeQuery(`
      SELECT Count(f.follower_name) 
      FROM follows f
      JOIN community_subs cs ON f.follower_name = cs.account_name 
      WHERE 
      f.following_name = @username AND
      cs.community_name = 'hive-173115';
    `, [{ name: 'username', value: username }]);


    const hiverc = await HiveClient.rc.getRCMana(username);
    const hiveMana = await HiveClient.rc.getVPMana(username);
    const vp_percent = `${hiveMana.percentage / 100}%`
    const rc_percent = `${hiverc.percentage / 100}%`


    return NextResponse.json(
      {
        success: true,
        data: {
          ...rows[0],
          community_followers: rowsFollowers[0].count,
          community_followings: rowsFollowing[0].count,
          community_totalposts: totalPostsRows[0].total,
          vp_percent,
          rc_percent,
        },
        headers: headers
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, max-age=0, must-revalidate', 'CDN-Cache-Control': 's-maxage=300, stale-while-revalidate=150', 'Vercel-CDN-Cache-Control': 's-maxage=300, stale-while-revalidate=150'
        }
      }
    );
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch account data'
      },
      { status: 500 }
    );
  }
}