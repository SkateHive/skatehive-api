import { Asset } from '@hiveio/dhive';
import { supabase } from '../../../utils/supabase/supabaseClient';
import { logWithColor, fetchAccountInfo, extractEthAddressFromHiveAccount } from '../../../utils/hive/hiveUtils';
import { fetchDelegatedCurator } from '../../../utils/hive/hiveUtil_hafsql';
import { DataBaseAuthor } from '../../../utils/types';
import { convertVestingSharesToHivePower, calculateUserVoteValue } from '../../../utils/hive/hiveUtils';
import { fetchSubscribers } from '../../../utils/hive/fetchSubscribers';
import { readGnarsBalance, readGnarsVotes, readSkatehiveNFTBalance } from '../../../utils/ethereum/ethereumUtils';
import { getLeaderboard } from '../../../utils/supabase/getLeaderboard';
import { matchAndUpsertDonors } from '../../../utils/ethereum/giveth';
import { fetchCommunityPosts } from '@/app/utils/hive/fetchCommunityPosts';
import { fetchCommunitySnaps } from '@/app/utils/hive/fetchCommunitySnaps';


// Helper function to fetch posts and snaps scores from APIs
async function fetchPostsAndSnapsScore(
  hiveAuthor: string,
  postsData: { rows: any[] },
  snapsData: { rows: any[] }
) {
  const MAX_SNAPS = 20;

  try {
    const posts = postsData.rows.find(row => row.user === hiveAuthor) || {};
    const snaps = snapsData.rows.find(row => row.user === hiveAuthor) || {};

    const post_count = parseInt(posts.posts || '0', 10);
    const snaps_count = parseInt(snaps.snaps || '0', 10);

    const post_votes = parseFloat(posts.total_votes || '0');
    const post_payout = parseFloat(posts.total_payout || '0');

    const snap_votes = parseFloat(snaps.total_votes || '0');
    const snap_payout = parseFloat(snaps.total_payout || '0');

    // Quality: Engagement × Value
    const post_engagement_score = post_votes * Math.log2(1 + post_payout);
    const snap_engagement_score = snap_votes * Math.log2(1 + snap_payout);

    // Quantity bonus (posts more valuable)
    const post_quantity_bonus = post_count * 5;
    const snap_quantity_bonus = snaps_count * 1.5;

    // Final Score: sum of quality + quantity
    const posts_score = Math.round(
      post_engagement_score + snap_engagement_score + post_quantity_bonus + snap_quantity_bonus
    );

    return {
      posts_score,
      post_count,
      snaps_count
    };
  } catch (error) {
    logWithColor(`Error fetching posts/snaps for ${hiveAuthor}: ${error}`, 'red');
    return { post_count: 0 };
  }
}


export const removeUnsubscribedAuthors = async (currentSubscribers: { hive_author: string }[]) => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    return;
  }

  const currentUsernames = currentSubscribers.map(s => s.hive_author.toLowerCase());

  const { data: allAuthors, error } = await supabase
    .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
    .select('hive_author');

  if (error) {
    logWithColor(`Error fetching leaderboard authors: ${error.message}`, 'red');
    return;
  }

  const toRemove = allAuthors
    .filter(author =>
      !currentUsernames.includes(author.hive_author.toLowerCase()) &&
      !author.hive_author.toLowerCase().startsWith('donator_')
    )
    .map(author => author.hive_author);

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
      .delete()
      .in('hive_author', toRemove);

    if (deleteError) {
      logWithColor(`Error deleting unsubscribed authors: ${deleteError.message}`, 'red');
    } else {
      logWithColor(`Removed ${toRemove.length} unsubscribed authors.`, 'yellow');
    }
  }
};



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
    throw error;
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
    throw error;
  }
};

