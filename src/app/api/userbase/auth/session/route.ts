import { NextRequest, NextResponse } from "next/server";
import { getBearerUserId, getUserPublic } from "@/lib/userbase/session";

export const runtime = "nodejs";

// Validate a bearer session token → current user.
export async function GET(req: NextRequest) {
  const userId = await getBearerUserId(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const user = await getUserPublic(userId);
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ success: true, user });
}
