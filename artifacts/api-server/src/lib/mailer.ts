import nodemailer, { type Transporter, type SendMailOptions } from "nodemailer";
import { logger } from "./logger.js";

export type DeliveryMode = "email" | "in-app-only";

// ── Env-var-based transporter (cached, lazy) ──────────────────────────────
let _envTransporter: Transporter | null | undefined;

function getEnvTransporter(): Transporter | null {
  if (_envTransporter !== undefined) return _envTransporter;

  const host = process.env["SMTP_HOST"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    _envTransporter = null;
    return null;
  }

  _envTransporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env["SMTP_PORT"] ?? "587", 10),
    secure: process.env["SMTP_SECURE"] === "true",
    auth: { user, pass },
  });

  return _envTransporter;
}

// ── Explicit-config transporter (no cache — called per-request from DB) ──
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

export function buildTransporter(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

// ── Shared types ─────────────────────────────────────────────────────────
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

const ENV_FROM =
  process.env["SMTP_FROM"] ?? `"Smart School ERP" <no-reply@school.edu>`;

// ── Send via env-var config (fallback / backward compat) ─────────────────
export async function sendMail(payload: MailPayload): Promise<MailResult> {
  const transporter = getEnvTransporter();

  if (!transporter) {
    logger.info(
      { to: payload.to, subject: payload.subject },
      "Email (log-only): SMTP not configured",
    );
    return { deliveryMode: "in-app-only" };
  }

  await transporter.sendMail({
    from: ENV_FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    attachments: payload.attachments,
  });

  logger.info({ to: payload.to, subject: payload.subject }, "Email sent via env SMTP");
  return { deliveryMode: "email", sentTo: payload.to };
}

// ── Send via explicit DB-sourced config ───────────────────────────────────
export async function sendMailWithConfig(
  cfg: SmtpConfig,
  payload: MailPayload,
): Promise<MailResult> {
  const transporter = buildTransporter(cfg);

  await transporter.sendMail({
    from: cfg.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    attachments: payload.attachments,
  });

  logger.info({ to: payload.to, subject: payload.subject }, "Email sent via DB SMTP config");
  return { deliveryMode: "email", sentTo: payload.to };
}
