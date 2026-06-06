import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundSync } from "./useBackgroundSync";

/**
 * Suscripción en tiempo real a conductores con reconexión automática
 * cuando la app vuelve del background / pantalla desbloqueada.
 */
export function useRealtimeDrivers() {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    unsubRef.current?.();
    unsubRef.current = null;

    base44.entities.Driver.list().then((data) => {
      if (mountedRef.current) {
        setDrivers(data);
        setIsLoading(false);
      }
    });

    unsubRef.current = base44.entities.Driver.subscribe((event) => {
      if (!mountedRef.current) return;
      setDrivers((prev) => {
        if (event.type === "create") return [...prev, event.data];
        if (event.type === "update") return prev.map((d) => (d.id === event.id ? event.data : d));
        if (event.type === "delete") return prev.filter((d) => d.id !== event.id);
        return prev;
      });
    });
  }, []);

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

  return { drivers, isLoading };
}