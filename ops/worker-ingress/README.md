# Worker ingress (2026-09-19)

## Topology

Browser → `https://transcode.skatehive.app` (Oracle Caddy, automatic TLS):

- `/transcode`, `/healthz`, `/progress/*`: local Oracle worker `127.0.0.1:8081`.
- `/macmini/video/*`: strip prefix → Oracle loopback `18081` → SSH → Mac `8081`.
- `/macmini/instagram/*`: strip prefix → Oracle loopback `16666` → SSH → Mac `6666`.

Large upload bodies never go through Vercel. Caddy preserves streaming/SSE,
limits bodies to 512 MB, and does not replay POST requests. Application code
selects another worker on failure/capacity exhaustion. Both production registries
must use these URLs; public Funnel is retained only for legacy clients.

The Mac initiates an encrypted outbound SSH connection. `launchd` restarts it;
15-second heartbeats detect dead connections after three missed responses.
`ExitOnForwardFailure` avoids a running process with missing listeners.
Listeners MUST bind to 127.0.0.1; sshd `GatewayPorts no` must remain enabled.
Existing host key verification and the existing protected SSH identity are used.
No private keys or environment secrets are stored in this directory.

## Installation / recovery

1. Ensure existing SSH access from Mac to Oracle is working and both local
   workers pass `/healthz`. Do not interrupt active jobs.
2. Run `python3 install-tunnel.py --identity /absolute/path/to/existing/key
   --host ubuntu@146.235.239.243 --state-dir /absolute/path/to/runtime-state`.
   This installs the persistent user LaunchAgent (at login), not a LaunchDaemon.
   Docker on this Mac also runs in the user session; unattended boot requires
   the existing login/Docker startup arrangement. A reboot was NOT tested.
3. On Oracle, back up `/home/ubuntu/Caddyfile`, stage this Caddyfile and run
   `docker exec caddy caddy validate --config <staged-container-path> --adapter caddyfile`.
   Write validated content into the existing bind-mounted file (do not replace
   its inode), then `docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
   Reload is graceful; do not restart workers or Caddy during active uploads.
4. Check HTTPS health on all three paths, browser Origin CORS and actual upload
   through each worker. Check the CID through the public IPFS gateway.
5. Inspect API `/api/status` and `/api/transcode/status` after publication.

## Verification and monitoring

- API status probes the SAME public routes used by uploads, not localhost.
- `launchctl print gui/$(id -u)/app.skatehive.worker-tunnel` reports supervision.
- Oracle `ss -lnt` must show ports 18081/16666 on loopback only.
- Controlled tunnel-process termination before cutover recovered in 4.07 seconds.
- A real MP4 uploaded through the Mac route returned HTTP 200 and an IPFS CID.
- Client tests cover offline/busy failover, malformed health, stalled JSON body
  and missing CID (`pnpm test:video-upload` in the web app).

## Limits (do not claim zero-downtime or resumability)

Oracle is a shared ingress failure domain: two workers are NOT two independent
public entry points. SSH reconnection does not resume an in-flight POST. The
current client may re-upload after a broken connection; jobs/results are not a
durable resumable queue. Unchanged mobile/older clients still using Funnel need
an update. Full ingress HA and resumable uploads are separate architecture work.

## Rollback

Revert app/API changes first if necessary. Existing Oracle root endpoints and
Funnel remain unchanged. Restore the saved Caddyfile content and reload only
after no requests use new paths. Boot out the LaunchAgent and remove its
LaunchAgents plist only after draining the new Mac routes; never remove data
volumes. Do not restart the worker containers to roll back ingress.
