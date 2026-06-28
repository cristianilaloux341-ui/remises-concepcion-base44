import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundSync } from "./useBackgroundSync";
import { withRetry } from "@/lib/retryFetch";

export function useRealtimeDrivers() {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    return withRetry(() => base44.entities.Driver.list(undefined, 500)).then((data) => {
      if (mountedRef.current) {
        setDrivers(data);
        setIsLoading(false);
      }
    }).catch(() => {
      // Aunque falle, salimos del estado loading para no bloquear la UI
      if (mountedRef.current) setIsLoading(false);
    });
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Cancelar suscripción anterior
    unsubRef.current?.();
    unsubRef.current = null;

    // Fetch inicial
    fetchAll();

    // Suscripción en tiempo real
    unsubRef.current = base44.entities.Driver.subscribe((event) => {
      if (!mountedRef.current) return;
      setDrivers((prev) => {
        if (!event.data) return prev; // Fallback si el payload es muy grande
        if (event.type === "create") {
          if (prev.some(d => d.id === event.id)) return prev.map(d => d.id === event.id ? { ...d, ...event.data } : d);
          return [...prev, event.data];
        }
        if (event.type === "update") {
          const exists = prev.some(d => d.id === event.id);
          if (exists) return prev.map((d) => (d.id === event.id ? { ...d, ...event.data } : d));
          return [...prev, event.data];
        }
        if (event.type === "delete") return prev.filter((d) => d.id !== event.id);
        return prev;
      });
    });
  }, [fetchAll]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      unsubRef.current?.();
    };
  }, [connect, fetchAll]);

  useBackgroundSync(connect);

  return { drivers, isLoading };
}