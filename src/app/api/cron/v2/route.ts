import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/app/utils/cronAuth';
import { updateLeaderboardData } from './recompute';

// NOTE: The leaderboard recompute is primarily run off-Vercel by a scheduled
// job on the Mac Mini (scripts/recompute-leaderboard.ts) to avoid serverless
// compute cost. This route is kept as a CRON_SECRET-protected manual/backup
// trigger — it is intentionally NOT scheduled by Vercel Cron.
export async function GET(req: Request) {
    const unauthorized = checkCronAuth(req);
    if (unauthorized) return unauthorized;

    try {
        const updatedUsers = await updateLeaderboardData();
        return NextResponse.json({
            message: 'Cron job executed successfully.',
            updatedUsersCount: updatedUsers ? updatedUsers.length : 0,
            updatedUsers
        });

    } catch (error) {
        console.error('Error executing cron job:', error);
        return NextResponse.json({ error: 'Failed to execute cron job.' }, { status: 500 });
    }
}
