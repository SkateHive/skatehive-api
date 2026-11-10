import nodemailer from "nodemailer";
import { buildOtpEmail, type EmailBrand } from "@/lib/userbase/otpEmailTemplate";

// SMTP transport — same env vars as the web app (SMTP_HOST/PORT/SECURE,
// EMAIL_USER, EMAIL_PASS), defaults to Gmail SMTP.
function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

/**
 * Local testing without real email: USERBASE_OTP_DEV_LOG=1 prints the code to
 * the server console instead of sending it. Ignored in production
 * (NODE_ENV=production or VERCEL_ENV=production), so it can't leak codes there.
 */
export function isOtpDevLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return false;
  return env.USERBASE_OTP_DEV_LOG === "1";
}

export async function sendOtpEmail(
  to: string,
  code: string,
  brand: EmailBrand = "skatehive"
): Promise<void> {
  const email = buildOtpEmail(brand, code);
  if (isOtpDevLogEnabled()) {
    console.info(`[userbase/email] DEV: ${brand} OTP for ${to} is ${code} (not sent)`);
    return;
  }
  // Same authorized SMTP address for every brand; only the display name changes.
  const address = process.env.EMAIL_USER || "noreply@skatehive.app";
  const transporter = createTransport();
  await transporter.sendMail({
    from: { name: email.fromName, address },
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
