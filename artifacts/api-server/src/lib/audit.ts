import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";

export interface AuditEntry {
  userId?: number | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      userId: entry.userId ?? null,
      userEmail: entry.userEmail ?? null,
      userRole: entry.userRole ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      description: entry.description ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch {
    // Audit failures must never break the actual request
  }
}
