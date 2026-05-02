import { useEffect, useState, useCallback } from "react";
import { flushMutationQueue, getPendingCount } from "@/lib/syncEngine";

export interface SyncState {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  lastSyncResult: { success: number; failed: number } | null;
}

export function useSyncEngine() {
  const [state, setState] = useState<SyncState>({
    isOnline: navigator.onLine,
    pendingCount: 0,
    isSyncing: false,
    lastSyncedAt: null,
    lastSyncResult: null,
  });

  const refreshPendingCount = useCallback(async () => {
    const count = await getPendingCount();
    setState(s => ({ ...s, pendingCount: count }));
  }, []);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setState(s => ({ ...s, isSyncing: true }));
    try {
      const result = await flushMutationQueue();
      const count = await getPendingCount();
      setState(s => ({
        ...s,
        isSyncing: false,
        pendingCount: count,
        lastSyncedAt: new Date(),
        lastSyncResult: result,
      }));
    } catch {
      setState(s => ({ ...s, isSyncing: false }));
    }
  }, []);

  useEffect(() => {
    refreshPendingCount();

    const handleOnline = () => {
      setState(s => ({ ...s, isOnline: true }));
      sync();
    };

    const handleOffline = () => {
      setState(s => ({ ...s, isOnline: false }));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(refreshPendingCount, 15_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [sync, refreshPendingCount]);

  return { ...state, sync, refreshPendingCount };
}
