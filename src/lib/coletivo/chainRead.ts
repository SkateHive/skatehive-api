import { COLETIVO_APP_ID } from "./config";
import type { ChainPost } from "./publisher";

// Read a post from the chain for publish reconciliation.
//
// Hivemind answers get_content for a post that does not exist with an RPC
// ERROR, not an empty object:
//   { code: 10, name: "assert_exception", message: "Assert Exception",
//     extension: { assertion_expression: "Post <author>/<permlink> does not exist" } }
// Only that exact, proven "missing" answer FOR THE REQUESTED author/permlink is
// treated as absent. Every other error (node down, timeout, another assert,
// a "does not exist" for a different post) is rethrown, so the publisher keeps
// it as chain_unavailable and never broadcasts on a guess.

export type ContentCall = (author: string, permlink: string) => Promise<unknown>;

type RpcInfo = { code?: unknown; name?: unknown; extension?: { assertion_expression?: unknown } };

export function isProvenMissingPost(e: unknown, author: string, permlink: string): boolean {
  const info = (e as { jse_info?: RpcInfo } | null)?.jse_info;
  if (!info || info.code !== 10 || info.name !== "assert_exception") return false;
  return info.extension?.assertion_expression === `Post ${author}/${permlink} does not exist`;
}

export async function readChainPost(call: ContentCall, author: string, permlink: string): Promise<ChainPost> {
  let raw: unknown;
  try {
    raw = await call(author, permlink);
  } catch (e) {
    if (isProvenMissingPost(e, author, permlink)) return null;
    throw e;
  }
  const c = raw as {
    author?: unknown;
    permlink?: unknown;
    parent_author?: unknown;
    parent_permlink?: unknown;
    json_metadata?: unknown;
  } | null;
  // Older nodes return an empty object for a missing post.
  if (!c || typeof c.author !== "string" || !c.author) return null;
  let submissionId: string | null = null;
  try {
    const meta = JSON.parse(typeof c.json_metadata === "string" && c.json_metadata ? c.json_metadata : "{}");
    const id = meta?.[COLETIVO_APP_ID]?.submission_id;
    submissionId = typeof id === "string" ? id : null;
  } catch {
    submissionId = null;
  }
  return {
    author: c.author,
    permlink: typeof c.permlink === "string" ? c.permlink : "",
    parentAuthor: typeof c.parent_author === "string" ? c.parent_author : "",
    parentPermlink: typeof c.parent_permlink === "string" ? c.parent_permlink : "",
    submissionId,
  };
}