// Function to fetch and store data for a subset of subscribers
export const fetchAndStorePartialData = async () => {
  const batchSize = 25;
  const community = 'hive-173115';

  try {
    const subscribers = await fetchSubscribers(community);
    const databaseData = await getLeaderboard();

    const postsData = await fetchCommunityPosts(community, 1, subscribers.length);
    const snapsData = await fetchCommunitySnaps(community, 1, subscribers.length);

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

    logWithColor('Fetching and processing Giveth donations...', 'blue');
    await matchAndUpsertDonors();

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

    const delegated_curator = await fetchDelegatedCurator(hive_author);
    // if (parseInt(delegated_curator) > 0)
    // logWithColor("We will use Comm Curator Delegation? " + delegated_curator, 'red');

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
    } else {
      if (process.env.ALCHEMY_API_KEY) {
        gnars_balance = await readGnarsBalance(eth_address);
        gnars_votes = await readGnarsVotes(eth_address);
        skatehive_nft_balance = await readSkatehiveNFTBalance(eth_address);
      }
    }

    const { posts_score = 0, post_count = 0, snaps_count = 0 } = await fetchPostsAndSnapsScore(hive_author, postsData, snapsData);

    if (posts_score > 0) {
      // just debug info
      logWithColor(`User ${hive_author} has posts_score = ${posts_score} -- ${post_count} posts, ${snaps_count} snaps, total: ${post_count + snaps_count}`, 'yellow');
    }

    const accountData = {
      hive_author: accountInfo.name,
      hive_balance: parseFloat((accountInfo.balance as Asset).toString().split(" ")[0]),
      hp_balance: parseFloat(hp_balance.hivePower),
      hbd_balance: parseFloat((accountInfo.hbd_balance as Asset).toString().split(" ")[0]),
      hbd_savings_balance: parseFloat((accountInfo.savings_hbd_balance as Asset).toString().split(" ")[0]),
      has_voted_in_witness: accountInfo.witness_votes.includes('skatehive'),
      eth_address,
      gnars_balance: gnars_balance ? parseFloat(gnars_balance.toString()) : 0,
      gnars_votes: gnars_votes ? parseFloat(gnars_votes.toString()) : 0,
      skatehive_nft_balance: skatehive_nft_balance ? parseFloat(skatehive_nft_balance.toString()) : 0,
      max_voting_power_usd: parseFloat(voting_value.toFixed(4)),
      last_updated: new Date(),
      last_post: new Date(accountInfo.last_post),
      post_count,
      snaps_count,
      posts_score,
      delegated_curator,
    };

    await upsertAccountData([accountData]);
    // logWithColor(`Successfully upserted data for ${hive_author}.`, 'green');
  } catch (error) {
    logWithColor(`Error fetching or upserting account info for ${hive_author}: ${error}`, 'red');
  }
};

