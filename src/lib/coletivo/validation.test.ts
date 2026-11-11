import { describe, expect, it } from "vitest";
import { isGatewayCidUrl, parseIdempotencyKey, parseSubmissionInput, requestHash } from "./validation";

const CID = "Qm" + "a".repeat(44);
const base = { consent_publish: true, body: "manobra na praça" };

describe("parseSubmissionInput", () => {
  it("requires explicit consent to publish on the author's behalf", () => {
    const r = parseSubmissionInput({ body: "x" });
    expect(r).toMatchObject({ ok: false, code: "consent_required" });
  });

  it("accepts text, derives kind, and ignores client-sent status/author/app/permlink", () => {
    const r = parseSubmissionInput({ ...base, status: "published", author: "xvlad", app: "x", permlink: "p", approved: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ publicationType: "snap", title: null, body: "manobra na praça", media: [], context: null, kind: "text" });
      expect(Object.keys(r.value)).not.toContain("status");
    }
  });

  it("photo and video kinds; images only from images.hive.blog, videos only gateway CIDs", () => {
    const photo = parseSubmissionInput({ ...base, media: [{ type: "image", url: "https://images.hive.blog/DQmX/a.jpg" }] });
    expect(photo.ok && photo.value.kind).toBe("photo");
    const video = parseSubmissionInput({
      ...base,
      media: [{ type: "video", url: `https://ipfs.skatehive.app/ipfs/${CID}`, poster: "https://images.hive.blog/DQmY/p.jpg" }],
    });
    expect(video.ok && video.value.kind).toBe("video");
    for (const bad of [
      { type: "image", url: "https://evil.example/a.jpg" },
      { type: "image", url: "http://images.hive.blog/a.jpg" },
      { type: "video", url: `https://ipfs.skatehive.app/ipfs/${CID}?x=1` },
      { type: "video", url: "https://ipfs.io/ipfs/" + CID },
      { type: "video", url: `https://ipfs.skatehive.app/ipfs/${CID}`, poster: "https://evil.example/p.jpg" },
      { type: "gif", url: "https://images.hive.blog/a.gif" },
    ]) {
      expect(parseSubmissionInput({ ...base, media: [bad] })).toMatchObject({ ok: false, code: "invalid_media" });
    }
  });

  it("caps media and allows one video", () => {
    const v = { type: "video", url: `https://ipfs.skatehive.app/ipfs/${CID}` };
    expect(parseSubmissionInput({ ...base, media: [v, v] })).toMatchObject({ ok: false, code: "invalid_media" });
    const imgs = Array.from({ length: 11 }, () => ({ type: "image", url: "https://images.hive.blog/a.jpg" }));
    expect(parseSubmissionInput({ ...base, media: imgs })).toMatchObject({ ok: false, code: "invalid_media" });
  });

  it("context: kind instalacao|evento + slug format only", () => {
    expect(parseSubmissionInput({ ...base, context: { kind: "evento", slug: "cine-xv" } }).ok).toBe(true);
    for (const c of [{ kind: "event", slug: "cine-xv" }, { kind: "evento", slug: "Cine XV" }, { kind: "evento" }]) {
      expect(parseSubmissionInput({ ...base, context: c })).toMatchObject({ ok: false, code: "invalid_context" });
    }
  });

  it("text OR media: empty body allowed with media, refused without", () => {
    expect(parseSubmissionInput({ consent_publish: true, body: "" })).toMatchObject({ code: "empty_submission" });
    expect(parseSubmissionInput({ consent_publish: true })).toMatchObject({ code: "empty_submission" });
    const r = parseSubmissionInput({ consent_publish: true, media: [{ type: "image", url: "https://images.hive.blog/a.jpg" }] });
    expect(r.ok && r.value).toMatchObject({ body: "", kind: "photo", title: null });
    expect(parseSubmissionInput({ consent_publish: true, body: 42 })).toMatchObject({ code: "invalid_body" });
  });

  it("length limits", () => {
    expect(parseSubmissionInput({ ...base, body: "x".repeat(5001) })).toMatchObject({ code: "invalid_body" });
    expect(parseSubmissionInput({ ...base, title: "x".repeat(121) })).toMatchObject({ code: "invalid_title" });
  });
});

