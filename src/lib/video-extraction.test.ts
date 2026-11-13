import { describe, expect, it } from "vitest";
import { cleanMarkdownImageUrl, extractVideosFromPost } from "./video-extraction";

describe("cleanMarkdownImageUrl", () => {
  it("drops a markdown image title", () => {
    expect(
      cleanMarkdownImageUrl('https://images.hive.blog/DQmX/skatehive-gif-1791837540634.gif "skatehive gif 1791837540634"')
    ).toBe("https://images.hive.blog/DQmX/skatehive-gif-1791837540634.gif");
  });

  it("unwraps an angle-bracketed URL", () => {
    expect(cleanMarkdownImageUrl("<https://x.example/a b.png> \"t\"")).toBe("https://x.example/a b.png");
  });

  it("leaves a plain URL alone and rejects empty input", () => {
    expect(cleanMarkdownImageUrl(" https://x.example/a.jpg ")).toBe("https://x.example/a.jpg");
    expect(cleanMarkdownImageUrl("")).toBeNull();
    expect(cleanMarkdownImageUrl(undefined)).toBeNull();
  });
});

describe("extractVideosFromPost thumbnail fallback", () => {
  it("uses a clean body image URL when the image has a markdown title", () => {
    const [entry] = extractVideosFromPost({
      author: "skater",
      permlink: "p",
      title: "",
      created: "2026-10-29T00:00:00.000Z",
      post_json_metadata: "{}",
      body:
        '![gif](https://images.hive.blog/DQmX/skatehive-gif-1.gif "Pop shovit zn ")\n' +
        '<iframe src="https://ipfs.skatehive.app/ipfs/bafybeigabc123" allowfullscreen></iframe>',
      votes: [],
    });
    expect(entry.thumbnailUrl).toBe("https://images.hive.blog/DQmX/skatehive-gif-1.gif");
  });
});
