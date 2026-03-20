import { supabase } from './supabaseClient'; // Use the existing Supabase client

export const getLeaderboard = async () => {
    if (!supabase) {
        console.error('Supabase client not initialized');
        throw new Error('Supabase client not initialized');
    }

    // try {
    //     const { data } = await supabase
    //         .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
    //         .select('*')
    //         .range(0, 2500);
    //     if (data) {
    //         return data;
    //     } else {
    //         return [];
    //     }
    // } catch {
    //     throw new Error('Failed to fetch data from the database');
    // }

    const pageSize = 1000;
    let allData = [];
    let from = 0;
    let to = pageSize - 1;
    let done = false;
    try {
        while (!done) {
            const { data, error } = await supabase
                .from('leaderboard')
                .select('*')
                .range(from, to);

            if (error) {
                console.error(`Error fetching leaderboard authors: ${error.message}`, 'red');
                break;
            }

            allData.push(...(data || []));

            if ((data || []).length < pageSize) done = true;
            else {
                from += pageSize;
                to += pageSize;
            }
        }

        return allData
    } catch {
        // console.error('Failed to fetch data from the database')
        // return []
        throw new Error('Failed to fetch data from the database');
    }
};
