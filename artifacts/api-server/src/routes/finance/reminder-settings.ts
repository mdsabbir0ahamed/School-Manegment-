import { Router } from "express";
import { db } from "@workspace/db";
import { reminderSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { runReminderCron } from "../../lib/reminder-cron.js";

const router = Router();

async function ensureSettings() {
  const [existing] = await db
    .select()
    .from(reminderSettingsTable)
    .where(eq(reminderSettingsTable.tenantId, 1))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(reminderSettingsTable)
    .values({ tenantId: 1 })
    .returning();
  return created!;
}

// GET /reminder-settings
router.get("/reminder-settings", requireAuth, requireFinance, async (_req, res): Promise<void> => {
  const settings = await ensureSettings();
  let reminderDays: number[] = [-3, -1, 0, 1, 3, 7];
  try { reminderDays = JSON.parse(settings.reminderDays); } catch { /* use defaults */ }
  res.json({ ...settings, reminderDays });
});

// PUT /reminder-settings
router.put(
  "/reminder-settings",
  requireAuth,
  requireFinance,
  async (req, res): Promise<void> => {
    const { isEnabled, reminderDays } = req.body as {
      isEnabled?: boolean;
      reminderDays?: number[];
    };

    await ensureSettings();

    const updates: Partial<typeof reminderSettingsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof isEnabled === "boolean") updates.isEnabled = isEnabled;
    if (Array.isArray(reminderDays)) {
      const valid = reminderDays.filter(d => typeof d === "number" && d >= -30 && d <= 60);
      updates.reminderDays = JSON.stringify([...new Set(valid)].sort((a, b) => a - b));
    }

    const [updated] = await db
      .update(reminderSettingsTable)
      .set(updates)
      .where(eq(reminderSettingsTable.tenantId, 1))
      .returning();

    let parsedDays: number[] = [-3, -1, 0, 1, 3, 7];
    try { parsedDays = JSON.parse(updated!.reminderDays); } catch { /* use defaults */ }

    res.json({ ...updated, reminderDays: parsedDays });
  },
);

// POST /reminder-settings/trigger — manual forced run
router.post(
  "/reminder-settings/trigger",
  requireAuth,
  requireFinance,
  async (_req, res): Promise<void> => {
    const result = await runReminderCron(true);
    res.json({
      message: result.sent === 0
        ? "No invoices matched the configured reminder windows for today."
        : `Sent ${result.sent} reminder${result.sent !== 1 ? "s" : ""} successfully.`,
      sent: result.sent,
    });
  },
);

export default router;
