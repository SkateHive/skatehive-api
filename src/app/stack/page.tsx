"use client";

import { Fragment } from "react";
import type { CSSProperties } from "react";
import Nav from "../components/Nav";

/* -------------------------------------------------------------------------- */
/*  Architecture flowchart — the tech that powers Skatehive                   */
/* -------------------------------------------------------------------------- */

type IconName =
  | "globe"
  | "phone"
  | "gauge"
  | "server"
  | "film"
  | "download"
  | "box"
  | "database"
  | "chain"
  | "diamond"
  | "hex";

type ArchNode = { icon: IconName; name: string; tech: string };

type ArchLayer = {
  id: string;
  index: string;
  label: string;
  color: string;
  desc: string;
  nodes: ArchNode[];
};

const ARCH_LAYERS: ArchLayer[] = [
  {
    id: "clients",
    index: "01",
    label: "clients",
    color: "var(--green)",
    desc: "what skaters touch",
    nodes: [
      { icon: "globe", name: "skatehive.app", tech: "Next.js 15 · web" },
      { icon: "phone", name: "mobile app", tech: "Expo · React Native" },
      { icon: "gauge", name: "dashboard", tech: "Next.js · admin" },
    ],
  },
  {
    id: "services",
    index: "02",
    label: "services",
    color: "var(--blue)",
    desc: "self-hosted · Mac Mini M4 + Oracle · Tailscale mesh",
    nodes: [
      { icon: "server", name: "skatehive-api", tech: "Hive aggregator · feed" },
      { icon: "film", name: "video-transcoder", tech: "FFmpeg → H.264 / MP4" },
      { icon: "download", name: "insta-downloader", tech: "yt-dlp ingestion" },
    ],
  },
  {
    id: "storage",
    index: "03",
    label: "storage & index",
    color: "var(--amber)",
    desc: "where media + data live",
    nodes: [
      { icon: "box", name: "IPFS / Pinata", tech: "media files · CIDs" },
      { icon: "database", name: "Supabase", tech: "Postgres · leaderboard" },
    ],
  },
  {
    id: "protocol",
    index: "04",
    label: "protocol",
    color: "var(--purple)",
    desc: "decentralized source of truth",
    nodes: [
      { icon: "chain", name: "Hive", tech: "posts · votes · rewards" },
      { icon: "diamond", name: "Base / Ethereum", tech: "DAO · NFTs · $token" },
      { icon: "hex", name: "Farcaster", tech: "auth · frames" },
    ],
  },
];

const JOURNEY = [
  "capture",
  "transcode / ingest",
  "pin to IPFS",
  "post to Hive",
  "api indexes",
  "hits the feed",
];

