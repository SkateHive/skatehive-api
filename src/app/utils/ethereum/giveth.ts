import { gql, request } from 'graphql-request';
import { supabase } from '../supabase/supabaseClient';
import { logWithColor } from '../hive/hiveUtils';

const GIVETH_API_URL = 'https://mainnet.serve.giveth.io/graphql';

const GET_ALL_DONATIONS_BY_PROJECT = gql`
  query GetAllDonationsByProject {
    donationsByProjectId(
      projectId: 1919
      take: 1000
      skip: 0
      orderBy: { field: CreationDate, direction: DESC }
    ) {
      donations {
        amount
        valueUsd
        user {
          walletAddress
          name
        }
      }
    }
  }
`;

export type GivethResponse = {
  donationsByProjectId: {
    donations: {
      amount: number;
      valueUsd: number;
      user: {
        walletAddress: string;
        name: string;
      };
    }[];
  };
};

/** ✅ Fetch all donation records from Giveth API */
export const fetchGivethDonations = async (): Promise<GivethResponse> => {
  try {
    const data = await request<GivethResponse>(GIVETH_API_URL, GET_ALL_DONATIONS_BY_PROJECT);
    return data;
  } catch (error) {
    logWithColor(`Failed to fetch data from Giveth API: ${error}`, 'red');
    throw new Error('Failed to fetch data from Giveth API');
  }
};

/** ✅ Fetch all current users from Supabase */
export const fetchAllHiveAuthors = async () => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    throw new Error('Supabase client not initialized');
  }

  const { data, error } = await supabase
    .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
    .select('hive_author, eth_address, giveth_donations_usd, giveth_donations_amount');

  if (error) {
    logWithColor(`Failed to fetch Hive authors: ${error.message}`, 'red');
    throw new Error('Failed to fetch Hive authors');
  }

  return data;
};

/** ✅ Match Giveth donors to existing users or create new ones */
export const matchAndUpsertDonors = async () => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    throw new Error('Supabase client not initialized');
  }

  try {
    // Fetch donations
    const givethData = await fetchGivethDonations();
    const donations = givethData.donationsByProjectId.donations;

    // Fetch existing users
    const existingUsers = await fetchAllHiveAuthors();

    // Create a map for quick eth_address lookup
    const ethToHiveAuthorMap = new Map(
      existingUsers
        .filter((user) => user.eth_address) // Only users with Ethereum wallets
        .map((user) => [user.eth_address.toLowerCase(), user])
    );

    const donationAggregation = new Map(); // To aggregate donations per user

    for (const donation of donations) {
      const { walletAddress, name } = donation.user;
      const eth_address = walletAddress.toLowerCase();
      const existingUser = ethToHiveAuthorMap.get(eth_address);

      const hive_author = existingUser?.hive_author ?? (name
        ? `donator_${name.replace(/\s+/g, '_')}`
        : `donator_${walletAddress.substring(0, 6)}` // Use wallet address as fallback
      );

      if (!donationAggregation.has(hive_author)) {
        donationAggregation.set(hive_author, {
          hive_author,
          eth_address,
          giveth_donations_usd: 0,
          giveth_donations_amount: 0,
        });
      }

      const userDonation = donationAggregation.get(hive_author);
      userDonation.giveth_donations_usd += donation.valueUsd;
      userDonation.giveth_donations_amount += donation.amount;
      // fix donation ammounts to 2 decimal places
      userDonation.giveth_donations_usd = Math.round(userDonation.giveth_donations_usd * 100) / 100;
    }
    // Convert map values to an array
    const upsertData = Array
      .from(donationAggregation.values())
      .map(({ hive_author, eth_address, giveth_donations_usd, giveth_donations_amount }) => ({
          hive_author,
          eth_address,
          giveth_donations_usd,
          giveth_donations_amount,
          last_updated: new Date().toISOString()  //update last_updated
        })); // 🚨 `id` is NOT included here

    // ✅ Bulk upsert aggregated data
    if (upsertData.length > 0) {
      const { error } = await supabase.from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
                                      .upsert(upsertData, { 
                                        onConflict: 'hive_author' 
                                      });

      if (error) 
        logWithColor(`Error inserting/updating donors: ${error.message}`, 'red');
      // else 
        // logWithColor(`Successfully upserted ${upsertData.length} donors.`, 'green')
    }
  } catch (error) {
    logWithColor(`Error in matchAndUpsertDonors: ${error}`, 'red');
  }
};
