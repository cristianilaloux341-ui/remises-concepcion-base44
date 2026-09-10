import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { withRetry } from "@/lib/retryFetch";

export function useRealtimeOrders({ limit = 100, sort = "-created_date", fallbackRefreshMs = 0, verifyActiveMs = 0 } = {}) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);
  const ordersRef = useRef([]);
  const verifyActiveInFlightRef = useRef(false);

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

  useEffect(() => { ordersRef.current = orders; }, [orders]);

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

    // Reconciliación dirigida para la Central: una sola consulta cada pocos segundos
    // refresca TODOS los viajes que localmente siguen activos. Esto cubre cualquier salto
    // perdido por realtime: pendiente→ofrecido→aceptado→en_camino→en_viaje→completado/cancelado.
    const activeVerifier = verifyActiveMs > 0 ? setInterval(async () => {
      if (!mountedRef.current || document.visibilityState !== "visible" || verifyActiveInFlightRef.current) return;
      const activeStatuses = new Set(["pendiente", "preasignado_proximo", "ofrecido", "aceptado", "en_camino", "en_viaje"]);
      const activeIds = [...new Set((ordersRef.current || [])
        .filter(o => o?.id && activeStatuses.has(o.status))
        .map(o => o.id))];
      if (!activeIds.length) return;

      verifyActiveInFlightRef.current = true;
      try {
        const freshList = await base44.entities.RideOrder.filter({ id: { $in: activeIds } }).catch(() => []);
        if (!mountedRef.current || !Array.isArray(freshList) || !freshList.length) return;

        setOrders(prev => {
          let changed = false;
          const byId = new Map(freshList.map(o => [o.id, o]));
          const next = (Array.isArray(prev) ? prev : []).map(old => {
            const fresh = byId.get(old.id);
            if (!fresh) return old;
            if (
              fresh.status !== old.status ||
              fresh.updated_date !== old.updated_date ||
              fresh.assignment_attempt !== old.assignment_attempt ||
              fresh.driver_id !== old.driver_id ||
              fresh.reserved_driver_id !== old.reserved_driver_id ||
              fresh.offerExpiresAt !== old.offerExpiresAt
            ) {
              changed = true;
              return { ...old, ...fresh };
            }
            return old;
          });

          if (changed) {
            window.dispatchEvent(new CustomEvent("radiocab_force_alert_check", { detail: next }));
          }
          return changed ? next : prev;
        });
      } finally {
        verifyActiveInFlightRef.current = false;
      }
    }, verifyActiveMs) : null;

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", stopHidden);
      if (centralRefresh) clearInterval(centralRefresh);
      if (activeVerifier) clearInterval(activeVerifier);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [connect, fallbackRefreshMs, verifyActiveMs]);

  return { orders, isLoading };
}