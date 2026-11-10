import type { AppClient } from "@/lib/userbase/appClient";

// Branded login-code emails. The brand is picked ONLY from the authenticated
// app client (see appClient.ts) — never from the request body, Origin or any
// other caller-controlled value. No headers → Skatehive. A known partner app →
// its brand. Any other authenticated app → Skatehive (the account is a
// Skatehive account, so that is always a truthful fallback).
//
// Email-client safety: table layout, inline styles, bgcolor attributes,
// max 600px, system font stacks, no remote images or tracking, a hidden
// preheader, and an equivalent plain-text part.

export type EmailBrand = "skatehive" | "coletivoxv";

export type OtpEmail = {
  subject: string;
  fromName: string;
  html: string;
  text: string;
};

export const OTP_TTL_MINUTES = 10;

export function brandForApp(app: AppClient): EmailBrand {
  if (app.kind === "app" && app.appId === "coletivoxv") return "coletivoxv";
  return "skatehive";
}

type Palette = {
  page: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  onAccent: string;
  codeBg: string;
};

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Liberation Mono','Courier New',monospace";
const CONDENSED = "'Barlow Condensed','Arial Narrow',Arial,Helvetica,sans-serif";

function assertCode(code: string): string {
  if (!/^\d{6}$/.test(code)) throw new Error("OTP code must be 6 digits");
  return code;
}

// Shared skeleton; brand-specific parts are passed in as already-safe HTML.
function layout(p: {
  lang: string;
  title: string;
  preheader: string;
  palette: Palette;
  header: string;
  intro: string;
  code: string;
  codeLabel: string;
  validity: string;
  ignore: string;
  footer: string;
  codeAccentLeft: boolean;
}): string {
  const c = p.palette;
  const codeCell = p.codeAccentLeft
    ? `border:1px solid ${c.border};border-left:6px solid ${c.accent};`
    : `border:1px solid ${c.border};`;
  return `<!DOCTYPE html>
<html lang="${p.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<meta name="x-apple-disable-message-reformatting">
<title>${p.title}</title>
<style>
  @media only screen and (max-width:480px) {
    .px { padding-left:20px !important; padding-right:20px !important; }
    .code { font-size:28px !important; letter-spacing:0.22em !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${c.page};color:${c.text};font-family:${SANS};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${c.page};font-size:1px;line-height:1px;">${p.preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.page}" style="background-color:${c.page};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.card}" style="max-width:600px;background-color:${c.card};border:1px solid ${c.border};border-radius:20px;">
        <tr><td class="px" style="padding:32px 36px 8px;">${p.header}</td></tr>
        <tr>
          <td class="px" style="padding:20px 36px 8px;font-family:${SANS};font-size:16px;line-height:1.6;color:${c.text};">${p.intro}</td>
        </tr>
        <tr>
          <td class="px" style="padding:12px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${c.codeBg}" style="background-color:${c.codeBg};${codeCell}border-radius:14px;padding:22px 12px;">
                  <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${c.muted};padding-bottom:8px;">${p.codeLabel}</div>
                  <div class="code" style="font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:0.3em;color:${c.text};-webkit-user-select:all;user-select:all;">${p.code}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:12px 36px 4px;font-family:${SANS};font-size:15px;line-height:1.6;color:${c.text};">${p.validity}</td>
        </tr>
        <tr>
          <td class="px" style="padding:8px 36px 28px;font-family:${SANS};font-size:13px;line-height:1.6;color:${c.muted};">${p.ignore}</td>
        </tr>
        <tr>
          <td class="px" bgcolor="${c.page}" style="background-color:${c.page};border-top:1px solid ${c.border};border-radius:0 0 20px 20px;padding:18px 36px;font-family:${SANS};font-size:12px;line-height:1.6;color:${c.muted};">${p.footer}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function skatehiveEmail(code: string): OtpEmail {
  const c: Palette = {
    // Matches the web magic-link email users already get (skatehive3.0
    // lib/email/magicLinkTemplate.ts), with muted text kept at >= 7:1.
    page: "#0a0a0a",
    card: "#121212",
    border: "#1f1f1f",
    text: "#ffffff",
    muted: "#bdbdbd",
    accent: "#4caf50",
    onAccent: "#0a0a0a",
    codeBg: "#0d0d0d",
  };
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="font-family:${SANS};font-size:22px;font-weight:700;letter-spacing:0.08em;color:${c.accent};">SKATEHIVE</td>
  </tr></table>
  <div style="font-family:${SANS};font-size:26px;font-weight:700;color:${c.text};padding-top:18px;">Drop in.</div>`;
  const html = layout({
    lang: "en",
    title: "Your Skatehive login code",
    preheader: "Your Skatehive login code is inside. It expires in 10 minutes.",
    palette: c,
    header,
    intro: "Use this code to sign in to your Skatehive account:",
    code,
    codeLabel: "Login code",
    validity: `It expires in ${OTP_TTL_MINUTES} minutes.`,
    ignore:
      "If you didn&rsquo;t request this, you can safely ignore this email &mdash; nobody can sign in without the code.",
    footer: `Skate fast. Post hard.<br><a href="https://skatehive.app/" style="color:${c.accent};text-decoration:none;">skatehive.app</a>`,
    codeAccentLeft: true,
  });
  const text = [
    "Your Skatehive login code",
    "",
    "Use this code to sign in to your Skatehive account:",
    "",
    `    ${code}`,
    "",
    `It expires in ${OTP_TTL_MINUTES} minutes.`,
    "If you didn't request this, you can safely ignore this email - nobody can sign in without the code.",
    "",
    "Skate fast. Post hard.",
    "skatehive.app",
  ].join("\n");
  return { subject: "Your Skatehive login code", fromName: "Skatehive", html, text };
}

