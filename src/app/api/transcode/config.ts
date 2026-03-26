// Shared configuration for transcode services
// All servers run the same SkateHive video-transcoder codebase
// Priority order: Mac Mini M4 (fastest) → Oracle (cloud) → Raspberry Pi (backup)
export const TRANSCODE_SERVICES = [
  {
    priority: 1,
    name: 'Mac Mini M4 (Primary)',
    healthUrl: 'https://minivlad.tail83ea3e.ts.net/video/healthz',
    transcodeUrl: 'https://minivlad.tail83ea3e.ts.net/video/transcode'
  },
  {
    priority: 2,
    name: 'Oracle (Secondary)',
    healthUrl: 'https://146-235-239-243.sslip.io/healthz',
    transcodeUrl: 'https://146-235-239-243.sslip.io/transcode'
  },
  {
    priority: 3,
    name: 'Raspberry Pi (Fallback)',
    healthUrl: 'https://vladsberry.tail83ea3e.ts.net/video/healthz',
    transcodeUrl: 'https://vladsberry.tail83ea3e.ts.net/video/transcode'
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
