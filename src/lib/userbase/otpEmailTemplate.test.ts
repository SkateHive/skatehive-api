import { describe, expect, it } from "vitest";
import { brandForApp, buildOtpEmail } from "./otpEmailTemplate";

describe("brandForApp", () => {
  it("first-party (no app) → skatehive", () => {
    expect(brandForApp({ kind: "none" })).toBe("skatehive");
  });
  it("authenticated coletivoxv → coletivoxv", () => {
    expect(brandForApp({ kind: "app", appId: "coletivoxv" })).toBe("coletivoxv");
  });
  it("any other authenticated app → safe skatehive fallback", () => {
    expect(brandForApp({ kind: "app", appId: "otherapp" })).toBe("skatehive");
  });
  it("invalid client never gets a partner brand", () => {
    expect(brandForApp({ kind: "invalid" })).toBe("skatehive");
  });
});

describe("buildOtpEmail", () => {
  it("skatehive: English, green brand, code in html + text, validity and ignore notice", () => {
    const e = buildOtpEmail("skatehive", "123456");
    expect(e.subject).toBe("Your Skatehive login code");
    expect(e.fromName).toBe("Skatehive");
    expect(e.html).toContain('lang="en"');
    expect(e.html).toContain("#4caf50");
    expect(e.html).toContain(">123456<");
    expect(e.text).toContain("123456");
    expect(e.text).toMatch(/10 minutes/);
    expect(e.text).toMatch(/didn't request/);
  });

  it("coletivoxv: pt-BR, red accent, and NO Skatehive mention anywhere", () => {
    const e = buildOtpEmail("coletivoxv", "123456");
    expect(e.subject).toBe("Seu código para entrar no Coletivo XV");
    expect(e.fromName).toBe("Coletivo XV");
    expect(e.html).toContain('lang="pt-BR"');
    expect(e.html).toContain("#da2922");
    expect(e.html).toContain(">123456<");
    expect(e.text).toContain("123456");
    expect(e.text).toMatch(/10 minutos/);
    expect(e.text).toMatch(/Se você não pediu/);
    for (const part of [e.subject, e.fromName, e.html, e.text]) {
      expect(part.toLowerCase()).not.toContain("skatehive");
    }
  });

  it("is email-client safe: tables, inline styles, max 600px, preheader, no remote images or scripts", () => {
    for (const brand of ["skatehive", "coletivoxv"] as const) {
      const { html } = buildOtpEmail(brand, "123456");
      expect(html).toContain('role="presentation"');
      expect(html).toContain("max-width:600px");
      expect(html).toContain("display:none;max-height:0");
      expect(html).toContain('name="color-scheme"');
      expect(html).not.toMatch(/<img|<script|<link|url\(/i);
      // Preheader announces the purpose but never leaks the code.
      const pre = html.match(/<div style="display:none[^>]*>([^<]*)</)![1];
      expect(pre).not.toContain("123456");
    }
  });

  it("refuses anything but a 6-digit code (no injection into the template)", () => {
    expect(() => buildOtpEmail("skatehive", "<script>")).toThrow();
    expect(() => buildOtpEmail("coletivoxv", "12345")).toThrow();
  });
});
