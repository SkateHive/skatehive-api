import { NextRequest, NextResponse } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';

const db = new HAFSQL_Database();

export async function GET(
  request: NextRequest,
) {
  console.log("Fetching BALANCE data...");
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    // Get user's balance + delegation information
    const {rows, headers} = await db.executeQuery(`
      SELECT 
        b.account_name,
        b.hive,
        b.hbd,
        b.vests,
        b.hp_equivalent,
        b.hive_savings,
        b.hbd_savings,
        COALESCE(a.outgoing_hp, '0') AS delegated_hp,
        COALESCE(a.incoming_hp, '0') AS received_hp
      FROM balances b
      LEFT JOIN accounts a ON b.account_name = a.name
      WHERE b.account_name = '${username}'
    `);

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Account not found'
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          ...rows[0],
          // HBD claimable interest requires savings_hbd_seconds which is not
          // available in HAFSQL. The mobile app will use the RPC fallback
          // value when it needs an accurate number.
          hbd_claimable: '0',
        },
        headers: headers
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 's-maxage=60, stale-while-revalidate=30'
        }
      }
    );
  } catch (error) {
    console.error('Wallet fetch error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch wallet data'
      },
      { status: 500 }
    );
  }
}