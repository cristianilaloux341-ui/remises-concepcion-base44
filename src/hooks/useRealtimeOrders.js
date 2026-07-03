import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundSync } from "./useBackgroundSync";
import { withRetry } from "@/lib/retryFetch";

export function useRealtimeOrders({ limit = 100, sort = "-created_date" } = {}) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    return withRetry(() => base44.entities.RideOrder.list(sort, limit)).then((data) => {
      if (mountedRef.current) {
        setOrders(Array.isArray(data) ? data : []);
        setIsLoading(false);
      }
    }).catch((err) => {
      if (mountedRef.current) {
        setIsLoading(false);
        console.error("Order fetch error:", err);
      }
    });
  }, [limit, sort]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    console.log("[Realtime] Iniciando conexión de canal: Orders...");

    unsubRef.current?.();
    unsubRef.current = null;

    fetchAll();

    unsubRef.current = base44.entities.RideOrder.subscribe((event) => {
      if (!mountedRef.current) return;
      setOrders((prev) => {
        if (!event.data) return prev;
        if (!Array.isArray(prev)) {
            console.error("[CRITICAL ERROR] prev in useRealtimeOrders is NOT an array! Type:", typeof prev, "Value:", prev);
            prev = [];
        }
        if (event.type === "create") {
          if (prev.some(o => o.id === event.id)) return prev.map((o) => (o.id === event.id ? { ...o, ...event.data } : o));
          return [event.data, ...prev].slice(0, limit);
        }
        if (event.type === "update") {
          const exists = prev.some(o => o.id === event.id);
          if (exists) return prev.map((o) => (o.id === event.id ? { ...o, ...event.data } : o));
          return [event.data, ...prev].slice(0, limit);
        }
        if (event.type === "delete") return prev.filter((o) => o.id !== event.id);
        return prev;
      });
    });
  }, [fetchAll, limit]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Polling en segundo plano sin destruir el WebSocket
    const pollInterval = setInterval(() => {
      fetchAll();
    }, 15000);

    return () => {
      mountedRef.current = false;
      unsubRef.current?.();
      clearInterval(pollInterval);
    };
  }, [connect, fetchAll]);

  useBackgroundSync(connect);

  return { orders, isLoading };
}