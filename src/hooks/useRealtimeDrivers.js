import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useBackgroundSync } from "./useBackgroundSync";
import { withRetry } from "@/lib/retryFetch";

const POLL_INTERVAL_MS = 15_000; // fallback poll cada 15s si la suscripción cae

export function useRealtimeDrivers() {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);
  const pollRef = useRef(null);
  const lastEventRef = useRef(Date.now());

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    return withRetry(() => base44.entities.Driver.list(undefined, 500)).then((data) => {
      if (mountedRef.current) {
        setDrivers(data);
        setIsLoading(false);
        lastEventRef.current = Date.now();
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
      lastEventRef.current = Date.now();
      setDrivers((prev) => {
        if (event.type === "create") return [...prev, event.data];
        if (event.type === "update") return prev.map((d) => (d.id === event.id ? { ...d, ...event.data } : d));
        if (event.type === "delete") return prev.filter((d) => d.id !== event.id);
        return prev;
      });
    });
  }, [fetchAll]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    // Poll de respaldo: si no hubo evento en 2× el intervalo, re-fetch forzado
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

  return { drivers, isLoading };
}