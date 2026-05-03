import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, canAccessRoute, ROLE_CONFIG, type UserRole } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useNotificationSSE } from "@/hooks/useNotificationSSE";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Users, GraduationCap, CalendarCheck,
  Banknote, BookOpen, Settings, LogOut, Menu, X, School,
  ChevronRight, ShieldCheck, CalendarDays, Clock, Bell,
  Sun, Moon, Home, QrCode, FolderOpen, FileText, Cpu,
  Building2, WifiOff, RefreshCw, Wallet, Library,
} from "lucide-react";

const ALL_NAV_ITEMS = [
  { href: "/dashboard",      label: "Dashboard",       icon: LayoutDashboard },
  { href: "/student",        label: "My Portal",        icon: School },
  { href: "/parent",         label: "My Children",      icon: Home },
  { href: "/students",       label: "Students",         icon: GraduationCap },
  { href: "/attendance",     label: "Attendance",       icon: CalendarCheck },
  { href: "/subjects",       label: "Subjects & Marks", icon: BookOpen },
  { href: "/timetable",      label: "Timetable",        icon: Clock },
  { href: "/qr",             label: "QR Codes",         icon: QrCode },
  { href: "/finance",        label: "Finance",          icon: Banknote },
  { href: "/payroll",        label: "Payroll",          icon: Wallet },
  { href: "/classes",        label: "Classes",          icon: BookOpen },
  { href: "/documents",      label: "Documents",        icon: FolderOpen },
  { href: "/report-card",    label: "Report Card",      icon: FileText },
  { href: "/calendar",       label: "Calendar",         icon: CalendarDays },
  { href: "/assets",         label: "Asset Management", icon: Cpu },
  { href: "/library",        label: "Library",          icon: Library },
  { href: "/users",          label: "Staff",            icon: Users },
  { href: "/notifications",  label: "Notifications",    icon: Bell },
  { href: "/settings",       label: "Settings",         icon: Settings },
  { href: "/audit",          label: "Audit Log",        icon: ShieldCheck },
  { href: "/tenants",        label: "Tenants",          icon: Building2 },
];

const ROLE_BADGE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-purple-500/20 text-purple-300",
  TEACHER: "bg-blue-500/20 text-blue-300",
  ACCOUNTANT: "bg-emerald-500/20 text-emerald-300",
  PARENT: "bg-orange-500/20 text-orange-300",
  STUDENT: "bg-gray-500/20 text-gray-300",
};

const TYPE_ICON: Record<string, string> = {
  INFO: "ℹ️",
  SUCCESS: "✅",
  WARNING: "⚠️",
  DANGER: "🚨",
};

function NotificationBell({ unreadCount }: { unreadCount: number }) {
  return (
    <Link href="/notifications">
      <button className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </Link>
  );
}

function OfflineIndicator() {
  const { isOnline, pendingCount, isSyncing, sync } = useSyncEngine();

  if (isOnline && pendingCount === 0) return null;

  if (!isOnline) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-amber-400">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span className="text-xs font-medium">Offline</span>
        {pendingCount > 0 && (
          <span className="text-xs text-amber-500/80">· {pendingCount} pending</span>
        )}
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <button
        onClick={sync}
        disabled={isSyncing}
        className="flex items-center gap-1.5 rounded-md bg-blue-500/15 border border-blue-500/30 px-2 py-1 text-blue-400 hover:bg-blue-500/25 transition-colors"
      >
        <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", isSyncing && "animate-spin")} />
        <span className="text-xs font-medium">{isSyncing ? "Syncing..." : `Sync ${pendingCount}`}</span>
      </button>
    );
  }

  return null;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { tenant } = useTenant();
  const { toast } = useToast();

  const { unreadCount, incomingNotification } = useNotificationSSE();

  useEffect(() => {
    if (!incomingNotification) return;
    const icon = TYPE_ICON[incomingNotification.type] ?? "🔔";
    toast({
      title: `${icon} ${incomingNotification.title}`,
      description: incomingNotification.message,
      variant: incomingNotification.type === "DANGER" ? "destructive" : "default",
    });
  }, [incomingNotification?.id]);

  const role = user?.role ?? "STUDENT";
  const navItems = ALL_NAV_ITEMS.filter(item => canAccessRoute(role, item.href));
  const currentPage = ALL_NAV_ITEMS.find(n => n.href === location);
  const roleLabel = ROLE_CONFIG[role as UserRole]?.label ?? role;
  const roleBadgeColor = ROLE_BADGE_COLORS[role] ?? ROLE_BADGE_COLORS.STUDENT;

  const sidebarAccentStyle = {
    "--sidebar-accent-color": tenant.primaryColor,
  } as React.CSSProperties;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        style={sidebarAccentStyle}
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col bg-sidebar text-sidebar-foreground transition-transform duration-300 ease-in-out",
          "lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}>
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          {tenant.logoUrl ? (
            <img src={tenant.logoUrl} alt={tenant.name} className="h-8 w-8 rounded-lg object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: tenant.primaryColor }}>
              <School className="h-4 w-4 text-white" />
            </div>
          )}
          <span className="text-sm font-semibold tracking-tight text-white truncate">{tenant.name}</span>
          <button className="ml-auto lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground" onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = location === href || (href !== "/dashboard" && location.startsWith(href));
            return (
              <Link key={href} href={href} onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "text-white" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
                style={active ? { backgroundColor: tenant.primaryColor } : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
                {active && <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: tenant.primaryColor + "33", border: `1px solid ${tenant.primaryColor}66` }}>
              {user ? `${user.firstName[0]}${user.lastName[0]}` : "??"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-sidebar-foreground">
                {user ? `${user.firstName} ${user.lastName}` : "User"}
              </p>
              <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold mt-0.5", roleBadgeColor)}>
                {roleLabel}
              </span>
            </div>
            <button onClick={logout} title="Logout" className="text-sidebar-foreground/40 hover:text-destructive transition-colors">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-card px-4 gap-4">
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{tenant.name}</span>
            {currentPage && (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                <span className="font-medium">{currentPage.label}</span>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <OfflineIndicator />
            <button onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <NotificationBell unreadCount={unreadCount} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
