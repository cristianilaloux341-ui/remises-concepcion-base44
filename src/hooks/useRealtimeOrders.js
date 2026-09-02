import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { withRetry } from "@/lib/retryFetch";

export function useRealtimeOrders({ limit = 100, sort = "-created_date", fallbackRefreshMs = 0 } = {}) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    console.log("[Realtime-Background] Ejecutando fetchAll() en Orders...");
    return withRetry(() => base44.entities.RideOrder.list(sort, limit)).then((data) => {
      if (mountedRef.current) {
        const arr = Array.isArray(data) ? data : [];
        console.log(`[Realtime-Background] Fetch Orders OK - ${arr.length} viajes`);
        setOrders(arr);
        window.dispatchEvent(new CustomEvent('radiocab_force_alert_check', { detail: arr }));
        setIsLoading(false);
      }
    }).catch((err) => {
      if (mountedRef.current) {
        setIsLoading(false);
        console.error("[Realtime-Background] Error en fetch Orders:", err);
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
        let next = prev;
        if (event.type === "create") {
          if (prev.some(o => o.id === event.id)) next = prev.map((o) => (o.id === event.id ? { ...o, ...event.data } : o));
          else next = [event.data, ...prev].slice(0, limit);
        } else if (event.type === "update") {
          const exists = prev.some(o => o.id === event.id);
          if (exists) next = prev.map((o) => (o.id === event.id ? { ...o, ...event.data } : o));
          else next = [event.data, ...prev].slice(0, limit);
        } else if (event.type === "delete") {
          next = prev.filter((o) => o.id !== event.id);
        }
        window.dispatchEvent(new CustomEvent('radiocab_force_alert_check', { detail: next }));
        return next;
      });
    });
  }, [fetchAll, limit]);

  useEffect(() => {
    mountedRef.current = true;

    const startVisible = () => {
      if (!mountedRef.current || document.visibilityState !== "visible") return;
      connect();
    };
    const stopHidden = () => {
      if (document.visibilityState === "hidden") {
        unsubRef.current?.();
        unsubRef.current = null;
      } else {
        startVisible();
      }
    };

    startVisible();
    document.addEventListener("visibilitychange", stopHidden);

    // Respaldo opcional para pantallas de Central que necesitan reflejar estados rápido.
    // El chofer sigue trabajando solo con realtime para no agregarle polling.
    const centralRefresh = fallbackRefreshMs > 0 ? setInterval(() => {
      if (mountedRef.current && document.visibilityState === "visible") fetchAll();
    }, fallbackRefreshMs) : null;

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", stopHidden);
      if (centralRefresh) clearInterval(centralRefresh);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [connect, fallbackRefreshMs]);

  return { orders, isLoading };
}