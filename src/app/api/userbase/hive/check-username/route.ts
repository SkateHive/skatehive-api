import { NextRequest, NextResponse } from "next/server";
import {
  validateHiveUsernameFormat,
  checkHiveAccountExists,
} from "@/lib/userbase/hiveAccount";

export const runtime = "nodejs";

// Live availability check for the signup username picker.
// { valid } = passes Hive format rules; { available } = not yet an on-chain account.
export async function GET(req: NextRequest) {
  const name = (new URL(req.url).searchParams.get("name") || "").trim().toLowerCase();
  const fmt = validateHiveUsernameFormat(name);
  if (!fmt.isValid) {
    return NextResponse.json({ valid: false, available: false, reason: fmt.error });
  }
  try {
    const exists = await checkHiveAccountExists(name);
    return NextResponse.json({
      valid: true,
      available: !exists,
      reason: exists ? "Already taken on Hive" : undefined,
    });
  } catch {
    return NextResponse.json({
      valid: true,
      available: false,
      reason: "Couldn't check availability — try again",
    });
  }
}
