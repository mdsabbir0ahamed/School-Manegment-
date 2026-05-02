import Dexie, { type Table } from "dexie";

interface QueuedMutation {
  id?: number;
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  queuedAt: number;
  retries: number;
}

interface CachedAttendance {
  id?: number;
  date: string;
  studentId: number;
  status: string;
  classId?: number;
  notes?: string;
}

interface CachedInvoice {
  id: number;
  invoiceNumber: string;
  studentId: number;
  totalAmount: string;
  paidAmount: string;
  status: string;
  dueDate: string;
  month: string | null;
  cachedAt: number;
}

class ErpDatabase extends Dexie {
  mutationQueue!: Table<QueuedMutation, number>;
  attendanceCache!: Table<CachedAttendance, number>;
  invoiceCache!: Table<CachedInvoice, number>;

  constructor() {
    super("SchoolERP");
    this.version(1).stores({
      mutationQueue: "++id, url, method, queuedAt",
      attendanceCache: "++id, date, studentId, classId",
      invoiceCache: "id, studentId, status, dueDate",
    });
  }
}

export const erpDb = new ErpDatabase();

export async function queueMutation(url: string, method: string, body: unknown, headers: Record<string, string>): Promise<void> {
  await erpDb.mutationQueue.add({
    url,
    method,
    body: JSON.stringify(body),
    headers,
    queuedAt: Date.now(),
    retries: 0,
  });
}

export async function flushMutationQueue(onProgress?: (done: number, total: number) => void): Promise<{ success: number; failed: number }> {
  const queue = await erpDb.mutationQueue.orderBy("queuedAt").toArray();
  let success = 0;
  let failed = 0;
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { "Content-Type": "application/json", ...item.headers },
        body: item.body,
      });
      if (res.ok || res.status < 500) {
        await erpDb.mutationQueue.delete(item.id!);
        success++;
      } else {
        await erpDb.mutationQueue.update(item.id!, { retries: item.retries + 1 });
        failed++;
      }
    } catch {
      await erpDb.mutationQueue.update(item.id!, { retries: item.retries + 1 });
      failed++;
    }
    onProgress?.(i + 1, queue.length);
  }
  return { success, failed };
}

export async function getPendingCount(): Promise<number> {
  return erpDb.mutationQueue.count();
}

export async function cacheInvoices(invoices: CachedInvoice[]): Promise<void> {
  await erpDb.invoiceCache.bulkPut(invoices);
}

export async function getCachedInvoices(): Promise<CachedInvoice[]> {
  return erpDb.invoiceCache.toArray();
}