// export const calculateAndUpsertPoints = async () => {
export const calculateAndUpsertPointsBatch = async (batchUsers: any[]) => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    return 0;
  }

  const POINT_MULTIPLIERS = {
    hive_balance: 0.1,
    hp_balance: 0.2,
    gnars_votes: 2,
    skatehive_nft_balance: 3,
    gnars_balance: 5, // Added for Gnars NFTs (5 points per NFT)
    witness_vote: 1000,
    hbd_savings_balance: 0.2,
    posts_score: 0.5,
    delegated_curator: 0.1,
    max_voting_power_usd: 1000,
    max_inactivity_penalty1: 100, // 1+ month
    max_inactivity_penalty2: 1500, // 2+ months
    max_inactivity_penalty3: 4100, // 3+ months
    max_inactivity_penalty4: 10000, // 1+ year
    eth_wallet_penalty: 0,
    zero_value_penalties: {
      hive_balance: -4000,
      hp_balance: -5000,
      gnars_votes: 0,
      skatehive_nft_balance: 0,
      hbd_savings_balance: -200,
      posts_score: -255,
      no_witness: -3500,
    },
  };

  const CAPS = {
    hive_balance: 1000,
    hp_balance: 1000,
    hbd_balance: 1000,
    hbd_savings_balance: 1000,
    posts_score: 7000,
    skatehive_nft_balance: 50, // Cap at 20 NFTs for 1,000 points
    gnars_balance: 50, // Cap at 10 Gnars NFTs for 100 points
  };

  const calculateInactivityPenalty = (last_post: string | number | Date) => {
    if (!last_post) {
      return POINT_MULTIPLIERS.max_inactivity_penalty4;
    }

    const daysSinceLastPost = Math.floor((Date.now() - new Date(last_post).getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceLastPost >= 365) {
      return POINT_MULTIPLIERS.max_inactivity_penalty4; // penalty for 1+ year
    } else if (daysSinceLastPost >= 90) {
      return POINT_MULTIPLIERS.max_inactivity_penalty3; // 3+ months
    } else if (daysSinceLastPost >= 60) {
      return POINT_MULTIPLIERS.max_inactivity_penalty2; // 2+ months
    } else if (daysSinceLastPost >= 30) {
      return POINT_MULTIPLIERS.max_inactivity_penalty1; // 1+ month
    }
    return 0; // No penalty if last post is within 30 days
  };

  try {
    var leaderboardData = batchUsers; //await getLeaderboard();
    // logWithColor("\leaderboardData:")
    // console.dir(leaderboardData)
    // logWithColor("\nbatchUsers:")
    // console.dir(batchUsers)

    if (!leaderboardData || leaderboardData.length === 0) {
      logWithColor('No data found in the leaderboard.', 'red');
      return;
    }


    const capValue = (value: number, cap: number) => Math.min(value, cap);

    const updatedData = leaderboardData.map(user => {
      const {
        hive_author,
        hive_balance = 0,
        hp_balance = 0,
        gnars_votes = 0,
        skatehive_nft_balance = 0,
        gnars_balance = 0, // Added for Gnars NFTs
        has_voted_in_witness = false,
        hbd_savings_balance = 0,
        posts_score = 0,
        post_count = 0,
        snaps_count = 0,
        delegated_curator = 0,
        max_voting_power_usd = 0,
        eth_address = null,
        last_post,
        points: currentPoints = 0,
      } = user;

      if (hive_author.startsWith("donator_")) {
        console.log("found user");
      }

      const donationUSD = user.giveth_donations_usd ?? 0;
      const donationPoints = Math.min(donationUSD, 1000) * 2;

      const cappedHiveBalance = capValue(hive_balance, CAPS.hive_balance);
      const cappedHpBalance = capValue(hp_balance, CAPS.hp_balance);
      const cappedHbdSavingsBalance = capValue(hbd_savings_balance, CAPS.hbd_savings_balance);
      const cappedPostScore = capValue(posts_score, CAPS.posts_score);
      const cappedSkatehiveNFTBalance = capValue(skatehive_nft_balance, CAPS.skatehive_nft_balance);
      const cappedGnarsBalance = capValue(gnars_balance, CAPS.gnars_balance);

      // const daysSinceLastPost = last_post
      //   ? Math.floor((Date.now() - new Date(last_post).getTime()) / (1000 * 60 * 60 * 24))
      //   : POINT_MULTIPLIERS.max_inactivity_penalty;
      const inactivityPenalty = calculateInactivityPenalty(last_post);

      const hasValidEthWallet = eth_address && eth_address !== '0x0000000000000000000000000000000000000000';

      const ethWalletBonus = (hasValidEthWallet && !user.hive_author.toLowerCase().startsWith('donator')) ? 5000 : 0;
      const ethWalletPenalty = !hasValidEthWallet ? POINT_MULTIPLIERS.eth_wallet_penalty : 0;

      const zeroValuePenalties = [
        { value: hive_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hive_balance },
        { value: hp_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hp_balance },
        { value: gnars_votes, penalty: POINT_MULTIPLIERS.zero_value_penalties.gnars_votes },
        { value: skatehive_nft_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.skatehive_nft_balance },
        { value: hbd_savings_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hbd_savings_balance },
        { value: posts_score, penalty: POINT_MULTIPLIERS.zero_value_penalties.posts_score },
      ].reduce((acc, { value, penalty }) => acc + (value === 0 ? penalty : 0), 0);

      // Calculate Skatehive NFT bonus
      let skatehiveNFTPoints = cappedSkatehiveNFTBalance * POINT_MULTIPLIERS.skatehive_nft_balance;
      // if (skatehive_nft_balance > 20) {
      //   skatehiveNFTPoints = 5000;
      // } else if (skatehive_nft_balance > 15) {
      //   skatehiveNFTPoints = 4000;
      // } else if (skatehive_nft_balance > 10) {
      //   skatehiveNFTPoints = 3000;
      // } else if (skatehive_nft_balance > 5) {
      //   skatehiveNFTPoints = 2000;
      // } else if (skatehive_nft_balance > 1) {
      //   skatehiveNFTPoints = 1000;
      // } else if (skatehive_nft_balance === 1) {
      //   skatehiveNFTPoints = 500;
      // } else {
      //   skatehiveNFTPoints = 0;
      // }

      var points = Math.round(
        + (cappedHiveBalance * POINT_MULTIPLIERS.hive_balance)
        + (cappedHpBalance * POINT_MULTIPLIERS.hp_balance)
        + (gnars_votes * POINT_MULTIPLIERS.gnars_votes)
        + skatehiveNFTPoints
        + (cappedGnarsBalance * POINT_MULTIPLIERS.gnars_balance) // Added for Gnars NFTs
        + (has_voted_in_witness ? POINT_MULTIPLIERS.witness_vote : POINT_MULTIPLIERS.zero_value_penalties.no_witness)
        + (cappedHbdSavingsBalance * POINT_MULTIPLIERS.hbd_savings_balance)
        + (cappedPostScore * POINT_MULTIPLIERS.posts_score)
        + (max_voting_power_usd * POINT_MULTIPLIERS.max_voting_power_usd)
        + ethWalletBonus
        + ethWalletPenalty
        + donationPoints
        + zeroValuePenalties
        + delegated_curator * POINT_MULTIPLIERS.delegated_curator
        - inactivityPenalty
        // delegatedCommunity
      );

      if (points <= 0) {
        points = posts_score;
      }


      // points = (has_voted_in_witness 
      //   ? points + POINT_MULTIPLIERS.witness_vote 
      //   : points * 0.2 //loose 80% points
      //   )

      if (Math.round(currentPoints) !== Math.max(points, 0)) {
        console.log('currentPoints !== Math.max(points, 0)');
        console.log('user ' + user?.hive_author);
        console.log('currentPoints ' + Math.round(currentPoints));
        console.log('points ' + points);
      }

      return {
        ...user,
        points: Math.max(points, 0),
        hasUpdatedPoints: Math.round(currentPoints) !== Math.max(points, 0),
      };
    });

    const usersToUpdate = updatedData.filter(user => user.hasUpdatedPoints);
    if (usersToUpdate.length === 0) {
      // logWithColor('No changes in points detected. Skipping updates.', 'yellow');
      return usersToUpdate.length;
    }

    logWithColor(`leaderboardData users = ${leaderboardData.length}`, 'red')
    logWithColor(`users to update = ${usersToUpdate.length}`, 'red')

    const { error } = await supabase
      .from(process.env.NEXT_PUBLIC_SUPABASE_DB || 'leaderboard')
      .upsert(
        usersToUpdate.map(({ hive_author, points, posts_score }) => ({
          hive_author,
          points,
          posts_score,
        })),
        { onConflict: 'hive_author' }
      );

    if (error) {
      logWithColor(`Failed to batch update points: ${error.message}`, 'red');
    } else {
      // logWithColor(`Updated points for ${usersToUpdate.length} users successfully.`, 'green');
    }

    return usersToUpdate;
  } catch (error) {
    logWithColor(`Error in calculateAndUpsertPointsBatch: ${(error as Error).message}`, 'red');
  }

}

