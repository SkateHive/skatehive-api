import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resumeColetivo } from "@/lib/coletivo/service";

export const runtime = "nodejs";
export const maxDuration = 60;

// Optional scheduler hook for the Coletivo recovery (same work as the
// moderator "resume" action). NOT scheduled in vercel.json: add a cron entry
// only after the plan/cost review. Fails closed: without CRON_SECRET, or with a
// wrong bearer, nothing runs.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const given = req.headers.get("authorization") || "";
  const want = `Bearer ${secret}`;
  const ok =
    secret.length >= 16 &&
    given.length === want.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
  if (!ok) return NextResponse.json({ success: false, code: "unauthorized" }, { status: 401 });
  const report = await resumeColetivo({ maxPublishes: 5, deadlineMs: 40000 });
  return NextResponse.json({ success: true, report });
}
