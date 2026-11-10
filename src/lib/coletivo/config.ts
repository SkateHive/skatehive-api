// Coletivo XV community: fixed, reviewed configuration. Moderator handles live
// in code on purpose (a change needs a PR), and they are NEVER matched against
// a userbase handle: a moderator must bind the Hive account with a fresh
// posting-key signature (see moderatorBinding.ts).

export const COLETIVO_APP_ID = "coletivoxv";

// An extra, code-reviewed ceiling on top of the DB allowlist
// (userbase_app_moderator_allowlist), which is what actually grants access.
// "pharraxv" is NOT here: there is no such Hive account, and an allowlisted
// name anyone could register would be an admin takeover. Add the confirmed
// handle in a PR once the user confirms it.
export const MODERATOR_HIVE_HANDLES: readonly string[] = ["wilbor", "xvlad"];

export const LIMITS = {
  titleMax: 120,
  bodyMax: 5000,
  mediaMax: 10,
  videosMax: 1,
  rejectReasonMax: 500,
  pageMax: 50,
  pageDefault: 20,
  imageBytesMax: 4 * 1024 * 1024, // Vercel body limit is ~4.5MB
  challengeTtlMs: 5 * 60 * 1000,
  publishLeaseMs: 2 * 60 * 1000,
  publishMaxAttempts: 5,
} as const;

/** Real Hive broadcasts only when explicitly enabled (never in tests/local). */
export function isPublishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COLETIVO_HIVE_PUBLISH_ENABLED === "1";
}

/** Moderator emails only when explicitly enabled. */
export function isModerationEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COLETIVO_MODERATION_EMAILS === "1";
}

/** Hive parent tag for published posts. */
export function hiveParentTag(env: NodeJS.ProcessEnv = process.env): string {
  return env.COLETIVO_HIVE_PARENT_TAG || "hive-173115";
}