// Function to calculate and update points for all users
export const calculateAndUpsertPoints = async () => {
  if (!supabase) {
    logWithColor('Supabase client not initialized', 'red');
    return;
  }

  try {
    const leaderboardData = await getLeaderboard();

    if (!leaderboardData || leaderboardData.length === 0) {
      logWithColor('No data found in the leaderboard.', 'red');
      return;
    }

    const POINT_MULTIPLIERS = {
      hive_balance: 0.1,
      hp_balance: 0.5,
      gnars_votes: 30,
      skatehive_nft_balance: 50,
      witness_vote: 1000,
      hbd_savings_balance: 0.2,
      posts_score: 0.1,
      max_voting_power_usd: 1000,
      max_inactivity_penalty: 100,
      eth_wallet_penalty: -2000,
      zero_value_penalties: {
        hive_balance: -1000,
        hp_balance: -5000,
        gnars_votes: -300,
        skatehive_nft_balance: -900,
        hbd_savings_balance: -200,
        posts_score: -2000,
      },
    };

    const CAPS = {
      hive_balance: 1000,
      hp_balance: 12000,
      hbd_balance: 1000,
      hbd_savings_balance: 1000,
      posts_score: 3000,
    };

    const capValue = (value: number, cap: number) => Math.min(value, cap);

    const updatedData = leaderboardData.map(user => {
      const {
        hive_balance = 0,
        hp_balance = 0,
        gnars_votes = 0,
        skatehive_nft_balance = 0,
        has_voted_in_witness = false,
        hbd_savings_balance = 0,
        posts_score = 0,
        max_voting_power_usd = 0,
        eth_address = null,
        last_post,
        points: currentPoints = 0,
      } = user;

      const donationUSD = user.giveth_donations_usd ?? 0;
      const donationPoints = Math.min(donationUSD, 1000) * 5;

      const cappedHiveBalance = capValue(hive_balance, CAPS.hive_balance);
      const cappedHpBalance = capValue(hp_balance, CAPS.hp_balance);
      const cappedHbdSavingsBalance = capValue(hbd_savings_balance, CAPS.hbd_savings_balance);
      const cappedPostScore = capValue(posts_score, CAPS.posts_score);

      const daysSinceLastPost = last_post
        ? Math.floor((Date.now() - new Date(last_post).getTime()) / (1000 * 60 * 60 * 24))
        : POINT_MULTIPLIERS.max_inactivity_penalty;

      const hasValidEthWallet = eth_address && eth_address !== '0x0000000000000000000000000000000000000000';

      const ethWalletBonus = (hasValidEthWallet && !user.hive_author.toLowerCase().startsWith('donator')) ? 5000 : 0;
      const ethWalletPenalty = !hasValidEthWallet ? POINT_MULTIPLIERS.eth_wallet_penalty : 0;

      const zeroValuePenalties = [
        { value: hive_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hive_balance },
        { value: hp_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hp_balance },
        { value: gnars_votes, penalty: POINT_MULTIPLIERS.zero_value_penalties.gnars_votes },
        { value: skatehive_nft_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.skatehive_nft_balance },
        { value: hbd_savings_balance, penalty: POINT_MULTIPLIERS.zero_value_penalties.hbd_savings_balance },
        { value: cappedPostScore, penalty: POINT_MULTIPLIERS.zero_value_penalties.posts_score },
      ].reduce((acc, { value, penalty }) => acc + (value === 0 ? penalty : 0), 0);

      const points =
        (cappedHiveBalance * POINT_MULTIPLIERS.hive_balance) +
        (cappedHpBalance * POINT_MULTIPLIERS.hp_balance) +
        (gnars_votes * POINT_MULTIPLIERS.gnars_votes) +
        (skatehive_nft_balance * POINT_MULTIPLIERS.skatehive_nft_balance) +
        (has_voted_in_witness ? POINT_MULTIPLIERS.witness_vote : 0) +
        (cappedHbdSavingsBalance * POINT_MULTIPLIERS.hbd_savings_balance) +
        (cappedPostScore * POINT_MULTIPLIERS.posts_score) +
        (max_voting_power_usd * POINT_MULTIPLIERS.max_voting_power_usd) +
        ethWalletBonus +
        ethWalletPenalty -
        Math.min(daysSinceLastPost, POINT_MULTIPLIERS.max_inactivity_penalty) +
        donationPoints +
        zeroValuePenalties;

      return {
        ...user,
        points: Math.max(points, 0),
        hasUpdatedPoints: currentPoints !== Math.max(points, 0),
      };
    });

    const usersToUpdate = updatedData.filter(user => user.hasUpdatedPoints);
    if (usersToUpdate.length === 0) {
      // logWithColor('No changes in points detected. Skipping updates.', 'yellow');
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


