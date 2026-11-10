import { describe, expect, it } from "vitest";
import { isProvenMissingPost, readChainPost } from "./chainRead";

const AUTHOR = "skateuser";
const PERMLINK = "coletivoxv-aebc13b3fdb24d83b07251f72e2e4345";

// Shape of the real dhive RPCError for a missing post, captured read-only from
// api.hive.blog (condenser_api.get_content) on 2026-11-10; stack/hash trimmed.
function missingPostError(author = AUTHOR, permlink = PERMLINK) {
  return Object.assign(new Error(" category=hivemind"), {
    name: "RPCError",
    jse_info: {
      assert_hash: "4d5e6f7a8b9c0d1e2f3a",
      code: 10,
      extension: { assertion_expression: `Post ${author}/${permlink} does not exist` },
      message: "Assert Exception",
      name: "assert_exception",
      stack: [],
    },
  });
}

// Trimmed shape of a real existing post (fields the reader uses).
const existingPost = {
  author: AUTHOR,
  permlink: PERMLINK,
  parent_author: "peak.snaps",
  parent_permlink: "snap-container-1794317040",
  json_metadata: JSON.stringify({ app: "coletivoxv/1.0", coletivoxv: { submission_id: "aebc13b3-fdb2-4d83-b072-51f72e2e4345" } }),
};

describe("readChainPost", () => {
  it("proven missing (hivemind assert for THIS post) -> null (absent)", async () => {
    expect(await readChainPost(async () => { throw missingPostError(); }, AUTHOR, PERMLINK)).toBeNull();
  });

  it("existing post -> author/permlink/submission_id", async () => {
    expect(await readChainPost(async () => existingPost, AUTHOR, PERMLINK)).toEqual({
      author: AUTHOR,
      permlink: PERMLINK,
      parentAuthor: "peak.snaps",
      parentPermlink: "snap-container-1794317040",
      submissionId: "aebc13b3-fdb2-4d83-b072-51f72e2e4345",
    });
  });

  it("existing post from another app / bad metadata -> submissionId null (publisher treats as conflict)", async () => {
    expect(await readChainPost(async () => ({ ...existingPost, json_metadata: "{not json" }), AUTHOR, PERMLINK)).toMatchObject({ submissionId: null });
    expect(await readChainPost(async () => ({ ...existingPost, json_metadata: "{}" }), AUTHOR, PERMLINK)).toMatchObject({ submissionId: null });
  });

  it("legacy empty object -> null", async () => {
    expect(await readChainPost(async () => ({ author: "", permlink: "" }), AUTHOR, PERMLINK)).toBeNull();
  });

  it("node failure / timeout / network -> rethrown, never 'absent'", async () => {
    for (const err of [
      Object.assign(new Error("request to https://api.hive.blog failed, reason: getaddrinfo ENOTFOUND"), { name: "FetchError", code: "ENOTFOUND" }),
      Object.assign(new Error("Timed out"), { name: "TimeoutError" }),
      Object.assign(new Error("HTTP 502: Bad Gateway"), { name: "HTTPError" }),
    ]) {
      await expect(readChainPost(async () => { throw err; }, AUTHOR, PERMLINK)).rejects.toBe(err);
    }
  });

  it("other RPC errors, other asserts, or 'does not exist' for ANOTHER post -> rethrown", async () => {
    const otherAssert = missingPostError();
    otherAssert.jse_info.extension.assertion_expression = "Account skateuser does not exist";
    const otherPost = missingPostError(AUTHOR, "some-other-permlink");
    const wrongCode = missingPostError();
    (wrongCode.jse_info as { code: number }).code = 13;
    const rateLimited = Object.assign(new Error("rate limited"), { name: "RPCError", jse_info: { code: -32003, name: "rate_limit", message: "Too many requests" } });
    for (const err of [otherAssert, otherPost, wrongCode, rateLimited]) {
      await expect(readChainPost(async () => { throw err; }, AUTHOR, PERMLINK)).rejects.toBe(err);
    }
  });

  it("isProvenMissingPost is bound to the exact author/permlink", () => {
    expect(isProvenMissingPost(missingPostError(), AUTHOR, PERMLINK)).toBe(true);
    expect(isProvenMissingPost(missingPostError(), "xvlad", PERMLINK)).toBe(false);
    expect(isProvenMissingPost(null, AUTHOR, PERMLINK)).toBe(false);
    expect(isProvenMissingPost(new Error("x"), AUTHOR, PERMLINK)).toBe(false);
  });
});
