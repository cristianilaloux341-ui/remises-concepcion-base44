import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundSync } from "./useBackgroundSync";

/**
 * Suscripción en tiempo real a órdenes con reconexión automática
 * cuando la app vuelve del background / pantalla desbloqueada.
 */
export function useRealtimeOrders({ limit = 100, sort = "-created_date" } = {}) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Desconectar suscripción anterior si existe
    unsubRef.current?.();
    unsubRef.current = null;

    // Recargar datos frescos
    base44.entities.RideOrder.list(sort, limit).then((data) => {
      if (mountedRef.current) {
        setOrders(data);
        setIsLoading(false);
      }
    });

    // Nueva suscripción en tiempo real
    unsubRef.current = base44.entities.RideOrder.subscribe((event) => {
      if (!mountedRef.current) return;
      setOrders((prev) => {
        if (event.type === "create") return [event.data, ...prev].slice(0, limit);
        if (event.type === "update") return prev.map((o) => (o.id === event.id ? event.data : o));
        if (event.type === "delete") return prev.filter((o) => o.id !== event.id);
        return prev;
      });
    });
  }, [limit, sort]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      unsubRef.current?.();
    };
  }, [connect]);

  // Reconectar automáticamente al volver del background
  useBackgroundSync(connect);

  return { orders, isLoading };
}