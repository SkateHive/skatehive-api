"use client";
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase/supabaseClient";
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

export default function Leaderboard() {
  const [sortField, setSortField] = useState<keyof LeaderboardRow>("points");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return;
      }

      const { data, error } = await supabase
        .from(process.env.NEXT_PUBLIC_SUPABASE_DB || "leaderboard")
        .select("*");
      if (error) {
        console.error("Error fetching leaderboard:", error);
      } else {
        setLeaderboard(data as LeaderboardRow[]);
      }
    };
    fetchData();
  }, []);

  function formatEthAddress(ethAddress: string) {
    return `${ethAddress.slice(0, 6)}...${ethAddress.slice(-4)}`;
  }

  // Filter the leaderboard based on the search term
  const filteredLeaderboard = leaderboard.filter((row) =>
    row.hive_author.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sort the leaderboard based on selected field and order
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

  return (
    <main style={{ padding: "20px" }}>
      <center>
        <h1>Skatehive Leaderboard</h1>
      </center>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <p>We are {sortedLeaderboard.length} skaters supporting ourselves</p>
        <input
          type="text"
          placeholder="Search by Hive Author"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: "6px",
            border: "1px solid #ddd",
            borderRadius: "4px",
          }}
        />
      </div>
      <table
        style={{ width: "100%", borderCollapse: "collapse", marginTop: "20px" }}
      >
        <thead>
          <tr>
            <th style={{ border: "1px solid #ddd", padding: "6px" }}>Rank</th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("hive_author")}
            >
              Hive Author
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("max_voting_power_usd")}
            >
              Max VP
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("hive_balance")}
            >
              Hive Bal
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("hp_balance")}
            >
              HP Bal
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("hbd_balance")}
            >
              HBD Bal
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("hbd_savings_balance")}
            >
              Savings Bal
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("eth_address")}
            >
              ETH Ad
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("gnars_balance")}
            >
              Gnars Bal
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("gnars_votes")}
            >
              Gnars Votes
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("skatehive_nft_balance")}
            >
              Skatehive NFT Bal
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("has_voted_in_witness")}
            >
              HasVotedWit
            </th>
            {/* <th style={{ border: '1px solid #ddd', padding: '6px', cursor: 'pointer' }} onClick={() => handleSortChange('eth_total_balance')}>ETH Bal</th> */}
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("last_updated")}
            >
              Last Updated
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("last_post")}
            >
              Last Post
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("post_count")}
            >
              Post Count
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("giveth_donations_usd")}
            >
              Giveth Donations USD
            </th>
            <th
              style={{
                border: "1px solid #ddd",
                padding: "6px",
                cursor: "pointer",
              }}
              onClick={() => handleSortChange("points")}
            >
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedLeaderboard.map((row, index) => (
            <tr key={index} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ border: "1px solid #ddd", padding: "6px" }}>
                {index + 1}
              </td>
              <td style={{ border: "1px solid #ddd", padding: "6px" }}>
                <a
                  href={`https://hivehub.dev/@${row.hive_author}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.hive_author}
                </a>
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    row.max_voting_power_usd !== null
                      ? row.max_voting_power_usd < 0.05
                        ? "red"
                        : row.max_voting_power_usd > 0.5
                        ? "green"
                        : "yellow"
                      : "black",
                }}
              >
                {row.max_voting_power_usd ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.hive_balance ?? 0) > 500
                      ? "green"
                      : (row.hive_balance ?? 0) >= 100
                      ? "yellow"
                      : "red",
                }}
              >
                {row.hive_balance ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.hp_balance ?? 0) < 500
                      ? "red"
                      : (row.hp_balance ?? 0) < 2000
                      ? "yellow"
                      : "green",
                }}
              >
                {row.hp_balance ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.hbd_balance ?? 0) > 500
                      ? "green"
                      : (row.hbd_balance ?? 0) >= 100
                      ? "yellow"
                      : "red",
                }}
              >
                {row.hbd_balance ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.hbd_savings_balance ?? 0) > 500
                      ? "green"
                      : (row.hbd_savings_balance ?? 0) >= 100
                      ? "yellow"
                      : "red",
                }}
              >
                {row.hbd_savings_balance ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    row.eth_address &&
                    row.eth_address !==
                      "0x0000000000000000000000000000000000000000"
                      ? "green"
                      : "red",
                }}
              >
                <a
                  href={`https://app.zerion.io/${row.eth_address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.eth_address ? formatEthAddress(row.eth_address) : "N/A"}
                </a>
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.gnars_balance ?? 0) > 10
                      ? "green"
                      : (row.gnars_balance ?? 0) > 0
                      ? "yellow"
                      : "red",
                }}
              >
                {row.gnars_balance ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.gnars_votes ?? 0) > 10
                      ? "green"
                      : (row.gnars_votes ?? 0) > 0
                      ? "yellow"
                      : "red",
                }}
              >
                {row.gnars_votes ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.skatehive_nft_balance ?? 0) > 10
                      ? "green"
                      : (row.skatehive_nft_balance ?? 0) > 0
                      ? "yellow"
                      : "red",
                }}
              >
                {row.skatehive_nft_balance ?? "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color: row.has_voted_in_witness ? "green" : "red",
                }}
              >
                {row.has_voted_in_witness ? "Yes" : "No"}
              </td>
              {/* <td style={{ border: '1px solid #ddd', padding: '6px' }}>{row.eth_total_balance ?? 'N/A'}</td> */}
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    row.last_updated &&
                    new Date(row.last_updated) <
                      new Date(new Date().setDate(new Date().getDate() - 1))
                      ? "red"
                      : "green",
                }}
              >
                {row.last_updated
                  ? new Date(row.last_updated).toLocaleString()
                  : "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    row.last_post &&
                    new Date(row.last_post) <
                      new Date(
                        new Date().setFullYear(new Date().getFullYear() - 1)
                      )
                      ? "red"
                      : "green",
                }}
              >
                {row.last_post
                  ? new Date(row.last_post).toLocaleString()
                  : "N/A"}
              </td>
              <td
                style={{
                  border: "1px solid #ddd",
                  padding: "6px",
                  color:
                    (row.post_count ?? 0) === 0
                      ? "red"
                      : (row.post_count ?? 0) > 100
                      ? "green"
                      : "yellow",
                }}
              >
                {row.post_count ?? "N/A"}
              </td>
              <td style={{ border: "1px solid #ddd", padding: "6px" }}>
                {row.giveth_donations_usd ?? "N/A"}
              </td>
              <td
                style={{ border: "1px solid #ddd", padding: "6px" }}
                title={
                  `Hive Balance Points: ${Math.min(
                    row.hive_balance ?? 0,
                    1000
                  )} * 0.1 = ${(
                    Math.min(row.hive_balance ?? 0, 1000) * 0.1
                  ).toFixed(2)}\n` +
                  `HP Points: ${Math.min(
                    row.hp_balance ?? 0,
                    12000
                  )} * 0.5 = ${(
                    Math.min(row.hp_balance ?? 0, 12000) * 0.5
                  ).toFixed(2)}\n` +
                  `Gnars Votes Points: ${row.gnars_votes ?? 0} * 30 = ${
                    (row.gnars_votes ?? 0) * 30
                  }\n` +
                  `Skatehive NFT Points: ${
                    row.skatehive_nft_balance ?? 0
                  } * 50 = ${(row.skatehive_nft_balance ?? 0) * 50}\n` +
                  `Witness Vote Points: ${
                    row.has_voted_in_witness ? 1000 : 0
                  }\n` +
                  `HBD Savings Points: ${Math.min(
                    row.hbd_savings_balance ?? 0,
                    1000
                  )} * 0.2 = ${(
                    Math.min(row.hbd_savings_balance ?? 0, 1000) * 0.2
                  ).toFixed(2)}\n` +
                  `Post Count Points: ${Math.min(
                    row.post_count ?? 0,
                    3000
                  )} * 0.1 = ${Math.min(row.post_count ?? 0, 3000) * 0.1}\n` +
                  `Voting Power Points: ${
                    row.max_voting_power_usd ?? 0
                  } * 1000 = ${((row.max_voting_power_usd ?? 0) * 1000).toFixed(
                    2
                  )}\n` +
                  `ETH Wallet Bonus: ${
                    row.eth_address &&
                    row.eth_address !==
                      "0x0000000000000000000000000000000000000000"
                      ? 5000
                      : 0
                  }\n` +
                  `ETH Wallet Penalty: ${
                    !row.eth_address ||
                    row.eth_address ===
                      "0x0000000000000000000000000000000000000000"
                      ? -2000
                      : 0
                  }\n` +
                  `Donation Points: ${
                    row.giveth_donations_usd !== null
                      ? Math.min(row.giveth_donations_usd, 1000) * 5
                      : 0
                  }\n` +
                  `Zero Hive Balance Penalty: ${
                    row.hive_balance === 0 ? -1000 : 0
                  }\n` +
                  `Zero HP Balance Penalty: ${
                    row.hp_balance === 0 ? -5000 : 0
                  }\n` +
                  `Zero Gnars Votes Penalty: ${
                    row.gnars_votes === 0 ? -300 : 0
                  }\n` +
                  `Zero Skatehive NFT Balance Penalty: ${
                    row.skatehive_nft_balance === 0 ? -900 : 0
                  }\n` +
                  `Zero HBD Savings Balance Penalty: ${
                    row.hbd_savings_balance === 0 ? -200 : 0
                  }\n` +
                  `Zero Post Count Penalty: ${
                    row.post_count === 0 ? -2000 : 0
                  }\n` +
                  `----------------------------------------\n` +
                  `Total Points: ${(
                    Math.min(row.hive_balance ?? 0, 1000) * 0.1 +
                    Math.min(row.hp_balance ?? 0, 12000) * 0.5 +
                    (row.gnars_votes ?? 0) * 30 +
                    (row.skatehive_nft_balance ?? 0) * 50 +
                    (row.has_voted_in_witness ? 1000 : 0) +
                    Math.min(row.hbd_savings_balance ?? 0, 1000) * 0.2 +
                    Math.min(row.post_count ?? 0, 3000) * 0.1 +
                    (row.max_voting_power_usd ?? 0) * 1000 +
                    (row.eth_address &&
                    row.eth_address !==
                      "0x0000000000000000000000000000000000000000"
                      ? 5000
                      : 0) +
                    (!row.eth_address ||
                    row.eth_address ===
                      "0x0000000000000000000000000000000000000000"
                      ? -2000
                      : 0) -
                    Math.min(
                      row.last_post
                        ? Math.floor(
                            (Date.now() - new Date(row.last_post).getTime()) /
                              (1000 * 60 * 60 * 24)
                          )
                        : 100,
                      100
                    ) +
                    (row.giveth_donations_usd !== null
                      ? Math.min(row.giveth_donations_usd, 1000) * 5
                      : 0) +
                    (row.hive_balance === 0 ? -1000 : 0) +
                    (row.hp_balance === 0 ? -5000 : 0) +
                    (row.gnars_votes === 0 ? -300 : 0) +
                    (row.skatehive_nft_balance === 0 ? -900 : 0) +
                    (row.hbd_savings_balance === 0 ? -200 : 0) +
                    (row.post_count === 0 ? -2000 : 0)
                  ).toFixed(2)}`
                }
              >
                {row.points ?? "N/A"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
