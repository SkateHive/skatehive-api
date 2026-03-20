import { Asset } from '@hiveio/dhive';
import { supabase } from './supabase/supabaseClient'; // Use the existing Supabase client
import { logWithColor, fetchAccountInfo, extractEthAddressFromHiveAccount } from './hive/hiveUtils';
import { DataBaseAuthor } from './types';
import { convertVestingSharesToHivePower, calculateUserVoteValue } from './hive/hiveUtils';
import { fetchSubscribers } from './hive/fetchSubscribers';
import { readGnarsBalance, readGnarsVotes, readSkatehiveNFTBalance } from './ethereum/ethereumUtils';
import { getLeaderboard } from './supabase/getLeaderboard';
import { matchAndUpsertDonors } from './ethereum/giveth';
import { fetchCommunityPosts } from '@/app/utils/hive/fetchCommunityPosts';
import { fetchCommunitySnaps } from '@/app/utils/hive/fetchCommunitySnaps';

// Helper function to fetch posts and snaps scores from APIs
async function fetchPostsAndSnaps(hive_author: string, postsData: { rows: any[]; }, snapsData: { rows: any[]; }) {
  const POST_SCORE_MULTIPLIER = 10; // Higher influence for posts
  const SNAP_SCORE_MULTIPLIER = 3;  // Lower influence for snaps
  const MAX_SNAPS = 50; // Cap snaps to prevent spamming

  try {
    const posts = postsData.rows.find((row: { user: string; }) => row.user === hive_author) || { score: 0, snaps: 0 };
    const snaps = snapsData.rows.find((row: { user: string; }) => row.user === hive_author) || { score: 0, snaps: 0 };


    const weekly_snaps = Math.min(parseInt(snaps.snaps, 10) || 0, MAX_SNAPS);
    const combined_score =
      (parseFloat(posts.score) || 0) * POST_SCORE_MULTIPLIER +
      (parseFloat(snaps.score) || 0) * SNAP_SCORE_MULTIPLIER * (weekly_snaps / (snaps.snaps || 1));

    return {
      post_count: Math.round(combined_score), // Store combined score in post_count
    };
  } catch (error) {
    logWithColor(`Error fetching posts/snaps for ${hive_author}: ${error}`, 'red');
    return { post_count: 0 };
  }
}

// Helper function to upsert authors into Supabase
export const upsertAuthors = async (authors: { hive_author: string }[]) => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    return;
  }

  try {
    const authorData: Partial<DataBaseAuthor>[] = authors.map(({ hive_author }) => ({
      hive_author,
    }));

    const { error } = await supabase
      .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
      .upsert(authorData, { onConflict: 'hive_author' });

    if (error) {
      logWithColor(`Error upserting authors: ${error.message}`, 'red');
    } else {
      // logWithColor(`Successfully upserted ${authors.length} authors.`, 'blue');
    }
  } catch (error) {
    logWithColor(`Error in upsertAuthors: ${error}`, 'red');
    throw error; // Re-throw the error to ensure it is logged
  }
};

// Helper function to upsert account data into the leaderboard
export const upsertAccountData = async (accounts: Partial<DataBaseAuthor>[]) => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    return;
  }

  try {
    for (const account of accounts) {
      const { error: upsertError } = await supabase
        .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
        .upsert(account, { onConflict: 'hive_author' });

      if (upsertError) {
        logWithColor(`Error upserting account data for ${account.hive_author}: ${upsertError.message}`, 'red');
      } else {
        // logWithColor(`Successfully upserted account data for ${account.hive_author}.`, 'green');
      }
    }
  } catch (error) {
    logWithColor(`Error in upsertAccountData: ${error}`, 'red');
    throw error; // Re-throw the error to ensure it is logged
  }
};