export default function StackPage() {
  return (
    <div className="wrapper">
      <div className="shell">
        <Nav active="stack" />

        <section className="arch">
          <div className="arch-head">
            <p className="prompt">
              <span className="user">root@skatehive</span>
              <span className="path">:~/services</span>
              <span className="dollar">$</span>{" "}
              <span className="cmd">./topology --render</span>
            </p>
            <h1 className="arch-title">// the stack that powers skatehive</h1>
            <p className="arch-sub">
              open-source, decentralized, and skater-owned — from upload to feed.
            </p>
          </div>

          <div className="arch-flow">
            {ARCH_LAYERS.map((layer, i) => (
              <Fragment key={layer.id}>
                <div
                  className="layer"
                  style={{ "--accent": layer.color } as CSSProperties}
                >
                  <div className="layer-label">
                    <span className="layer-index">{layer.index}</span>
                    <span className="layer-name">{layer.label}</span>
                    <span className="layer-desc">{layer.desc}</span>
                  </div>
                  <div className="layer-nodes">
                    {layer.nodes.map((node) => (
                      <div className="anode" key={node.name}>
                        <span className="anode-icon">
                          <Icon name={node.icon} />
                        </span>
                        <span className="anode-text">
                          <span className="anode-name">{node.name}</span>
                          <span className="anode-tech">{node.tech}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {i < ARCH_LAYERS.length - 1 && (
                  <div className="connector" aria-hidden>
                    <span className="conn-line" />
                    <span className="packet" />
                    <span className="chev">▼</span>
                  </div>
                )}
              </Fragment>
            ))}
          </div>

          <div className="journey">
            <span className="journey-label">content journey</span>
            <div className="journey-track">
              {JOURNEY.map((step, i) => (
                <Fragment key={step}>
                  <span className="journey-step">{step}</span>
                  {i < JOURNEY.length - 1 && (
                    <span className="journey-arrow">▶</span>
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        <footer className="foot">
          <span>skatehive.app // architecture</span>
          <span className="cursor">_</span>
        </footer>
      </div>

      <style jsx>{`
        :global(:root) {
          --bg: #0a0d0a;
          --panel: #0e120e;
          --line: #1d2a1d;
          --line-soft: #162016;
          --text: #cfe8c4;
          --muted: #6f8a6a;
          --green: #8dff3a;
          --green-dim: #5bbf2a;
          --amber: #ffc043;
          --red: #ff5c5c;
          --blue: #7fb0ff;
          --purple: #c98bff;
        }

        :global(body) {
          background: #0a0d0a;
        }

        .wrapper {
          min-height: 100vh;
          background:
            repeating-linear-gradient(
              0deg,
              rgba(141, 255, 58, 0.025) 0px,
              rgba(141, 255, 58, 0.025) 1px,
              transparent 1px,
              transparent 3px
            ),
            #0a0d0a;
          color: #cfe8c4;
          padding: 40px 18px 60px;
          font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, "Menlo",
            "Consolas", monospace;
          font-size: 14px;
          line-height: 1.5;
        }

        .shell {
          max-width: 1100px;
          margin: 0 auto;
        }

        .arch {
          border: 1px solid var(--line);
          background: var(--panel);
        }

        .arch-head {
          padding: 18px 18px 4px;
        }
        .prompt {
          font-size: 13px;
          color: var(--text);
          word-break: break-word;
        }
        .user {
          color: var(--green);
          font-weight: 700;
        }
        .path {
          color: var(--blue);
        }
        .dollar {
          color: var(--muted);
        }
        .arch-title {
          margin-top: 12px;
          font-size: clamp(18px, 3vw, 26px);
          font-weight: 700;
          color: var(--green);
          letter-spacing: 0.01em;
        }
        .arch-sub {
          margin-top: 4px;
          color: var(--muted);
          font-size: 13px;
        }

        .arch-flow {
          padding: 14px 18px 6px;
        }

        .layer {
          border: 1px solid var(--line);
          border-left: 3px solid var(--accent);
          background: #0a0e0a;
          padding: 12px 14px 14px;
        }

        .layer-label {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 12px;
        }
        .layer-index {
          color: var(--accent);
          font-weight: 700;
          font-size: 12px;
          opacity: 0.8;
        }
        .layer-name {
          color: var(--accent);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          font-size: 13px;
        }
        .layer-desc {
          color: var(--muted);
          font-size: 12px;
        }

        .layer-nodes {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 10px;
        }

        .anode {
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid var(--line);
          background: #0c110c;
          padding: 12px 13px;
          transition: border-color 0.15s ease, transform 0.15s ease,
            box-shadow 0.15s ease;
        }
        .anode:hover {
          border-color: var(--accent);
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
        }

        .anode-icon {
          flex: none;
          width: 38px;
          height: 38px;
          display: grid;
          place-items: center;
          border: 1px solid var(--accent);
          color: var(--accent);
          background: rgba(0, 0, 0, 0.25);
        }
        .anode-icon :global(svg) {
          width: 20px;
          height: 20px;
        }

        .anode-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .anode-name {
          color: var(--text);
          font-weight: 700;
          font-size: 14px;
        }
        .anode-tech {
          color: var(--muted);
          font-size: 11px;
        }

        .connector {
          position: relative;
          height: 34px;
          display: grid;
          place-items: center;
        }
        .conn-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: linear-gradient(
            180deg,
            transparent,
            var(--line) 20%,
            var(--line) 80%,
            transparent
          );
        }
        .chev {
          color: var(--green-dim);
          font-size: 12px;
          line-height: 1;
          background: var(--panel);
          padding: 2px 0;
          z-index: 1;
        }
        .packet {
          position: absolute;
          top: 2px;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--green);
          box-shadow: 0 0 8px var(--green);
          animation: drop 2.4s ease-in-out infinite;
        }
        @keyframes drop {
          0% {
            transform: translateY(0);
            opacity: 0;
          }
          15% {
            opacity: 1;
          }
          85% {
            opacity: 1;
          }
          100% {
            transform: translateY(28px);
            opacity: 0;
          }
        }

        .journey {
          margin: 8px 18px 20px;
          border: 1px solid var(--line);
          border-top: 2px solid var(--green-dim);
          background: #0a0e0a;
          padding: 14px;
        }
        .journey-label {
          display: block;
          color: var(--muted);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          margin-bottom: 10px;
        }
        .journey-track {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px 10px;
        }
        .journey-step {
          color: var(--text);
          font-size: 13px;
          border: 1px solid var(--line);
          padding: 5px 11px;
          background: #0c110c;
          white-space: nowrap;
        }
        .journey-arrow {
          color: var(--green);
          font-size: 11px;
        }

        .foot {
          margin-top: 30px;
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--muted);
          font-size: 12px;
        }
        .cursor {
          color: var(--green);
          animation: blink 1.1s steps(1) infinite;
        }
        @keyframes blink {
          50% {
            opacity: 0;
          }
        }

        @media (max-width: 640px) {
          .layer-nodes {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function Icon({ name }: { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
        </svg>
      );
    case "phone":
      return (
        <svg {...common}>
          <rect x="7" y="2.5" width="10" height="19" rx="2" />
          <line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
        </svg>
      );
    case "gauge":
      return (
        <svg {...common}>
          <path d="M4 18a8 8 0 1 1 16 0" />
          <line x1="12" y1="18" x2="15.5" y2="11.5" />
          <circle cx="12" cy="18" r="1.2" />
        </svg>
      );
    case "server":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <line x1="6.5" y1="7.5" x2="6.5" y2="7.5" />
          <line x1="6.5" y1="16.5" x2="6.5" y2="16.5" />
        </svg>
      );
    case "film":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="8" y1="4" x2="8" y2="20" />
          <line x1="16" y1="4" x2="16" y2="20" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="M7 11l5 5 5-5" />
          <path d="M4 21h16" />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
          <path d="M4 7.5 12 12l8-4.5" />
          <path d="M12 12v9" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="7" ry="3" />
          <path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
      );
    case "chain":
      return (
        <svg {...common}>
          <path d="M9.5 12a3 3 0 0 1 3-3h2a3 3 0 0 1 0 6h-1" />
          <path d="M14.5 12a3 3 0 0 1-3 3h-2a3 3 0 0 1 0-6h1" />
        </svg>
      );
    case "diamond":
      return (
        <svg {...common}>
          <path d="M12 2 22 12 12 22 2 12z" />
        </svg>
      );
    case "hex":
      return (
        <svg {...common}>
          <path d="M12 2 21 7v10l-9 5-9-5V7z" />
        </svg>
      );
    default:
      return null;
  }
}
