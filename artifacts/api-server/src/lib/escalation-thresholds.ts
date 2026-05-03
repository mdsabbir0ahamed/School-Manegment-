import { db } from "@workspace/db";
import { escalationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export type EscalationThresholds = { warningDays: number; criticalDays: number };

const DEFAULTS: EscalationThresholds = { warningDays: 7, criticalDays: 30 };
const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: EscalationThresholds | null = null;
let cacheExpiresAt = 0;

export async function getEscalationThresholds(): Promise<EscalationThresholds> {
  const now = Date.now();
  if (cached && now < cacheExpiresAt) return cached;

  try {
    const [row] = await db
      .select({ warningDays: escalationSettingsTable.warningDays, criticalDays: escalationSettingsTable.criticalDays })
      .from(escalationSettingsTable)
      .where(eq(escalationSettingsTable.tenantId, 1))
      .limit(1);

    if (row) {
      cached = { warningDays: row.warningDays, criticalDays: row.criticalDays };
      cacheExpiresAt = now + CACHE_TTL_MS;
      return cached;
    }

    const [created] = await db
      .insert(escalationSettingsTable)
      .values({ tenantId: 1 })
      .returning({ warningDays: escalationSettingsTable.warningDays, criticalDays: escalationSettingsTable.criticalDays });

    cached = { warningDays: created!.warningDays, criticalDays: created!.criticalDays };
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cached;
  } catch (err) {
    logger.error({ err }, "Failed to load escalation thresholds, using defaults");
    return DEFAULTS;
  }
}

export function invalidateEscalationThresholdsCache(): void {
  cached = null;
  cacheExpiresAt = 0;
}
