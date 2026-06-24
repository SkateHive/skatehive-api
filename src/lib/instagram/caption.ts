/**
 * Caption builder for Instagram cross-posts. Ported verbatim from
 * skatehive3.0/lib/instagram/caption.ts (no framework deps). IG limits: 2200
 * chars, max 30 hashtags; URLs aren't clickable so the permalink is plain text.
 */

const IG_CAPTION_LIMIT = 2200;
const IG_HASHTAG_LIMIT = 30;

const DEFAULT_HASHTAGS = ["skatehive", "skateboarding", "skate", "skater", "skatelife"];

function fromCode(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

// Decode the HTML entities that actually show up in Hive post bodies.
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCode(parseInt(d, 10)));
}

/**
 * Reduce a Hive post body (markdown + embedded HTML) to clean plain text for an
 * IG caption. Hive bodies routinely contain raw HTML (`<center>`, `<h1>`,
 * `<a href>`, `<img src=ipfs…>`) and bare media URLs that IG can't render — we
 * strip all of that and keep only the human-readable words (incl. link text).
 */
function markdownToPlainText(md: string): string {
  let s = md;
  // 1. HTML we never want as text: comments, embeds (with their content), and
  //    void media tags (img/br/hr → space). Drops the ipfs/src URLs entirely.
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|video|audio)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?:img|br|hr|source|embed)\b[^>]*\/?>/gi, " ");
  // 2. Markdown embeds/links → keep alt/anchor text only.
  s = s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // 3. Block close-tags → space (preserve word breaks), then drop every
  //    remaining tag. `<a href="…">text</a>` becomes just `text`.
  s = s
    .replace(/<\/(?:p|div|h[1-6]|li|ul|ol|center|blockquote|tr|table|section)>/gi, " ")
    .replace(/<[^>]+>/g, "");
  // 4. Decode entities now that the tags are gone.
  s = decodeEntities(s);
  // 5. Bare URLs are never clickable on IG — strip them as noise.
  s = s.replace(/\bhttps?:\/\/[^\s)]+/gi, "");
  // 6. Leftover markdown markers (emphasis, headings, quotes, table pipes).
  s = s.replace(/[*_~>#|]/g, "");
  // 7. Collapse whitespace.
  return s.replace(/\s+/g, " ").trim();
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
