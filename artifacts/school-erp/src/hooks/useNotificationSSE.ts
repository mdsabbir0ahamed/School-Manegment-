import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";

interface SSEPayload {
  unreadCount: number;
  notification?: { title: string; message: string; type: string };
}

export function useNotificationSSE() {
  const { token } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1000);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function connect() {
      if (cancelled) return;
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/notifications/stream", {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortRef.current.signal,
        });

        if (!res.ok || !res.body) {
          scheduleRetry();
          return;
        }

        retryDelay.current = 1000;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let eventName = "";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataLine = line.slice(6).trim();
            } else if (line === "" && dataLine) {
              try {
                const payload = JSON.parse(dataLine) as SSEPayload;
                if (eventName === "init" || eventName === "update") {
                  setUnreadCount(payload.unreadCount);
                }
              } catch {
                // ignore malformed frames
              }
              eventName = "";
              dataLine = "";
            }
          }
        }

        if (!cancelled) scheduleRetry();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!cancelled) scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (cancelled) return;
      retryRef.current = setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 30000);
        connect();
      }, retryDelay.current);
    }

    connect();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [token]);

  return { unreadCount, setUnreadCount };
}