function coletivoEmail(code: string): OtpEmail {
  const c: Palette = {
    page: "#000000",
    card: "#111111",
    border: "#2a2a2a",
    text: "#ffffff",
    muted: "#b3b3b3",
    accent: "#da2922", // only as a block/stripe behind white text (6.4:1), never small red text
    onAccent: "#ffffff",
    codeBg: "#000000",
  };
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="font-family:${CONDENSED};font-size:30px;font-weight:900;letter-spacing:-0.02em;line-height:1;color:${c.text};padding-right:8px;">COLETIVO</td>
    <td bgcolor="${c.accent}" style="background-color:${c.accent};font-family:${CONDENSED};font-size:30px;font-weight:900;letter-spacing:-0.02em;line-height:1;color:${c.onAccent};padding:4px 8px;border-radius:4px;">XV</td>
  </tr></table>
  <div style="font-family:${SANS};font-size:13px;color:${c.muted};padding-top:10px;">Praça XV, cultura urbana e memória</div>`;
  const html = layout({
    lang: "pt-BR",
    title: "Seu código para entrar no Coletivo XV",
    preheader: "Seu código de acesso ao site do Coletivo XV. Vale por 10 minutos.",
    palette: c,
    header,
    intro: "Use este código para entrar no site do Coletivo XV:",
    code,
    codeLabel: "Código de acesso",
    validity: `Ele vale por ${OTP_TTL_MINUTES} minutos.`,
    ignore: "Se você não pediu, ignore este email &mdash; ninguém entra sem o código.",
    footer: `Coletivo XV &middot; Praça XV de Novembro, Centro, Rio de Janeiro`,
    codeAccentLeft: true,
  });
  const text = [
    "Seu código para entrar no Coletivo XV",
    "",
    "Use este código para entrar no site do Coletivo XV:",
    "",
    `    ${code}`,
    "",
    `Ele vale por ${OTP_TTL_MINUTES} minutos.`,
    "Se você não pediu, ignore este email - ninguém entra sem o código.",
    "",
    "Coletivo XV · Praça XV de Novembro, Centro, Rio de Janeiro",
  ].join("\n");
  return {
    subject: "Seu código para entrar no Coletivo XV",
    // Clean partner branding (user decision): no Skatehive mention anywhere.
    // Same authorized SMTP address; only the display name changes.
    fromName: "Coletivo XV",
    html,
    text,
  };
}

export function buildOtpEmail(brand: EmailBrand, rawCode: string): OtpEmail {
  const code = assertCode(rawCode);
  return brand === "coletivoxv" ? coletivoEmail(code) : skatehiveEmail(code);
}
