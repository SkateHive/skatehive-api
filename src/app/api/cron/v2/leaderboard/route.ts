import { getLeaderboard } from '@/app/utils/supabase/getLeaderboard';
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/app/utils/cronAuth';

export async function GET(req: Request) {
  const unauthorized = checkCronAuth(req);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(req.url);
    const sortBy = searchParams.get('sort'); // 'points' or 'posts_count'
    const usernames = searchParams.get('username')?.split(',').map(u => u.trim().toLowerCase());

    const data = await getLeaderboard();

    // Optional filter by username(s)
    const filtered = usernames
      ? data.filter(entry => usernames.includes(entry.hive_author.toLowerCase()))
      : data;

    // Sorting
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'posts_score') 
        return b.posts_score - a.posts_score;
      return b.points - a.points;
    });

    return NextResponse.json(sorted);
  } catch (error) {
    console.error('Error fetching data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data', details: (error as Error).message },
      { status: 500 }
    );
  }
}
