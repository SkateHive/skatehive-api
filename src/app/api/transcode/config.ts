// Shared configuration for transcode services.
// All servers run the same SkateHive video-transcoder codebase.
// Priority order reflects the current production routing.
// NOTE: Mac Mini uses Tailscale Funnel. Keep Oracle primary for browser uploads;
// large multipart POST uploads can be unreliable through Funnel, while health/status
// checks can safely include Mac Mini.
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
