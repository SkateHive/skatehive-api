import { describe, expect, it } from "vitest";
import { cover } from "./views";
import type { MediaItem } from "./validation";

const photo = (n: number): MediaItem => ({ type: "image", url: `https://images.hive.blog/p${n}.jpg` });
const video = (poster?: string): MediaItem => ({ type: "video", url: "https://ipfs.skatehive.app/ipfs/Qm" + "a".repeat(44), ...(poster ? { poster } : {}) });
const P = "https://images.hive.blog/poster.jpg";

describe("cover (photo first, else first video poster, else null)", () => {
  it("photo only -> first photo", () => {
    expect(cover({ media: [photo(1), photo(2)] })).toBe("https://images.hive.blog/p1.jpg");
  });
  it("video-only with poster -> poster (article feed/OG thumbnail)", () => {
    expect(cover({ media: [video(P)] })).toBe(P);
  });
  it("mixed: a photo always wins, even when the video (with poster) comes first", () => {
    expect(cover({ media: [video(P), photo(2)] })).toBe("https://images.hive.blog/p2.jpg");
  });
  it("video without poster, text-only, or bad media -> null", () => {
    expect(cover({ media: [video()] })).toBeNull();
    expect(cover({ media: [] })).toBeNull();
    expect(cover({ media: null as unknown as MediaItem[] })).toBeNull();
  });
});
