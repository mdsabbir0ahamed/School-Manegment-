import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";
import { logger } from "./logger.js";

export type DeliveryMode = "email" | "in-app-only";

let _transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (_transporter !== null) return _transporter;

  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — email delivery disabled (SMTP_HOST / SMTP_USER / SMTP_PASS required)");
    _transporter = null as unknown as Transporter;
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env["SMTP_PORT"] ?? "587", 10),
    secure: process.env["SMTP_SECURE"] === "true",
    auth: { user, pass },
  });

  return _transporter;
}

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  attachments?: SendMailOptions["attachments"];
}

export interface MailResult {
  deliveryMode: DeliveryMode;
  sentTo?: string;
}

const FROM_ADDRESS =
  process.env["SMTP_FROM"] ?? `"Smart School ERP" <no-reply@school.edu>`;

export async function sendMail(payload: MailPayload): Promise<MailResult> {
  const transporter = getTransporter();

  if (!transporter) {
    logger.info(
      { to: payload.to, subject: payload.subject },
      "Email (log-only): SMTP not configured",
    );
    return { deliveryMode: "in-app-only" };
  }

  await transporter.sendMail({
    from: FROM_ADDRESS,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    attachments: payload.attachments,
  });

  logger.info({ to: payload.to, subject: payload.subject }, "Email sent");
  return { deliveryMode: "email", sentTo: payload.to };
}
