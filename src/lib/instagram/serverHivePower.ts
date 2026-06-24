import { HiveClient } from "@/app/utils/hive/hiveUtils";

/**
 * Server-side Hive Power lookup for the cross-post trust gate. Ported from
 * skatehive3.0/lib/hive/serverHivePower.ts. Returns null on failure so callers
 * fail CLOSED (treat null as below threshold) — a degraded RPC can't bypass it.
 */
export async function getHivePowerForAccount(username: string): Promise<number | null> {
  const handle = username?.trim().toLowerCase();
  if (!handle) return null;

  try {
    const accounts = await HiveClient.database.getAccounts([handle]);
    const acc = accounts?.[0];
    if (!acc) return null;

    const globalProps: any = await HiveClient.call(
      "condenser_api",
      "get_dynamic_global_properties",
      []
    );
    const totalVestingFund = parseFloat(String(globalProps.total_vesting_fund_hive).split(" ")[0]);
    const totalVestingShares = parseFloat(String(globalProps.total_vesting_shares).split(" ")[0]);
    const vestingShares = parseFloat(String(acc.vesting_shares).split(" ")[0]);
    const receivedVestingShares = parseFloat(String(acc.received_vesting_shares).split(" ")[0]);
    const delegatedVestingShares = parseFloat(String(acc.delegated_vesting_shares).split(" ")[0]);
    const userVests = vestingShares + receivedVestingShares - delegatedVestingShares;
    if (totalVestingShares <= 0) return null;
    return (totalVestingFund * userVests) / totalVestingShares;
  } catch {
    return null;
  }
}
