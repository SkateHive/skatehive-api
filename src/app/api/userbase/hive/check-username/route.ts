import { NextRequest, NextResponse } from "next/server";
import {
  validateHiveUsernameFormat,
  checkHiveAccountExists,
  isHandleReservedInUserbase,
} from "@/lib/userbase/hiveAccount";

export const runtime = "nodejs";

// Live availability check for the signup username picker.
// { valid } = passes Hive format rules; { available } = free to claim, i.e. not
// an existing on-chain account AND not already reserved by another userbase
// account — matching what signup/complete enforces, so the picker can't show
// "available" for a name that submit would then reject.
export async function GET(req: NextRequest) {
  const name = (new URL(req.url).searchParams.get("name") || "").trim().toLowerCase();
  const fmt = validateHiveUsernameFormat(name);
  if (!fmt.isValid) {
    return NextResponse.json({ valid: false, available: false, reason: fmt.error });
  }
  try {
    const [existsOnChain, reservedInDb] = await Promise.all([
      checkHiveAccountExists(name),
      isHandleReservedInUserbase(name),
    ]);
    const available = !existsOnChain && !reservedInDb;
    return NextResponse.json({
      valid: true,
      available,
      reason: existsOnChain
        ? "Already taken on Hive"
        : reservedInDb
          ? "Already reserved"
          : undefined,
    });
  } catch {
    // Fail safe: if either lookup errors, never claim the name is available.
    return NextResponse.json({
      valid: true,
      available: false,
      reason: "Couldn't check availability — try again",
    });
  }
}
