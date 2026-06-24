// The `leaderboard` table is RLS-protected, so reads must go through the
// service-role client (the anon `supabase` client silently returns an error
// → empty list → a blank leaderboard on web + mobile). Use the dedicated
// leaderboard admin client and surface errors instead of swallowing them.
import { supabaseLeaderboardAdmin } from './supabaseClient';

export const getLeaderboard = async () => {
    const client = supabaseLeaderboardAdmin;
    if (!client) {
        console.error(
            'Leaderboard Supabase client not initialized — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_LEADERBOARD_SERVICE_ROLE_KEY'
        );
        throw new Error('Leaderboard Supabase client not initialized');
    }

    const pageSize = 1000;
    const allData: any[] = [];
    let from = 0;
    let to = pageSize - 1;
    let done = false;

    while (!done) {
        const { data, error } = await client
            .from('leaderboard')
            .select('*')
            .range(from, to);

        // Don't swallow the error — a blank leaderboard should be a loud 500,
        // not a misleading empty success.
        if (error) {
            console.error(`Error fetching leaderboard: ${error.message}`);
            throw new Error(`Failed to fetch leaderboard: ${error.message}`);
        }

        allData.push(...(data || []));

        if ((data || []).length < pageSize) done = true;
        else {
            from += pageSize;
            to += pageSize;
        }
    }

    return allData;
};
