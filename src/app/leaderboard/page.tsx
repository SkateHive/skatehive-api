"use client";
import { useState, useEffect, useCallback } from "react";
import TerminalShell from "../components/TerminalShell";

interface LeaderboardRow {
  hive_author: string;
  max_voting_power_usd: number | null;
  hive_balance: number | null;
  hp_balance: number | null;
  hbd_balance: number | null;
  hbd_savings_balance: number | null;
  eth_address: string | null;
  gnars_balance: number | null;
  gnars_votes: number | null;
  skatehive_nft_balance: number | null;
  has_voted_in_witness: boolean;
  eth_total_balance: number | null;
  last_updated: string | null;
  last_post: string | null;
  post_count: number | null;
  giveth_donations_usd: number | null;
  points: number | null;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// tone helpers → return a global tone class
const tone = (ok: boolean, warn: boolean) =>
  ok ? "t-ok" : warn ? "t-warn" : "t-bad";

// Human-readable breakdown of how a skater's points are computed (shown on hover).
function pointsBreakdown(row: LeaderboardRow): string {
  const ethValid = !!row.eth_address && row.eth_address !== ZERO_ADDRESS;
  const total =
    Math.min(row.hive_balance ?? 0, 1000) * 0.1 +
    Math.min(row.hp_balance ?? 0, 12000) * 0.5 +
    (row.gnars_votes ?? 0) * 30 +
    (row.skatehive_nft_balance ?? 0) * 50 +
    (row.has_voted_in_witness ? 1000 : 0) +
    Math.min(row.hbd_savings_balance ?? 0, 1000) * 0.2 +
    Math.min(row.post_count ?? 0, 3000) * 0.1 +
    (row.max_voting_power_usd ?? 0) * 1000 +
    (ethValid ? 5000 : -2000) -
    Math.min(
      row.last_post
        ? Math.floor(
            (Date.now() - new Date(row.last_post).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : 100,
      100,
    ) +
    (row.giveth_donations_usd !== null
      ? Math.min(row.giveth_donations_usd, 1000) * 5
      : 0) +
    (row.hive_balance === 0 ? -1000 : 0) +
    (row.hp_balance === 0 ? -5000 : 0) +
    (row.gnars_votes === 0 ? -300 : 0) +
    (row.skatehive_nft_balance === 0 ? -900 : 0) +
    (row.hbd_savings_balance === 0 ? -200 : 0) +
    (row.post_count === 0 ? -2000 : 0);

  return [
    `Hive Balance: min(${row.hive_balance ?? 0},1000) * 0.1 = ${(Math.min(row.hive_balance ?? 0, 1000) * 0.1).toFixed(2)}`,
    `HP: min(${row.hp_balance ?? 0},12000) * 0.5 = ${(Math.min(row.hp_balance ?? 0, 12000) * 0.5).toFixed(2)}`,
    `Gnars Votes: ${row.gnars_votes ?? 0} * 30 = ${(row.gnars_votes ?? 0) * 30}`,
    `Skatehive NFT: ${row.skatehive_nft_balance ?? 0} * 50 = ${(row.skatehive_nft_balance ?? 0) * 50}`,
    `Witness Vote: ${row.has_voted_in_witness ? 1000 : 0}`,
    `HBD Savings: min(${row.hbd_savings_balance ?? 0},1000) * 0.2 = ${(Math.min(row.hbd_savings_balance ?? 0, 1000) * 0.2).toFixed(2)}`,
    `Post Count: min(${row.post_count ?? 0},3000) * 0.1 = ${Math.min(row.post_count ?? 0, 3000) * 0.1}`,
    `Voting Power: ${row.max_voting_power_usd ?? 0} * 1000 = ${((row.max_voting_power_usd ?? 0) * 1000).toFixed(2)}`,
    `ETH Wallet: ${ethValid ? "+5000" : "-2000"}`,
    `Donations: ${row.giveth_donations_usd !== null ? Math.min(row.giveth_donations_usd, 1000) * 5 : 0}`,
    `Zero-balance penalties applied where relevant`,
    `----------------------------------------`,
    `Total: ${total.toFixed(2)}`,
  ].join("\n");
}

const COLUMNS: { field: keyof LeaderboardRow; label: string }[] = [
  { field: "hive_author", label: "Author" },
  { field: "max_voting_power_usd", label: "Max VP" },
  { field: "hive_balance", label: "Hive" },
  { field: "hp_balance", label: "HP" },
  { field: "hbd_balance", label: "HBD" },
  { field: "hbd_savings_balance", label: "Savings" },
  { field: "eth_address", label: "ETH" },
  { field: "gnars_balance", label: "Gnars" },
  { field: "gnars_votes", label: "G.Votes" },
  { field: "skatehive_nft_balance", label: "SKTHV NFT" },
  { field: "has_voted_in_witness", label: "Witness" },
  { field: "last_updated", label: "Updated" },
  { field: "last_post", label: "Last Post" },
  { field: "post_count", label: "Posts" },
  { field: "giveth_donations_usd", label: "Giveth $" },
  { field: "points", label: "Points" },
];

export default function Leaderboard() {
  const [sortField, setSortField] = useState<keyof LeaderboardRow>("points");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string>("--:--:--");

  // Admin-only recompute controls are hidden unless the page is opened with ?admin=1
  const [showAdmin, setShowAdmin] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMsg, setRecomputeMsg] = useState<string | null>(null);

  useEffect(() => {
    setShowAdmin(
      new URLSearchParams(window.location.search).get("admin") === "1",
    );
  }, []);

  // Re-fetch existing rows from the read API (no recomputation).
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v2/leaderboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LeaderboardRow[];
      setLeaderboard(Array.isArray(data) ? data : []);
      setLastLoaded(new Date().toLocaleTimeString([], { hour12: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Admin action: trigger the recompute cron, then refresh the display.
  // The CRON_SECRET is entered by the operator at action time and kept only in
  // sessionStorage — it is never bundled into the client code.
  const recompute = useCallback(async () => {
    if (
      !window.confirm(
        "Trigger a leaderboard recompute? This is an expensive job that refreshes a batch of the stalest accounts. Continue?",
      )
    ) {
      return;
    }

    let secret = sessionStorage.getItem("cron_secret") || "";
    if (!secret) {
      secret =
        window.prompt("Enter CRON_SECRET to authorize the recompute:") || "";
      if (!secret) return;
      sessionStorage.setItem("cron_secret", secret);
    }

    setRecomputing(true);
    setRecomputeMsg(null);
    try {
      const res = await fetch("/api/cron/v2", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionStorage.removeItem("cron_secret"); // bad secret — clear so next try re-prompts
        throw new Error("unauthorized (check CRON_SECRET)");
      }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setRecomputeMsg(
        `recompute ok · ${body?.updatedUsersCount ?? 0} accounts updated`,
      );
      await load();
    } catch (e) {
      setRecomputeMsg(
        `recompute failed · ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setRecomputing(false);
    }
  }, [load]);

  const formatEthAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const filteredLeaderboard = leaderboard.filter((row) =>
    row.hive_author.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const sortedLeaderboard = [...filteredLeaderboard].sort((a, b) => {
    const aValue = a[sortField] ?? 0;
    const bValue = b[sortField] ?? 0;
    return sortOrder === "asc"
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number);
  });

  const handleSortChange = (field: keyof LeaderboardRow) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const sortArrow = (field: keyof LeaderboardRow) =>
    sortField === field ? (sortOrder === "asc" ? " ▲" : " ▼") : "";

  const dayAgo = new Date(new Date().setDate(new Date().getDate() - 1));
  const yearAgo = new Date(
    new Date().setFullYear(new Date().getFullYear() - 1),
  );

  return (
    <TerminalShell
      title="skatehive@leaderboard — ranking"
      command={`./leaderboard --sort=${String(sortField)} --order=${sortOrder}`}
      active="leaderboard"
      right={loading ? "loading…" : "live"}
    >
      <section className="t-panel">
        <div className="t-panel-head">
          <span className="t-panel-title">skater_ranking</span>
          <button className="t-btn" onClick={load} disabled={loading}>
            {loading ? "loading…" : "↻ refresh"}
          </button>
          {showAdmin && (
            <button
              className="t-btn admin-btn"
              onClick={recompute}
              disabled={recomputing || loading}
              title="Admin: triggers /api/cron/v2 — expensive recompute"
            >
              {recomputing ? "recomputing…" : "⚙ recompute (admin)"}
            </button>
          )}
          <span className="t-panel-note">
            {sortedLeaderboard.length} skaters · updated {lastLoaded}
          </span>
        </div>
        <div className="t-panel-body">
          {error && <p className="t-bad load-msg">! load error: {error}</p>}
          {recomputeMsg && (
            <p
              className={`load-msg ${recomputeMsg.startsWith("recompute ok") ? "t-ok" : "t-bad"}`}
            >
              {recomputeMsg}
            </p>
          )}

          <div className="search-row">
            <span className="search-label">grep&gt;</span>
            <input
              className="t-input"
              type="text"
              placeholder="filter by hive author…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="t-table-scroll">
            <table className="t-table">
              <thead>
                <tr>
                  <th className="t-rank">#</th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.field}
                      className={sortField === col.field ? "is-sorted" : ""}
                      onClick={() => handleSortChange(col.field)}
                    >
                      {col.label}
                      {sortArrow(col.field)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedLeaderboard.map((row, index) => {
                  const ethValid =
                    !!row.eth_address && row.eth_address !== ZERO_ADDRESS;
                  return (
                    <tr key={row.hive_author ?? index}>
                      <td className="t-rank">{index + 1}</td>
                      <td>
                        <a
                          href={`https://hivehub.dev/@${row.hive_author}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.hive_author}
                        </a>
                      </td>
                      <td
                        className={
                          row.max_voting_power_usd == null
                            ? "t-muted"
                            : tone(
                                row.max_voting_power_usd > 0.5,
                                row.max_voting_power_usd >= 0.05,
                              )
                        }
                      >
                        {row.max_voting_power_usd ?? "N/A"}
                      </td>
                      <td
                        className={tone(
                          (row.hive_balance ?? 0) > 500,
                          (row.hive_balance ?? 0) >= 100,
                        )}
                      >
                        {row.hive_balance ?? "N/A"}
                      </td>
                      <td
                        className={tone(
                          (row.hp_balance ?? 0) >= 2000,
                          (row.hp_balance ?? 0) >= 500,
                        )}
                      >
                        {row.hp_balance ?? "N/A"}
                      </td>
                      <td
                        className={tone(
                          (row.hbd_balance ?? 0) > 500,
                          (row.hbd_balance ?? 0) >= 100,
                        )}
                      >
                        {row.hbd_balance ?? "N/A"}
                      </td>
                      <td
                        className={tone(
                          (row.hbd_savings_balance ?? 0) > 500,
                          (row.hbd_savings_balance ?? 0) >= 100,
                        )}
                      >
                        {row.hbd_savings_balance ?? "N/A"}
                      </td>
                      <td className={ethValid ? "t-ok" : "t-bad"}>
                        <a
                          href={`https://app.zerion.io/${row.eth_address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.eth_address
                            ? formatEthAddress(row.eth_address)
                            : "N/A"}
                        </a>
                      </td>
                      <td
                        className={tone(
                          (row.gnars_balance ?? 0) > 10,
                          (row.gnars_balance ?? 0) > 0,
                        )}
                      >
                        {row.gnars_balance ?? "N/A"}
                      </td>
                      <td
                        className={tone(
                          (row.gnars_votes ?? 0) > 10,
                          (row.gnars_votes ?? 0) > 0,
                        )}
                      >
                        {row.gnars_votes ?? "N/A"}
                      </td>
                      <td
                        className={tone(
                          (row.skatehive_nft_balance ?? 0) > 10,
                          (row.skatehive_nft_balance ?? 0) > 0,
                        )}
                      >
                        {row.skatehive_nft_balance ?? "N/A"}
                      </td>
                      <td
                        className={row.has_voted_in_witness ? "t-ok" : "t-bad"}
                      >
                        {row.has_voted_in_witness ? "yes" : "no"}
                      </td>
                      <td
                        className={
                          row.last_updated &&
                          new Date(row.last_updated) < dayAgo
                            ? "t-bad"
                            : "t-ok"
                        }
                      >
                        {row.last_updated
                          ? new Date(row.last_updated).toLocaleDateString()
                          : "N/A"}
                      </td>
                      <td
                        className={
                          row.last_post && new Date(row.last_post) < yearAgo
                            ? "t-bad"
                            : "t-ok"
                        }
                      >
                        {row.last_post
                          ? new Date(row.last_post).toLocaleDateString()
                          : "N/A"}
                      </td>
                      <td
                        className={
                          (row.post_count ?? 0) === 0
                            ? "t-bad"
                            : (row.post_count ?? 0) > 100
                              ? "t-ok"
                              : "t-warn"
                        }
                      >
                        {row.post_count ?? "N/A"}
                      </td>
                      <td className="t-muted">
                        {row.giveth_donations_usd ?? "N/A"}
                      </td>
                      <td className="points" title={pointsBreakdown(row)}>
                        {row.points ?? "N/A"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && sortedLeaderboard.length === 0 && (
            <p className="t-muted empty">{"// no skaters match the filter"}</p>
          )}
        </div>
      </section>

      <style jsx>{`
        .search-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .search-label {
          color: var(--green);
          font-weight: 700;
          font-size: 13px;
        }
        .search-row :global(.t-input) {
          flex: 1;
          max-width: 360px;
        }
        .points {
          color: var(--green);
          font-weight: 700;
        }
        .empty {
          margin-top: 16px;
        }
        .load-msg {
          font-size: 12px;
          margin-bottom: 12px;
        }
        .admin-btn {
          color: var(--amber);
          border-color: var(--amber);
        }
        .admin-btn:hover:not(:disabled) {
          background: var(--amber);
          color: #1a1200;
        }
      `}</style>
    </TerminalShell>
  );
}
