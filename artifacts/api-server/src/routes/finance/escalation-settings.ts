import { Router } from "express";
import { db } from "@workspace/db";
import { escalationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { requireFinance } from "../../middlewares/requireRole.js";
import { invalidateEscalationThresholdsCache } from "../../lib/escalation-thresholds.js";

const router = Router();

async function ensureSettings() {
  const [existing] = await db
    .select()
    .from(escalationSettingsTable)
    .where(eq(escalationSettingsTable.tenantId, 1))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(escalationSettingsTable)
    .values({ tenantId: 1 })
    .returning();
  return created!;
}

// ── GET /finance/escalation-settings ────────────────────────────────────────
router.get("/finance/escalation-settings", requireAuth, requireFinance, async (_req, res) => {
  try {
    const settings = await ensureSettings();
    res.json({ warningDays: settings.warningDays, criticalDays: settings.criticalDays, updatedAt: settings.updatedAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to load escalation settings" });
  }
});

// ── PUT /finance/escalation-settings ────────────────────────────────────────
router.put("/finance/escalation-settings", requireAuth, requireFinance, async (req, res) => {
  const { warningDays, criticalDays } = req.body as { warningDays?: number; criticalDays?: number };

  if (
    typeof warningDays !== "number" || typeof criticalDays !== "number" ||
    warningDays < 1 || criticalDays < 1 ||
    warningDays >= criticalDays
  ) {
    res.status(400).json({ error: "warningDays must be ≥ 1 and strictly less than criticalDays" });
    return;
  }

  try {
    await ensureSettings();
    const [updated] = await db
      .update(escalationSettingsTable)
      .set({ warningDays, criticalDays, updatedAt: new Date() })
      .where(eq(escalationSettingsTable.tenantId, 1))
      .returning({ warningDays: escalationSettingsTable.warningDays, criticalDays: escalationSettingsTable.criticalDays, updatedAt: escalationSettingsTable.updatedAt });

    invalidateEscalationThresholdsCache();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to save escalation settings" });
  }
});

export default router;
