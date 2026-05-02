import type { Response } from "express";
import { logger } from "./logger.js";

class SSEManager {
  private clients = new Map<number, Set<Response>>();

  add(userId: number, res: Response): void {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(res);
    logger.info({ userId, total: this.clients.get(userId)!.size }, "SSE client connected");
  }

  remove(userId: number, res: Response): void {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.clients.delete(userId);
    logger.info({ userId }, "SSE client disconnected");
  }

  sendToUser(userId: number, event: string, data: unknown): void {
    const conns = this.clients.get(userId);
    if (!conns || conns.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of conns) {
      try {
        res.write(payload);
      } catch {
        this.remove(userId, res);
      }
    }
  }

  broadcastToAll(event: string, data: unknown): void {
    for (const [userId] of this.clients) {
      this.sendToUser(userId, event, data);
    }
  }

  connectedCount(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }
}

export const sseManager = new SSEManager();