describe("helpers", () => {
  it("requestHash is stable for the same content and differs otherwise", () => {
    const a = parseSubmissionInput(base);
    const b = parseSubmissionInput({ ...base, body: "outra" });
    if (!a.ok || !b.ok) throw new Error();
    expect(requestHash(a.value)).toBe(requestHash(a.value));
    expect(requestHash(a.value)).not.toBe(requestHash(b.value));
  });
  it("idempotency key format", () => {
    expect(parseIdempotencyKey("3f2c9a1e-1111-4222-8333-944455556666")).toBeTruthy();
    expect(parseIdempotencyKey("short")).toBeNull();
    expect(parseIdempotencyKey(null)).toBeNull();
  });
  it("gateway CID check rejects subpaths", () => {
    expect(isGatewayCidUrl(`https://ipfs.skatehive.app/ipfs/${CID}/x`)).toBe(false);
  });
});

describe("publication_type (snap default, article explicit)", () => {
  const img = { type: "image", url: "https://images.hive.blog/a.jpg" };
  it("OLD payload without the field = snap; hash identical to the pre-article formula", async () => {
    const r = parseSubmissionInput(base);
    if (!r.ok) throw new Error();
    expect(r.value.publicationType).toBe("snap");
    const crypto = await import("crypto");
    const legacy = crypto.createHash("sha256").update(JSON.stringify([r.value.title, r.value.body, r.value.media, r.value.context])).digest("hex");
    expect(requestHash(r.value)).toBe(legacy); // retries made before this change still match
  });
  it("rejects unknown types; never inferred from media", () => {
    expect(parseSubmissionInput({ ...base, publication_type: "blog" })).toMatchObject({ code: "invalid_publication_type" });
    const photo = parseSubmissionInput({ ...base, media: [img] });
    expect(photo.ok && photo.value.publicationType).toBe("snap");
  });
  it("article: title 1..120 and body 1..20000 required; same media rules as snap", () => {
    const art = { consent_publish: true, publication_type: "article" };
    expect(parseSubmissionInput({ ...art, body: "x" })).toMatchObject({ code: "title_required" });
    expect(parseSubmissionInput({ ...art, title: "   ", body: "x" })).toMatchObject({ code: "title_required" });
    expect(parseSubmissionInput({ ...art, title: "T", media: [img] })).toMatchObject({ code: "invalid_body" });
    expect(parseSubmissionInput({ ...art, title: "x".repeat(121), body: "x" })).toMatchObject({ code: "invalid_title" });
    expect(parseSubmissionInput({ ...art, title: "T", body: "x".repeat(20001) })).toMatchObject({ code: "invalid_body" });
    const ok = parseSubmissionInput({ ...art, title: "T", body: "x".repeat(20000), media: [img, img] });
    expect(ok.ok && ok.value).toMatchObject({ publicationType: "article", kind: "photo" });
    const v = { type: "video", url: "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44) };
    expect(parseSubmissionInput({ ...art, title: "T", body: "x", media: [v, v] })).toMatchObject({ code: "invalid_media" });
  });
  it("snap body limit stays 5000", () => {
    expect(parseSubmissionInput({ ...base, body: "x".repeat(5001) })).toMatchObject({ code: "invalid_body" });
  });
  it("same content as snap vs article -> different hashes (key reuse across types = conflict)", () => {
    const s = parseSubmissionInput({ ...base, title: "T" });
    const a = parseSubmissionInput({ ...base, title: "T", publication_type: "article" });
    if (!s.ok || !a.ok) throw new Error();
    expect(requestHash(s.value)).not.toBe(requestHash(a.value));
  });
});

