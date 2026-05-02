import { createContext, useContext, useEffect, useState } from "react";

export interface TenantConfig {
  id: number;
  name: string;
  subdomain: string;
  primaryColor: string;
  primaryColorDark: string;
  logoUrl: string | null;
  contactEmail: string | null;
  plan: string;
}

const DEFAULT_TENANT: TenantConfig = {
  id: 1,
  name: "SchoolERP",
  subdomain: "default",
  primaryColor: "#4F46E5",
  primaryColorDark: "#3730A3",
  logoUrl: null,
  contactEmail: null,
  plan: "FREE",
};

interface TenantContextType {
  tenant: TenantConfig;
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  tenant: DEFAULT_TENANT,
  isLoading: false,
});

function detectSubdomain(): string {
  const host = window.location.hostname;
  const parts = host.split(".");
  if (parts.length >= 3 && parts[0] !== "www") {
    return parts[0]!;
  }
  return "default";
}

function applyTenantTheme(tenant: TenantConfig) {
  const root = document.documentElement;
  root.style.setProperty("--color-tenant-primary", tenant.primaryColor);
  root.style.setProperty("--color-tenant-primary-dark", tenant.primaryColorDark);
  const hex = tenant.primaryColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  root.style.setProperty("--color-tenant-primary-rgb", `${r} ${g} ${b}`);
}

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<TenantConfig>(DEFAULT_TENANT);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const subdomain = detectSubdomain();
    fetch(`${BASE_URL}/api/tenants/config?subdomain=${encodeURIComponent(subdomain)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: TenantConfig | null) => {
        if (data) {
          setTenant(data);
          applyTenantTheme(data);
          document.title = `${data.name} — ERP`;
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, isLoading }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