// Function to fetch and store data for a subset of subscribers
export const fetchAndStorePartialData = async () => {
  const batchSize = 25;
  const community = 'hive-173115';

  try {
    const subscribers = await fetchSubscribers(community);
    const databaseData = await getLeaderboard();

    // const postsResponse = await fetch('http://api.skatehive.app/api/v2/activity/posts?limit=2000&offset=0');
    // const snapsResponse = await fetch('http://api.skatehive.app/api/v2/activity/snaps?limit=2000&offset=0');
    // const postsData = await postsResponse.json();
    // const snapsData = await snapsResponse.json();
    const postsData = await fetchCommunityPosts(community, 1, subscribers.length)
    // console.dir(postsData)
    const snapsData = await fetchCommunitySnaps(community, 1, subscribers.length)
    // console.dir(snapsData)


    // Find the 100 oldest subscribers by `last_updated`
    const lastUpdatedData = databaseData
      .sort((a, b) => new Date(a.last_updated).getTime() - new Date(b.last_updated).getTime())
      .slice(0, 100);

    const validSubscribers = subscribers.filter(subscriber =>
      lastUpdatedData.some(data => data.hive_author === subscriber.hive_author)
    );

    const totalBatches = Math.ceil(validSubscribers.length / batchSize);

    for (let i = 0; i < totalBatches; i++) {
      const batch = validSubscribers.slice(i * batchSize, (i + 1) * batchSize);

      await Promise.all(
        batch.map(async (subscriber) => {
          try {
            await fetchAndUpsertAccountData(subscriber, postsData, snapsData);
          } catch (error) {
            logWithColor(`Failed to process ${subscriber.hive_author}: ${error}`, 'red');
          }
        })
      );

      logWithColor(`Processed batch ${i + 1} of ${totalBatches}.`, 'cyan');
    }

    // ✅ Add Giveth Donations Processing Here
    logWithColor('Fetching and processing Giveth donations...', 'blue');
    await matchAndUpsertDonors();

    // ✅ Now Calculate Points
    logWithColor('Calculating points for all users...', 'blue');
    await calculateAndUpsertPoints();

    logWithColor('All data fetched and stored successfully.', 'green');
  } catch (error) {
    logWithColor(`Error during data processing: ${error}`, 'red');
  }
};


// Helper function to fetch and upsert account data for each subscriber
export const fetchAndUpsertAccountData = async (subscriber: { hive_author: string }, postsData: { rows: any[]; }, snapsData: { rows: any[]; }) => {
  const { hive_author } = subscriber;

  try {
    const accountInfo = await fetchAccountInfo(hive_author);
    if (!accountInfo) {
      logWithColor(`No account info found for ${hive_author}.`, 'red');
      return;
    }

    const vestingShares = parseFloat((accountInfo.vesting_shares as Asset).toString().split(" ")[0]);
    const delegatedVestingShares = parseFloat((accountInfo.delegated_vesting_shares as Asset).toString().split(" ")[0]);
    const receivedVestingShares = parseFloat((accountInfo.received_vesting_shares as Asset).toString().split(" ")[0]);

    const hp_balance = await convertVestingSharesToHivePower(
      vestingShares.toString(),
      delegatedVestingShares.toString(),
      receivedVestingShares.toString()
    );

    const voting_value = await calculateUserVoteValue(accountInfo);
    let gnars_balance = 0;
    let gnars_votes = 0;
    let skatehive_nft_balance = 0;
    const eth_address = extractEthAddressFromHiveAccount(accountInfo.json_metadata);
    if (eth_address === '0x0000000000000000000000000000000000000000') {
      // logWithColor(`Skipping ${hive_author} (no ETH address).`, 'orange');
    }
    else {
      gnars_balance = await readGnarsBalance(eth_address);
      gnars_votes = await readGnarsVotes(eth_address);
      skatehive_nft_balance = await readSkatehiveNFTBalance(eth_address);
    }

    const { post_count } = await fetchPostsAndSnaps(hive_author, postsData, snapsData);

    const accountData = {
      hive_author: accountInfo.name,
      hive_balance: parseFloat((accountInfo.balance as Asset).toString().split(" ")[0]),
      hp_balance: parseFloat(hp_balance.hivePower), // Use the calculated HP balance
      hbd_balance: parseFloat((accountInfo.hbd_balance as Asset).toString().split(" ")[0]),
      hbd_savings_balance: parseFloat((accountInfo.savings_hbd_balance as Asset).toString().split(" ")[0]),
      has_voted_in_witness: accountInfo.witness_votes.includes('skatehive'),
      eth_address,
      gnars_balance: gnars_balance ? parseFloat(gnars_balance.toString()) : 0,
      gnars_votes: gnars_votes ? parseFloat(gnars_votes.toString()) : 0,
      skatehive_nft_balance: skatehive_nft_balance ? parseFloat(skatehive_nft_balance.toString()) : 0,
      max_voting_power_usd: parseFloat(voting_value.toFixed(4)), // Use the calculated voting value
      last_updated: new Date(),
      last_post: new Date(accountInfo.last_post),
      post_count, // Use combined score as post_count
    };

    await upsertAccountData([accountData]);
    logWithColor(`Successfully upserted data for ${hive_author}.`, 'green');
  } catch (error) {
    logWithColor(`Error fetching or upserting account info for ${hive_author}: ${error}`, 'red');
  }
};

