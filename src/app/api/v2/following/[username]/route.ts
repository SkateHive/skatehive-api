import { NextRequest, NextResponse } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';

const db = new HAFSQL_Database();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ username: string }> }
) {
    console.log("Fetching following data...");
    try {
        const { username } = await params;

        // Parse optional offset parameter for pagination
        const searchParams = request.nextUrl.searchParams;
        const offsetParam = searchParams.get('offset');
        const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
        const validOffset = isNaN(offset) || offset < 0 ? 0 : offset;

        // Get global following list for the user
        const {rows, headers} = await db.executeQuery(`
          SELECT
            f.follower_name, f.following_name
          FROM follows f
          WHERE f.follower_name = @username
          LIMIT 1000 OFFSET @offset;
        `, [
          { name: 'username', value: username },
          { name: 'offset', value: validOffset }
        ]);

        if (!rows || rows.length === 0) {
            return NextResponse.json(
                {
                    success: true,
                    total_count: 0,
                    data: [],
                    headers: headers
                },
                { status: 200 }
            );
        }

        return NextResponse.json(
            {
                success: true,
                total_count: rows.length,
                data: rows,
                headers: headers
            },
            {
                status: 200,
                headers: {
                    'Cache-Control': 's-maxage=300, stale-while-revalidate=150'
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