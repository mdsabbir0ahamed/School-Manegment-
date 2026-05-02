import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./requireAuth.js";

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole("SUPER_ADMIN");
export const requireSuperAdmin = requireRole("SUPER_ADMIN");
export const requireFinance = requireRole("SUPER_ADMIN", "ACCOUNTANT");
export const requireAcademic = requireRole("SUPER_ADMIN", "TEACHER");
