import { logger } from "./logger.js";

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromPhone: string;
  whatsappFrom: string;
}

export interface SmsResult {
  delivered: boolean;
  sid?: string;
  error?: string;
}

async function twilioRequest(
  accountSid: string,
  authToken: string,
  from: string,
  to: string,
  body: string,
): Promise<SmsResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const encoded = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });

  const data = await res.json() as { sid?: string; message?: string; code?: number };

  if (!res.ok) {
    const msg = data.message ?? `Twilio error ${res.status}`;
    logger.warn({ to, from, status: res.status, msg }, "Twilio request failed");
    return { delivered: false, error: msg };
  }

  logger.info({ to, from, sid: data.sid }, "SMS/WhatsApp sent via Twilio");
  return { delivered: true, sid: data.sid };
}

export async function sendSms(
  to: string,
  body: string,
  cfg: SmsConfig,
): Promise<SmsResult> {
  const normalizedTo = to.startsWith("+") ? to : `+${to.replace(/\D/g, "")}`;
  return twilioRequest(cfg.accountSid, cfg.authToken, cfg.fromPhone, normalizedTo, body);
}

export async function sendWhatsapp(
  to: string,
  body: string,
  cfg: SmsConfig,
): Promise<SmsResult> {
  const normalizedTo = to.startsWith("whatsapp:")
    ? to
    : `whatsapp:${to.startsWith("+") ? to : `+${to.replace(/\D/g, "")}`}`;
  const from = cfg.whatsappFrom.startsWith("whatsapp:")
    ? cfg.whatsappFrom
    : `whatsapp:${cfg.whatsappFrom}`;
  return twilioRequest(cfg.accountSid, cfg.authToken, from, normalizedTo, body);
}
