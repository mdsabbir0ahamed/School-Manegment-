import { createContext, useContext, useState } from "react";
import { User } from "@workspace/api-client-react";

export const ROLE_CONFIG = {
  SUPER_ADMIN: {
    label: "Super Admin",
    allowedRoutes: [
      "/dashboard", "/students", "/attendance", "/finance",
      "/classes", "/users", "/settings", "/audit",
      "/subjects", "/timetable", "/notifications",
      "/calendar", "/documents", "/qr", "/report-card",
      "/assets", "/tenants", "/payroll", "/library",
    ],
    canManageStudents: true,
    canManageFinance: true,
    canManageStaff: true,
    canManageClasses: true,
    canDeleteStudents: true,
  },
  TEACHER: {
    label: "Teacher",
    allowedRoutes: [
      "/dashboard", "/students", "/attendance", "/classes",
      "/subjects", "/timetable", "/notifications", "/calendar", "/qr", "/report-card",
      "/assets", "/library",
    ],
    canManageStudents: true,
    canManageFinance: false,
    canManageStaff: false,
    canManageClasses: false,
    canDeleteStudents: false,
  },
  ACCOUNTANT: {
    label: "Accountant",
    allowedRoutes: ["/dashboard", "/finance", "/payroll", "/notifications", "/calendar", "/library"],
    canManageStudents: false,
    canManageFinance: true,
    canManageStaff: false,
    canManageClasses: false,
    canDeleteStudents: false,
  },
  PARENT: {
    label: "Parent",
    allowedRoutes: ["/dashboard", "/parent", "/notifications", "/calendar"],
    canManageStudents: false,
    canManageFinance: false,
    canManageStaff: false,
    canManageClasses: false,
    canDeleteStudents: false,
  },
  STUDENT: {
    label: "Student",
    allowedRoutes: ["/dashboard", "/student", "/notifications", "/calendar", "/settings"],
    canManageStudents: false,
    canManageFinance: false,
    canManageStaff: false,
    canManageClasses: false,
    canDeleteStudents: false,
  },
} as const;

export type UserRole = keyof typeof ROLE_CONFIG;

export function getPermissions(role?: string | null) {
  const r = (role ?? "STUDENT") as UserRole;
  return ROLE_CONFIG[r] ?? ROLE_CONFIG.STUDENT;
}

export function canAccessRoute(role: string | undefined | null, route: string): boolean {
  const perms = getPermissions(role);
  return (perms.allowedRoutes as readonly string[]).includes(route);
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  setToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    return localStorage.getItem("erp_token");
  });

  const [user, setUser] = useState<User | null>(() => {
    const userStr = localStorage.getItem("erp_user");
    return userStr ? JSON.parse(userStr) : null;
  });

  const setToken = (newToken: string | null) => {
    if (newToken) {
      localStorage.setItem("erp_token", newToken);
    } else {
      localStorage.removeItem("erp_token");
    }
    setTokenState(newToken);
  };

  const handleSetUser = (newUser: User | null) => {
    if (newUser) {
      localStorage.setItem("erp_user", JSON.stringify(newUser));
    } else {
      localStorage.removeItem("erp_user");
    }
    setUser(newUser);
  };

  const logout = () => {
    setToken(null);
    handleSetUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, setToken, setUser: handleSetUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function usePermissions() {
  const { user } = useAuth();
  return getPermissions(user?.role);
}
