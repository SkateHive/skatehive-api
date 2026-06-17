import { NextRequest, NextResponse } from "next/server";
import { getBearerToken, revokeSessionByToken } from "@/lib/userbase/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (token) await revokeSessionByToken(token);
  return NextResponse.json({ success: true });
}
