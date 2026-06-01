"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

type HealthStatus = "operational" | "degraded" | "down";

type ServiceHealth = {
  id: string;
  name: string;
  category: string;
  description: string;
  healthUrl: string;
  isHealthy: boolean;
  responseTime?: number;
  error?: string;
  lastChecked: string;
};

type StatusResponse = {
  status: HealthStatus;
  timestamp: string;
  summary?: {
    healthy: number;
    total: number;
  };
  services: ServiceHealth[];
  error?: string;
};

const STATUS_TEXT: Record<HealthStatus, { label: string; tone: Tone }> = {
  operational: { label: "ALL SYSTEMS OPERATIONAL", tone: "ok" },
  degraded: { label: "DEGRADED — PARTIAL OUTAGE", tone: "warn" },
  down: { label: "SYSTEMS UNAVAILABLE", tone: "down" },
};

type Tone = "ok" | "warn" | "down";

const POLL_MS = 30000;

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const res = await fetch("/api/status");
      if (!res.ok && res.status !== 503) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as StatusResponse;
      setData(json);
      setFetchError(null);
    } catch (error) {
      setFetchError(
        error instanceof Error ? error.message : "Failed to load status"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const machines = useMemo(() => {
    if (!data) return [];

    const groups: {
      id: string;
      label: string;
      host: string;
      note: string;
      image: string;
      services: ServiceHealth[];
    }[] = [
      {
        id: "macmini",
        label: "mac-mini-m4",
        host: "minivlad.tail83ea3e.ts.net",
        note: "primary edge node · IG pulls · video transcoding",
        image: "/macmini.png",
        services: [],
      },
      {
        id: "oracle",
        label: "oracle-cloud",
        host: "transcode.skatehive.app",
        note: "HA transcoding · API uptime",
        image: "/oracle-server.png",
        services: [],
      },
      {
        id: "other",
        label: "shared-services",
        host: "external",
        note: "providers outside the core stack",
        image: "/oracle-server.png",
        services: [],
      },
    ];

    const byId = groups.reduce(
      (acc, group) => {
        acc[group.id] = group;
        return acc;
      },
      {} as Record<string, (typeof groups)[number]>
    );

    data.services.forEach((service) => {
      const url = service.healthUrl.toLowerCase();
      const name = service.name.toLowerCase();

      if (url.includes("minivlad") || name.includes("mac mini")) {
        byId.macmini.services.push(service);
        return;
      }

      if (url.includes("oracle") || url.includes("sslip.io") || url.includes("transcode.skatehive") || name.includes("oracle")) {
        byId.oracle.services.push(service);
        return;
      }

      byId.other.services.push(service);
    });

    return groups.filter((group) => group.services.length > 0);
  }, [data]);

  const overallStatus = data?.status ?? "degraded";
  const statusCopy = STATUS_TEXT[overallStatus];
  const lastUpdated = data?.timestamp
    ? new Date(data.timestamp).toLocaleTimeString([], { hour12: false })
    : "--:--:--";
  const healthy = data?.summary?.healthy ?? 0;
  const total = data?.summary?.total ?? 0;
  const uptimePct = total > 0 ? Math.round((healthy / total) * 100) : 0;

  return (
    <div className="wrapper">
      <div className="shell">
        {/* terminal window chrome */}
        <div className="window">
          <div className="titlebar">
            <span className="dots">
              <i className="d red" />
              <i className="d yellow" />
              <i className="d green" />
            </span>
            <span className="titletext">skatehive@status — monitor</span>
            <span className="titleright">{loading ? "syncing…" : "live"}</span>
          </div>

          <div className="terminal">
            <p className="prompt">
              <span className="user">root@skatehive</span>
              <span className="path">:~/services</span>
              <span className="dollar">$</span>{" "}
              <span className="cmd">./status --watch --interval={Math.round(POLL_MS / 1000)}s</span>
            </p>

            <div className="headrow">
              <div className={`headline tone-${statusCopy.tone}`}>
                <span className="blip" />
                <div className="headline-copy">
                  <span className="headline-text">{statusCopy.label}</span>
                  <span className="headline-sub">
                    {healthy}/{total} services responding · updated {lastUpdated}
                  </span>
                </div>
              </div>

              <button
                className="btn"
                onClick={() => load()}
                disabled={loading}
              >
                {loading ? "syncing…" : "↻ refresh"}
              </button>
            </div>

            <div className="statline">
              <Stat label="healthy" value={`${healthy}/${total}`} tone={statusCopy.tone} />
              <Stat label="uptime" value={`${uptimePct}%`} tone={statusCopy.tone} />
              <Stat label="last_check" value={lastUpdated} tone="muted" />
              <Stat label="poll" value={`${Math.round(POLL_MS / 1000)}s`} tone="muted" />
            </div>

            {fetchError && (
              <p className="fetch-error">! fetch error: {fetchError}</p>
            )}
          </div>
        </div>

        {machines.length === 0 && !loading ? (
          <p className="empty">// no services to display</p>
        ) : (
          machines.map((machine) => {
            const up = machine.services.filter((s) => s.isHealthy).length;
            const groupTone: Tone =
              up === machine.services.length
                ? "ok"
                : up === 0
                  ? "down"
                  : "warn";

            return (
              <section className="node" key={machine.id}>
                <div className="node-head">
                  <span className="node-thumb">
                    <img src={machine.image} alt={machine.label} />
                  </span>
                  <span className={`node-led tone-${groupTone}`} />
                  <span className="node-name">{machine.label}</span>
                  <span className="node-host">{machine.host}</span>
                  <span className="node-count">
                    [{up}/{machine.services.length} up]
                  </span>
                  <span className="node-note">{machine.note}</span>
                </div>

                <div className="table">
                  <div className="row row-head">
                    <span className="c-status">status</span>
                    <span className="c-name">service</span>
                    <span className="c-cat">type</span>
                    <span className="c-time">resp</span>
                    <span className="c-check">checked</span>
                  </div>

                  {machine.services.map((service) => (
                    <div className="row" key={service.id}>
                      <span className="c-status">
                        <span
                          className={`badge ${service.isHealthy ? "tone-ok" : "tone-down"}`}
                        >
                          {service.isHealthy ? "[ OK ]" : "[FAIL]"}
                        </span>
                      </span>
                      <span className="c-name">
                        <span className="svc-name">{service.name}</span>
                        <span className="svc-url">{service.healthUrl}</span>
                        {service.error && (
                          <span className="svc-error">↳ {service.error}</span>
                        )}
                      </span>
                      <span className="c-cat">
                        <span className="cat">{service.category}</span>
                      </span>
                      <span className="c-time">
                        {service.responseTime != null ? (
                          <span className={respClass(service.responseTime)}>
                            {service.responseTime}ms
                          </span>
                        ) : (
                          <span className="muted">--</span>
                        )}
                      </span>
                      <span className="c-check muted">
                        {new Date(service.lastChecked).toLocaleTimeString([], {
                          hour12: false,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}

        <Architecture />

        <footer className="foot">
          <span>skatehive.app // systems monitor</span>
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
          font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace,
            "Menlo", "Consolas", monospace;
          font-size: 14px;
          line-height: 1.5;
        }

        .shell {
          max-width: 1100px;
          margin: 0 auto;
        }

        /* ---- terminal window ---- */
        .window {
          border: 1px solid var(--line);
          background: #0c100c;
          box-shadow: 0 0 0 1px #000 inset;
        }

        .titlebar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: #0e130e;
          border-bottom: 1px solid var(--line);
        }

        .dots {
          display: inline-flex;
          gap: 7px;
        }

        .d {
          width: 11px;
          height: 11px;
          border-radius: 50%;
          display: inline-block;
        }
        .d.red {
          background: #ff5c5c;
        }
        .d.yellow {
          background: #ffc043;
        }
        .d.green {
          background: #8dff3a;
        }

        .titletext {
          color: var(--muted);
          font-size: 12px;
          letter-spacing: 0.04em;
        }

        .titleright {
          margin-left: auto;
          color: var(--green-dim);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .terminal {
          padding: 18px 18px 20px;
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
          color: #7fb0ff;
        }
        .dollar {
          color: var(--muted);
        }
        .cmd {
          color: var(--text);
        }

        .headrow {
          display: flex;
          align-items: stretch;
          gap: 12px;
          margin-top: 18px;
        }

        .headline {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 12px 16px;
          border: 1px solid var(--line);
          border-left-width: 3px;
          background: #0a0e0a;
        }

        .headline-copy {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .headline-text {
          font-size: clamp(15px, 2.4vw, 21px);
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1.15;
        }

        .headline-sub {
          font-size: 12px;
          color: var(--muted);
          letter-spacing: 0.01em;
        }

        .blip {
          width: 12px;
          height: 12px;
          flex: none;
          border-radius: 2px;
          animation: pulse 1.4s ease-in-out infinite;
        }

        .tone-ok {
          color: var(--green);
        }
        .tone-ok .blip,
        .blip.tone-ok {
          background: var(--green);
        }
        .tone-warn {
          color: var(--amber);
        }
        .tone-warn .blip,
        .blip.tone-warn {
          background: var(--amber);
        }
        .tone-down {
          color: var(--red);
        }
        .tone-down .blip,
        .blip.tone-down {
          background: var(--red);
        }
        .headline.tone-ok {
          border-left-color: var(--green);
        }
        .headline.tone-warn {
          border-left-color: var(--amber);
        }
        .headline.tone-down {
          border-left-color: var(--red);
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.25;
          }
        }

        /* ---- stats ---- */
        .statline {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 14px;
        }

        .btn {
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          color: var(--green);
          background: transparent;
          border: 1px solid var(--green-dim);
          padding: 0 18px;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s ease, color 0.12s ease;
        }
        .btn:hover:not(:disabled) {
          background: var(--green);
          color: #061200;
        }
        .btn:disabled {
          color: var(--muted);
          border-color: var(--line);
          cursor: progress;
        }

        .fetch-error {
          color: var(--red);
          font-size: 12px;
          margin-top: 12px;
        }

        /* ---- node sections ---- */
        .node {
          margin-top: 26px;
          border: 1px solid var(--line);
          background: var(--panel);
        }

        .node-head {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--line);
          background: #0e130e;
        }

        .node-thumb {
          flex: none;
          width: 44px;
          height: 44px;
          border: 1px solid var(--line);
          overflow: hidden;
          background: #060906;
        }
        .node-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          filter: grayscale(0.3) brightness(1.05) saturate(1.1);
        }

        .node-led {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex: none;
        }
        .node-led.tone-ok {
          background: var(--green);
          box-shadow: 0 0 8px rgba(141, 255, 58, 0.7);
        }
        .node-led.tone-warn {
          background: var(--amber);
          box-shadow: 0 0 8px rgba(255, 192, 67, 0.6);
        }
        .node-led.tone-down {
          background: var(--red);
          box-shadow: 0 0 8px rgba(255, 92, 92, 0.6);
        }

        .node-name {
          color: var(--green);
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .node-host {
          color: #7fb0ff;
          font-size: 12px;
        }
        .node-count {
          color: var(--muted);
          font-size: 12px;
        }
        .node-note {
          margin-left: auto;
          color: var(--muted);
          font-size: 12px;
        }

        /* ---- service table ---- */
        .table {
          display: flex;
          flex-direction: column;
        }

        .row {
          display: grid;
          grid-template-columns: 78px 1fr 160px 70px 90px;
          gap: 12px;
          align-items: start;
          padding: 11px 14px;
          border-bottom: 1px solid var(--line-soft);
        }
        .row:last-child {
          border-bottom: none;
        }
        .row:not(.row-head):hover {
          background: #101610;
        }

        .row-head {
          color: var(--muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          padding-top: 9px;
          padding-bottom: 9px;
          background: #0b0f0b;
        }

        .badge {
          font-weight: 700;
          font-size: 13px;
          white-space: nowrap;
        }

        .c-name {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .svc-name {
          color: var(--text);
          font-weight: 700;
        }
        .svc-url {
          color: var(--muted);
          font-size: 11px;
          overflow-wrap: anywhere;
        }
        .svc-error {
          color: var(--red);
          font-size: 11px;
          overflow-wrap: anywhere;
        }

        .cat {
          color: #9fd08f;
          font-size: 11px;
          border: 1px solid var(--line);
          padding: 2px 6px;
          display: inline-block;
        }

        .c-time {
          font-size: 13px;
        }
        .resp-fast {
          color: var(--green);
        }
        .resp-mid {
          color: var(--amber);
        }
        .resp-slow {
          color: var(--red);
        }

        .c-check {
          font-size: 12px;
        }

        .muted {
          color: var(--muted);
        }

        .empty {
          margin-top: 26px;
          color: var(--muted);
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

        @media (max-width: 760px) {
          .headrow {
            flex-direction: column;
          }
          .btn {
            padding: 10px 18px;
          }
          .row {
            grid-template-columns: 70px 1fr;
            gap: 6px 10px;
          }
          .row-head .c-cat,
          .row-head .c-time,
          .row-head .c-check {
            display: none;
          }
          .c-cat,
          .c-time,
          .c-check {
            grid-column: 2;
            font-size: 11px;
          }
          .node-note {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone | "muted";
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value tone-${tone}`}>{value}</span>
      <style jsx>{`
        .stat {
          display: flex;
          flex-direction: column;
          gap: 2px;
          border: 1px solid var(--line);
          padding: 7px 12px;
          min-width: 96px;
          background: #0a0e0a;
        }
        .stat-label {
          color: var(--muted);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
        }
        .stat-value {
          font-size: 16px;
          font-weight: 700;
        }
        .tone-ok {
          color: var(--green);
        }
        .tone-warn {
          color: var(--amber);
        }
        .tone-down {
          color: var(--red);
        }
        .tone-muted {
          color: var(--text);
        }
      `}</style>
    </div>
  );
}

function respClass(ms: number): string {
  if (ms < 500) return "resp-fast";
  if (ms < 2000) return "resp-mid";
  return "resp-slow";
}

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
    desc: "self-hosted · Mac Mini M4 + RPi 5 · Tailscale mesh",
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

function Architecture() {
  return (
    <section className="arch">
      <div className="arch-head">
        <p className="prompt">
          <span className="user">root@skatehive</span>
          <span className="path">:~/services</span>
          <span className="dollar">$</span>{" "}
          <span className="cmd">./topology --render</span>
        </p>
        <h2 className="arch-title">// the stack that powers skatehive</h2>
        <p className="arch-sub">
          open-source, decentralized, and skater-owned — from upload to feed.
        </p>
      </div>

      <div className="arch-flow">
        {ARCH_LAYERS.map((layer, i) => (
          <Fragment key={layer.id}>
            <div className="layer" style={{ "--accent": layer.color } as CSSProperties}>
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
              {i < JOURNEY.length - 1 && <span className="journey-arrow">▶</span>}
            </Fragment>
          ))}
        </div>
      </div>

      <style jsx>{`
        .arch {
          margin-top: 40px;
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
          font-size: clamp(16px, 2.6vw, 22px);
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

        /* ---- layer band ---- */
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

        /* ---- connectors between layers ---- */
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

        /* ---- content journey ---- */
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

        @media (max-width: 640px) {
          .layer-nodes {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
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
