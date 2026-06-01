"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Nav from "../components/Nav";

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
        <Nav active="status" />

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
          <p className="empty">{"// no services to display"}</p>
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

        <LogsSection />

        <Link href="/stack" className="stack-link">
          <span className="stack-link-text">
            <span className="stack-link-title">{"> view the full stack"}</span>
            <span className="stack-link-sub">
              architecture topology — clients → services → storage → protocol
            </span>
          </span>
          <span className="stack-link-arrow">→</span>
        </Link>

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

        .stack-link {
          margin-top: 26px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          border: 1px solid var(--line);
          border-left: 3px solid var(--green-dim);
          background: var(--panel);
          padding: 16px 18px;
          transition: border-color 0.15s ease, transform 0.15s ease;
        }
        .stack-link:hover {
          border-left-color: var(--green);
          transform: translateY(-2px);
        }
        .stack-link-text {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .stack-link-title {
          color: var(--green);
          font-weight: 700;
          font-size: 15px;
        }
        .stack-link-sub {
          color: var(--muted);
          font-size: 12px;
        }
        .stack-link-arrow {
          color: var(--green);
          font-size: 20px;
          font-weight: 700;
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
/*  Logs — sanitized worker activity from /api/logs                           */
/* -------------------------------------------------------------------------- */

type SourceType = "transcode" | "instagram";

type SafeEntry = {
  source: string;
  type: SourceType;
  time: string;
  status: string;
  success: boolean | null;
  durationMs?: number;
  sizeBytes?: number;
  user: string;
  fileExt?: string;
  shortCid?: string;
  platform?: string;
};

type SourceSummary = {
  id: string;
  name: string;
  type: SourceType;
  reachable: boolean;
  total?: number;
  successful?: number;
  failed?: number;
  inProgress?: number;
  successRate?: number;
  error?: string;
};

type LogsResponse = {
  timestamp: string;
  sources: SourceSummary[];
  entries: SafeEntry[];
};

const LOGS_POLL_MS = 30000;

function LogsSection() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async (bg = false) => {
    if (!bg) setLoading(true);
    try {
      const res = await fetch("/api/logs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LogsResponse;
      setData(json);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), LOGS_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const entries = data?.entries ?? [];
  const sources = data?.sources ?? [];

  return (
    <section className="logs">
      <div className="logs-head">
        <p className="prompt">
          <span className="user">root@skatehive</span>
          <span className="path">:~/services</span>
          <span className="dollar">$</span>{" "}
          <span className="cmd">tail -f ./logs --sanitized</span>
        </p>
        <h2 className="logs-title">{"// recent worker activity"}</h2>
        <p className="logs-sub">
          live from the transcode + ingestion nodes · IPs, handles, filenames
          and CIDs are stripped or masked server-side.
        </p>
      </div>

      {sources.length > 0 && (
        <div className="logs-sources">
          {sources.map((s) => (
            <div className="lsource" key={s.id}>
              <div className="lsource-top">
                <span
                  className={`lsource-led ${s.reachable ? "tone-ok" : "tone-down"}`}
                />
                <span className="lsource-name">{s.name}</span>
              </div>
              {s.reachable ? (
                <div className="lsource-stats">
                  {s.successful != null && (
                    <span className="ok">{s.successful} ok</span>
                  )}
                  {s.failed != null && (
                    <span className={s.failed > 0 ? "down" : "muted"}>
                      {s.failed} fail
                    </span>
                  )}
                  {s.inProgress != null && s.inProgress > 0 && (
                    <span className="warn">{s.inProgress} live</span>
                  )}
                  {s.successRate != null && (
                    <span className="muted">{s.successRate}% rate</span>
                  )}
                </div>
              ) : (
                <div className="lsource-stats">
                  <span className="down">unreachable</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="logstream">
        {entries.length === 0 ? (
          <p className="logs-empty">
            {loading ? "// fetching logs…" : err ? `! ${err}` : "// no recent activity"}
          </p>
        ) : (
          entries.map((e, i) => {
            const tone =
              e.success === true ? "ok" : e.success === false ? "down" : "warn";
            const badge =
              e.success === true
                ? "done"
                : e.success === false
                  ? "fail"
                  : e.status.slice(0, 7) || "live";
            const detail = [
              e.fileExt,
              e.sizeBytes != null ? fmtBytes(e.sizeBytes) : undefined,
              e.durationMs != null ? fmtDuration(e.durationMs) : undefined,
              e.shortCid,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <div className="logline" key={`${e.source}-${e.time}-${i}`}>
                <span className="ll-time">{fmtClock(e.time)}</span>
                <span className="ll-src">{sourceTag(e.source)}</span>
                <span className={`ll-badge tone-${tone}`}>{badge}</span>
                <span className="ll-user">{e.user}</span>
                <span className="ll-detail">{detail || "—"}</span>
              </div>
            );
          })
        )}
      </div>

      <style jsx>{`
        .logs {
          margin-top: 26px;
          border: 1px solid var(--line);
          background: var(--panel);
        }
        .logs-head {
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
        .logs-title {
          margin-top: 12px;
          font-size: clamp(16px, 2.6vw, 22px);
          font-weight: 700;
          color: var(--green);
        }
        .logs-sub {
          margin-top: 4px;
          color: var(--muted);
          font-size: 13px;
        }

        .logs-sources {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 10px;
          padding: 14px 18px 4px;
        }
        .lsource {
          border: 1px solid var(--line);
          background: #0a0e0a;
          padding: 10px 12px;
        }
        .lsource-top {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .lsource-led {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .lsource-led.tone-ok {
          background: var(--green);
          box-shadow: 0 0 6px rgba(141, 255, 58, 0.7);
        }
        .lsource-led.tone-down {
          background: var(--red);
          box-shadow: 0 0 6px rgba(255, 92, 92, 0.6);
        }
        .lsource-name {
          color: var(--text);
          font-weight: 700;
          font-size: 13px;
        }
        .lsource-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          font-size: 12px;
        }

        .logstream {
          padding: 10px 18px 18px;
          display: flex;
          flex-direction: column;
        }
        .logs-empty {
          color: var(--muted);
          padding: 8px 0;
        }
        .logline {
          display: grid;
          grid-template-columns: 78px 96px 54px 90px 1fr;
          gap: 10px;
          align-items: center;
          padding: 7px 0;
          border-bottom: 1px solid var(--line-soft);
          font-size: 13px;
          white-space: nowrap;
        }
        .logline:last-child {
          border-bottom: none;
        }
        .ll-time {
          color: var(--muted);
          font-size: 12px;
        }
        .ll-src {
          color: var(--blue);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ll-badge {
          font-weight: 700;
          font-size: 12px;
        }
        .ll-user {
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ll-detail {
          color: var(--muted);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tone-ok,
        .ok {
          color: var(--green);
        }
        .tone-warn,
        .warn {
          color: var(--amber);
        }
        .tone-down,
        .down {
          color: var(--red);
        }
        .muted {
          color: var(--muted);
        }

        @media (max-width: 680px) {
          .logline {
            grid-template-columns: 64px 1fr auto;
            gap: 6px 8px;
          }
          .ll-user {
            grid-column: 2;
          }
          .ll-detail {
            grid-column: 1 / -1;
            white-space: normal;
          }
        }
      `}</style>
    </section>
  );
}

function sourceTag(id: string): string {
  switch (id) {
    case "macmini-video":
      return "mac·vid";
    case "oracle-video":
      return "oracle·vid";
    case "macmini-ig":
      return "mac·ig";
    default:
      return id;
  }
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], { hour12: false });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
