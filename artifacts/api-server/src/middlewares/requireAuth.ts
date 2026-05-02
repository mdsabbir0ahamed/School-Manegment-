import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/auth.js";

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  userEmail?: string;
  tenantId?: number;
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Missing token" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "UNAUTHORIZED", message: "Invalid token" });
    return;
  }
  req.userId = payload.sub;
  req.userRole = payload.role;
  req.userEmail = payload.email;
  next();
}
