import { NextRequest, after } from "next/server";
import { err, json, requireSessionHash, storeErrorResponse } from "@/lib/coletivo/http";
import { checkVideoUrl } from "@/lib/coletivo/mediaCheck";
import { runPublishFlow } from "@/lib/coletivo/service";
import { createPost, me } from "@/lib/coletivo/store";
import { parseIdempotencyKey, parseSubmissionInput, requestHash } from "@/lib/coletivo/validation";
import { submissionView } from "@/lib/coletivo/views";

export const runtime = "nodejs";

// Create a submission. Only content is read from the body; the DB decides the
// author (from the app session), status (pending, or approved for a bound
// moderator) and the Hive permlink.
export async function POST(req: NextRequest) {
  const s = requireSessionHash(req);
  if ("response" in s) return s.response;
  const idem = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (!idem) return err(400, "idempotency_key_required");
  const parsed = parseSubmissionInput(await req.json().catch(() => null));
  if (!parsed.ok) return err(400, parsed.code, parsed.error);

  // Resolve the session in the DB BEFORE any outbound media probe, so a forged
  // or dead token can't make the API fetch anything.
  try {
    await me(s.tokenHash);
  } catch (e) {
    return storeErrorResponse(e);
  }

  for (const m of parsed.value.media) {
    if (m.type !== "video") continue;
    const check = await checkVideoUrl(m.url);
    if (!check.ok) return err(422, check.code);
  }

  try {
    const row = await createPost(s.tokenHash, {
      idempotencyKey: idem,
      requestHash: requestHash(parsed.value),
      kind: parsed.value.kind,
      title: parsed.value.title,
      body: parsed.value.body,
      media: parsed.value.media,
      context: parsed.value.context,
    });
    if (row.status === "approved") after(() => runPublishFlow(row.id).then(() => undefined));
    return json(201, { success: true, submission: submissionView(row) });
  } catch (e) {
    return storeErrorResponse(e);
  }
}
