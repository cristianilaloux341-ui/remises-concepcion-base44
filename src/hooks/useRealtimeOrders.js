import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundSync } from "./useBackgroundSync";
import { withRetry } from "@/lib/retryFetch";

const POLL_INTERVAL_MS = 15_000; // fallback poll cada 15s si la suscripción cae

export function useRealtimeOrders({ limit = 100, sort = "-created_date" } = {}) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);
  const pollRef = useRef(null);
  const lastEventRef = useRef(Date.now());

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    return withRetry(() => base44.entities.RideOrder.list(sort, limit)).then((data) => {
      if (mountedRef.current) {
        setOrders(data);
        setIsLoading(false);
        lastEventRef.current = Date.now();
      }
    }).catch(() => {
      if (mountedRef.current) setIsLoading(false);
    });
  }, [limit, sort]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    unsubRef.current?.();
    unsubRef.current = null;

    fetchAll();

    unsubRef.current = base44.entities.RideOrder.subscribe((event) => {
      if (!mountedRef.current) return;
      lastEventRef.current = Date.now();
      setOrders((prev) => {
        if (event.type === "create") return [event.data, ...prev].slice(0, limit);
        if (event.type === "update") return prev.map((o) => (o.id === event.id ? { ...o, ...event.data } : o));
        if (event.type === "delete") return prev.filter((o) => o.id !== event.id);
        return prev;
      });
    });
  }, [fetchAll, limit]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Poll de respaldo: si la suscripción cayó silenciosamente, re-fetch
    pollRef.current = setInterval(() => {
      if (Date.now() - lastEventRef.current > POLL_INTERVAL_MS * 2) {
        fetchAll();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      unsubRef.current?.();
      clearInterval(pollRef.current);
    };
  }, [connect, fetchAll]);

  useBackgroundSync(connect);

  return { orders, isLoading };
}