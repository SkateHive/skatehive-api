import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Guards cron / admin-triggered routes.
 *
 * Accepts the secret via either:
 *   - `Authorization: Bearer <CRON_SECRET>`  (what Vercel Cron sends automatically)
 *   - `x-cron-secret: <CRON_SECRET>`          (convenience for external schedulers)
 *
 * Returns a NextResponse to short-circuit with (401/500) when unauthorized,
 * or `null` when the request is authorized and the handler should proceed.
 */
export function checkCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  // Fail closed: never run a protected job if the server has no secret configured.
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server' },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : undefined;
  const provided = bearer ?? req.headers.get('x-cron-secret') ?? '';

  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