// Function to calculate and update points for all users
export const calculateAndUpsertPoints = async () => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    return;
  }

  try {
    // Fetch all data from the leaderboard
    const leaderboardData = await getLeaderboard();

    if (!leaderboardData || leaderboardData.length === 0) {
      logWithColor('No data found in the leaderboard.', 'red');
      return;
    }

    // Define multipliers and caps for points calculation
    const POINT_MULTIPLIERS = {
      hive_balance: 0.1,
      hp_balance: 0.5,
      gnars_votes: 30, // Changed from gnars_balance to gnars_votes
      skatehive_nft_balance: 50,
      witness_vote: 1000,
      hbd_savings_balance: 0.2,
      post_count: 0.1,
      max_voting_power_usd: 1000,
      max_inactivity_penalty: 100,
      eth_wallet_penalty: -2000,
      zero_value_penalties: {
        hive_balance: -1000,
        hp_balance: -5000,
        gnars_votes: -300, // Changed from gnars_balance to gnars_votes
        skatehive_nft_balance: -900,
        hbd_savings_balance: -200,
        post_count: -2000,
      },
    };

    const CAPS = {
      hive_balance: 1000,
      hp_balance: 12000,
      hbd_balance: 1000,
      hbd_savings_balance: 1000,
      post_count: 3000,
    };

    // Helper function to apply cap    
    const capValue = (value: number, cap: number) => Math.min(value, cap);

    // Calculate points for each user
    const updatedData = leaderboardData.map(user => {
      const {
        hive_balance = 0,
        hp_balance = 0,
        gnars_votes = 0, // Changed from gnars_balance to gnars_votes
        skatehive_nft_balance = 0,
        has_voted_in_witness = false,
        // hbd_balance = 0,
        hbd_savings_balance = 0,
        post_count = 0,
        max_voting_power_usd = 0, // Added max_voting_power_usd
        eth_address = null, // Added eth_address check
        last_post,
        points: currentPoints = 0, // Fetch current points if available
      } = user;

      const donationUSD = user.giveth_donations_usd ?? 0;
      const donationPoints = Math.min(donationUSD, 1000) * 5;

      const cappedHiveBalance = capValue(hive_balance, CAPS.hive_balance);
      const cappedHpBalance = capValue(hp_balance, CAPS.hp_balance);
      const cappedHbdSavingsBalance = capValue(hbd_savings_balance, CAPS.hbd_savings_balance);
      const cappedPostCount = capValue(post_count, CAPS.post_count);

      const daysSinceLastPost = last_post
        ? Math.floor((Date.now() - new Date(last_post).getTime()) / (1000 * 60 * 60 * 24))
        : POINT_MULTIPLIERS.max_inactivity_penalty;

      const hasValidEthWallet =
        eth_address && eth_address !== '0x0000000000000000000000000000000000000000';

      // Modified to ensure that users whose hive_author starts with "donator" do not receive the wallet bonus.
      const ethWalletBonus = (hasValidEthWallet && !user.hive_author.toLowerCase().startsWith('donator')) ? 5000 : 0;
      const ethWalletPenalty = !hasValidEthWallet ? POINT_MULTIPLIERS.eth_wallet_penalty : 0; // Apply penalty if no wallet

      const zeroValuePenalties = [
        { value: hive_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hive_balance },
        { value: hp_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hp_balance },
        { value: gnars_votes, penalty: POINT_MULTIPLIERS.zero_value_penalties.gnars_votes }, // Changed from gnars_balance to gnars_votes
        { value: skatehive_nft_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.skatehive_nft_balance },
        { value: hbd_savings_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hbd_savings_balance },
        { value: post_count, penalty: POINT_MULTIPLIERS.zero_value_penalties.post_count },
      ].reduce((acc, { value, penalty }) => acc + (value === 0 ? penalty : 0), 0);

      const points =
        (cappedHiveBalance * POINT_MULTIPLIERS.hive_balance) +
        (cappedHpBalance * POINT_MULTIPLIERS.hp_balance) +
        (gnars_votes * POINT_MULTIPLIERS.gnars_votes) + // Changed from gnars_balance to gnars_votes
        (skatehive_nft_balance * POINT_MULTIPLIERS.skatehive_nft_balance) +
        (has_voted_in_witness ? POINT_MULTIPLIERS.witness_vote : 0) +
        (cappedHbdSavingsBalance * POINT_MULTIPLIERS.hbd_savings_balance) +
        (cappedPostCount * POINT_MULTIPLIERS.post_count) +
        (max_voting_power_usd * POINT_MULTIPLIERS.max_voting_power_usd) +
        ethWalletBonus +
        ethWalletPenalty -
        Math.min(daysSinceLastPost, POINT_MULTIPLIERS.max_inactivity_penalty) +
        donationPoints + // <-- added donation points
        zeroValuePenalties;

      return {
        ...user,
        points: Math.max(points, 0), // Ensure points are non-negative
        hasUpdatedPoints: currentPoints !== Math.max(points, 0), // Track if points have changed
      };
    });

    // Update points only for users with changed points
    const usersToUpdate = updatedData.filter(user => user.hasUpdatedPoints);
    if (usersToUpdate.length === 0) {
      logWithColor('No changes in points detected. Skipping updates.', 'yellow');
      return;
    }

    const { error } = await supabase
      .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
      .upsert(
        usersToUpdate.map(({ hive_author, points, post_count }) => ({
          hive_author,
          points,
          post_count,
        })),
        { onConflict: 'hive_author' }
      );

    if (error) {
      logWithColor(`Failed to batch update points: ${error.message}`, 'red');
    } else {
      // logWithColor(`Updated points for ${usersToUpdate.length} users successfully.`, 'green');
    }
  } catch (error) {
    logWithColor(`Error in calculateAndUpsertPoints: ${(error as Error).message}`, 'red');
  }
};

