// Shared configuration for transcode services
// All servers run the same SkateHive video-transcoder codebase
// Priority order: Oracle (public IP, browser-reachable) → Mac Mini M4 (fallback)
// NOTE: Mac Mini uses Tailscale Funnel which fails for large browser POST uploads.
// Browsers cannot reach Tailscale Funnel URLs for multipart uploads, only health GETs via server-side proxy.
export const TRANSCODE_SERVICES = [
  {
    priority: 1,
    name: 'Oracle (Primary)',
    healthUrl: 'https://transcode.skatehive.app/healthz',
    transcodeUrl: 'https://transcode.skatehive.app/transcode'
  },
  {
    priority: 2,
    name: 'Mac Mini M4 (Secondary)',
    healthUrl: 'https://minivlad.tail83ea3e.ts.net/video/healthz',
    transcodeUrl: 'https://minivlad.tail83ea3e.ts.net/video/transcode'
  }
];

export interface ServiceConfig {
  priority: number;
  name: string;
  healthUrl: string;
  transcodeUrl: string;
}

export interface ServiceStatus extends ServiceConfig {
  isHealthy: boolean;
  responseTime?: number;
  error?: string;
  lastChecked: string;
}
