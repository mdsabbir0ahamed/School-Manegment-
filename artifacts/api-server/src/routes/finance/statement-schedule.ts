import { Router } from "express";
import { db } from "@workspace/db";
import { feeStatementScheduleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../../middlewares/requireAuth.js";
import { runStatementSchedulerCron } from "../../lib/statement-scheduler-cron.js";

const router = Router();

async function getOrCreate() {
  const [existing] = await db
    .select()
    .from(feeStatementScheduleTable)
    .where(eq(feeStatementScheduleTable.tenantId, 1))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(feeStatementScheduleTable)
    .values({ tenantId: 1 })
    .returning();
  return created!;
}

// GET /finance/statement-schedule — get current config (SUPER_ADMIN)
router.get(
  "/finance/statement-schedule",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (req.userRole !== "SUPER_ADMIN") { res.status(403).json({ error: "FORBIDDEN" }); return; }
    const schedule = await getOrCreate();
    res.json({
      isEnabled:     schedule.isEnabled,
      dayOfMonth:    schedule.dayOfMonth,
      hour:          schedule.hour,
      lastRunAt:     schedule.lastRunAt?.toISOString() ?? null,
      lastRunCount:  schedule.lastRunCount,
      lastRunErrors: schedule.lastRunErrors,
      updatedAt:     schedule.updatedAt.toISOString(),
    });
  },
);

// PUT /finance/statement-schedule — update config (SUPER_ADMIN)
router.put(
  "/finance/statement-schedule",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (req.userRole !== "SUPER_ADMIN") { res.status(403).json({ error: "FORBIDDEN" }); return; }

    const { isEnabled, dayOfMonth, hour } = req.body as {
      isEnabled?: boolean; dayOfMonth?: number; hour?: number;
    };

    const dom = Number(dayOfMonth);
    const hr  = Number(hour);

    if (dayOfMonth !== undefined && (isNaN(dom) || dom < 1 || dom > 28)) {
      res.status(400).json({ error: "dayOfMonth must be between 1 and 28" }); return;
    }
    if (hour !== undefined && (isNaN(hr) || hr < 0 || hr > 23)) {
      res.status(400).json({ error: "hour must be between 0 and 23" }); return;
    }

    await getOrCreate(); // ensure row exists
    const [updated] = await db
      .update(feeStatementScheduleTable)
      .set({
        ...(isEnabled  !== undefined && { isEnabled }),
        ...(dayOfMonth !== undefined && { dayOfMonth: dom }),
        ...(hour       !== undefined && { hour: hr }),
        updatedAt: new Date(),
      })
      .where(eq(feeStatementScheduleTable.tenantId, 1))
      .returning();

    res.json({ ok: true, schedule: updated });
  },
);

// POST /finance/statement-schedule/trigger — run now (SUPER_ADMIN)
router.post(
  "/finance/statement-schedule/trigger",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    if (req.userRole !== "SUPER_ADMIN") { res.status(403).json({ error: "FORBIDDEN" }); return; }
    const result = await runStatementSchedulerCron(true);
    res.json(result);
  },
);

export default router;
