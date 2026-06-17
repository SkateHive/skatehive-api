import nodemailer from "nodemailer";

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

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const from = process.env.EMAIL_USER || "noreply@skatehive.app";
  const transporter = createTransport();
  await transporter.sendMail({
    from,
    to,
    subject: "Your SkateHive login code",
    text: `Your SkateHive login code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif">
      <p>Your SkateHive login code is:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#000">${code}</p>
      <p style="color:#666">It expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>`,
  });
}
