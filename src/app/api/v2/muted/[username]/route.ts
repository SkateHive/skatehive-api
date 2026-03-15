import { NextRequest, NextResponse } from 'next/server';
import { HAFSQL_Database } from '@/lib/hafsql_database';

const db = new HAFSQL_Database();

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ username: string }> }
) {
    console.log("Fetching muted data...");
    try {
        const { username } = await params;

        // Parse optional offset parameter for pagination
        const searchParams = request.nextUrl.searchParams;
        const offsetParam = searchParams.get('offset');
        const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
        const validOffset = isNaN(offset) || offset < 0 ? 0 : offset;

        // Get global muted list for the user
        const { rows, headers } = await db.executeQuery(`
SELECT
muted_name
FROM hafsql.mutes
WHERE 
muter_name = '${username}'
LIMIT 1000 OFFSET ${validOffset};
    `);

        if (!rows) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Database query failed'
                },
                { status: 500 }
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
        console.error('Muted fetch error:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to fetch muted data'
            },
            { status: 500 }
        );
    }
}
