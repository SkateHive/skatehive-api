import { NextRequest, NextResponse } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';

const db = new HAFSQL_Database();

export async function GET(
  // request: Request,
  //   { params }: { params: { username: string } }
) {
  try {
    // Wait for params to be available
    // const { username } = await params;

    // Get user's balance information
    const {rows, headers} = await db.executeQuery(`
      SELECT "timestamp", "open", high, low, "close", base_vol, quote_vol 
      FROM market_bucket_5m_table
      ORDER BY "timestamp" DESC
      LIMIT 1;
    `);

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Market Bucket 5m not found'
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: rows[0],
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