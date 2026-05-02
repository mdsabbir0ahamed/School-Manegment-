import { db } from "@workspace/db";
import {
  invoicesTable,
  reminderSettingsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendInvoiceReminder } from "./overdue-cron.js";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

async function getOrCreateSettings(): Promise<{
  isEnabled: boolean;
  reminderDays: number[];
  lastRunAt: Date | null;
}> {
  const [existing] = await db
    .select()
    .from(reminderSettingsTable)
    .where(eq(reminderSettingsTable.tenantId, 1))
    .limit(1);

  if (existing) {
    let days: number[] = [-3, -1, 0, 1, 3, 7];
    try {
      days = JSON.parse(existing.reminderDays);
    } catch {
      // use defaults
    }
    return { isEnabled: existing.isEnabled, reminderDays: days, lastRunAt: existing.lastRunAt };
  }

  // Create defaults
  const [created] = await db
    .insert(reminderSettingsTable)
    .values({ tenantId: 1 })
    .returning();

  return { isEnabled: true, reminderDays: [-3, -1, 0, 1, 3, 7], lastRunAt: created?.lastRunAt ?? null };
}

export async function runReminderCron(force = false): Promise<{ sent: number; skipped: boolean }> {
  const settings = await getOrCreateSettings();

  if (!settings.isEnabled && !force) {
    logger.info("Reminder cron skipped — disabled in settings");
    return { sent: 0, skipped: true };
  }

  // Skip if already ran today (unless forced)
  if (!force && settings.lastRunAt) {
    const lastRunDay = toDateStr(settings.lastRunAt);
    const today = toDateStr(new Date());
    if (lastRunDay === today) {
      logger.info({ lastRunDay }, "Reminder cron skipped — already ran today");
      return { sent: 0, skipped: true };
    }
  }

  const today = new Date();
  const sentInvoiceIds = new Set<number>();
  let totalSent = 0;

  for (const offset of settings.reminderDays) {
    const targetDate = toDateStr(addDays(today, -offset)); // offset is "days before due"

    // Find PENDING invoices matching this target due date
    const pendingInvoices = await db
      .select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(
        and(
          inArray(invoicesTable.status, ["PENDING", "OVERDUE"]),
          eq(invoicesTable.dueDate, targetDate),
        ),
      );

    for (const inv of pendingInvoices) {
      if (sentInvoiceIds.has(inv.id)) continue; // de-dupe if multiple offsets hit same invoice
      try {
        await sendInvoiceReminder(inv.id);
        sentInvoiceIds.add(inv.id);
        totalSent++;
        logger.info(
          { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, offset },
          "Auto-reminder sent",
        );
      } catch (err) {
        logger.error({ err, invoiceId: inv.id }, "Failed to send auto-reminder");
      }
    }
  }

  // Update lastRunAt and count
  await db
    .update(reminderSettingsTable)
    .set({ lastRunAt: new Date(), lastRunCount: totalSent, updatedAt: new Date() })
    .where(eq(reminderSettingsTable.tenantId, 1));

  logger.info({ totalSent }, "Reminder cron completed");
  return { sent: totalSent, skipped: false };
}

export function startReminderCron(): void {
  // Run once on startup, then every hour (cron skips if already ran today)
  runReminderCron().catch(err => logger.error({ err }, "Reminder cron startup run failed"));

  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    runReminderCron().catch(err => logger.error({ err }, "Reminder cron hourly run failed"));
  }, ONE_HOUR);

  logger.info("Fee reminder cron started (checks hourly, runs once per day)");
}