// Function to fetch and store all data
export const fetchAndStoreAllData = async (): Promise<void> => {
  const batchSize = 25;
  const community = 'hive-173115';

  try {
    logWithColor('Starting to fetch and store all data...', 'blue');

    const postsResponse = await fetch('http://api.skatehive.app/api/v2/activity/posts?limit=2000&offset=0');
    const snapsResponse = await fetch('http://api.skatehive.app/api/v2/activity/snaps?limit=2000&offset=0');
    const postsData = await postsResponse.json();
    const snapsData = await snapsResponse.json();


    const subscribers = await fetchSubscribers(community);
    // dummy xvlad subscriber 
    // const subscribers = [{ hive_author: 'xvlad' }];

    logWithColor(`Fetched ${subscribers.length} valid subscribers to update.`, 'blue');

    // Step 1: Upsert authors into the database
    await upsertAuthors(subscribers);

    // Step 2: Process each batch of subscribers
    const totalBatches = Math.ceil(subscribers.length / batchSize);

    for (let i = 0; i < totalBatches; i++) {
      const batch = subscribers.slice(i * batchSize, (i + 1) * batchSize);

      await Promise.all(
        batch.map(async (subscriber) => {
          try {
            await fetchAndUpsertAccountData(subscriber, postsData, snapsData);
          } catch (error) {
            logWithColor(`Failed to process subscriber ${subscriber.hive_author}: ${error}`, 'red');
          }
        })
      );

      logWithColor(`Processed batch ${i + 1} of ${totalBatches}.`, 'cyan');
    }

    // ✅ Add Giveth Donations Processing Here
    logWithColor('Fetching and processing Giveth donations...', 'blue');
    await matchAndUpsertDonors();

    // Step 3: Calculate and upsert points
    logWithColor('Calculating points for all users...', 'blue');
    await calculateAndUpsertPoints();

    logWithColor('All data fetched, stored, and points calculated successfully.', 'green');
  } catch (error) {
    logWithColor(`Error in fetchAndStoreAllData: ${error}`, 'red');
    throw error;
  }
};





