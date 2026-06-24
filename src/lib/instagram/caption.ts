/**
 * Caption builder for Instagram cross-posts. Ported verbatim from
 * skatehive3.0/lib/instagram/caption.ts (no framework deps). IG limits: 2200
 * chars, max 30 hashtags; URLs aren't clickable so the permalink is plain text.
 */

const IG_CAPTION_LIMIT = 2200;
const IG_HASHTAG_LIMIT = 30;

const DEFAULT_HASHTAGS = ["skatehive", "skateboarding", "skate", "skater", "skatelife"];

function markdownToPlainText(md: string): string {
  return md
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTag(raw: string): string | null {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "");
  if (!cleaned) return null;
  return cleaned.toLowerCase();
}

export function buildInstagramCaption(input: {
  title?: string;
  body: string;
  hiveAuthor: string;
  permalinkUrl: string;
  extraTags?: string[];
  igHandle?: string | null;
}): string {
  const title = (input.title || "").trim();
  const excerpt = markdownToPlainText(input.body);

  const tagSet = new Set<string>();
  for (const t of DEFAULT_HASHTAGS) {
    const n = normalizeTag(t);
    if (n) tagSet.add(n);
  }
  for (const t of input.extraTags || []) {
    if (tagSet.size >= IG_HASHTAG_LIMIT) break;
    const n = normalizeTag(t);
    if (n) tagSet.add(n);
  }
  const hashtagLine = Array.from(tagSet).slice(0, IG_HASHTAG_LIMIT).map((t) => `#${t}`).join(" ");

  const credit = input.igHandle
    ? `@${input.igHandle} on SkateHive`
    : `By ${input.hiveAuthor} on SkateHive`;
  const link = input.permalinkUrl;

  const headline = title || credit;
  const fixed = [headline, title ? credit : "", link, "", hashtagLine].filter(Boolean).join("\n");
  const remaining = IG_CAPTION_LIMIT - fixed.length - 2;

  let safeExcerpt = "";
  if (remaining > 40 && excerpt) {
    safeExcerpt = excerpt.length > remaining ? excerpt.slice(0, remaining - 1).trim() + "…" : excerpt;
  }

  const parts: string[] = [headline];
  if (title) parts.push(credit);
  parts.push(link);
  if (safeExcerpt) parts.push("", safeExcerpt);
  parts.push("", hashtagLine);

  return parts.join("\n").slice(0, IG_CAPTION_LIMIT);
}
