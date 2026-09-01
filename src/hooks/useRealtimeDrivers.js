import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { withRetry } from "@/lib/retryFetch";

export function useRealtimeDrivers() {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorInfo, setErrorInfo] = useState(null);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    console.log("[Realtime-Background] Ejecutando fetchAll() en Drivers...");
    return withRetry(() => base44.entities.Driver.list('-created_date', 500)).then((data) => {
      if (mountedRef.current) {
        const arr = Array.isArray(data) ? data : [];
        console.log(`[Realtime-Background] Fetch Drivers OK - ${arr.length} choferes`);
        setDrivers(arr);
        setIsLoading(false);
        setErrorInfo(null);
      }
    }).catch((err) => {
      // Mostrar el error en pantalla si falla
      if (mountedRef.current) {
        setIsLoading(false);
        console.error("[Realtime-Background] Error en fetch Drivers:", err);
        setErrorInfo(err?.message || err?.toString() || "Error desconocido al cargar");
      }
    });
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    console.log("[Realtime] Iniciando conexión de canal: Drivers...");

    // Cancelar suscripción anterior
    unsubRef.current?.();
    unsubRef.current = null;

    // Fetch inicial
    fetchAll();

    // Suscripción en tiempo real con BUFFER (throttle) para no trabar la central
    const buffer = [];
    let flushTimeout = null;

    unsubRef.current = base44.entities.Driver.subscribe((event) => {
      if (!mountedRef.current || !event.data) return;
      
      buffer.push(event);

      // Programar un flush para aplicar todos los cambios juntos (max 1 vez por segundo)
      if (!flushTimeout) {
        flushTimeout = setTimeout(() => {
          if (!mountedRef.current) return;
          
          setDrivers((prev) => {
            if (!Array.isArray(prev)) {
               console.error("[CRITICAL ERROR] prev in useRealtimeDrivers is NOT an array! Type:", typeof prev, "Value:", prev);
               prev = [];
            }
            let next = [...prev];
            // Aplicar todos los eventos acumulados en el buffer
            for (const ev of buffer) {
              if (ev.type === "create" || ev.type === "update") {
                const idx = next.findIndex(d => d.id === ev.id);
                if (idx >= 0) {
                  next[idx] = { ...next[idx], ...ev.data };
                } else {
                  next.push(ev.data);
                }
              } else if (ev.type === "delete") {
                next = next.filter(d => d.id !== ev.id);
              }
            }
            return next;
          });

          // Limpiar buffer
          buffer.length = 0;
          flushTimeout = null;
        }, 1000);
      }
    });

    return () => {
      if (flushTimeout) clearTimeout(flushTimeout);
    };
  }, [fetchAll]);

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

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", stopHidden);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [connect]);

  useEffect(() => {
    const handleForceRefresh = () => fetchAll();
    window.addEventListener('force-driver-refresh', handleForceRefresh);
    return () => window.removeEventListener('force-driver-refresh', handleForceRefresh);
  }, [fetchAll]);

  return { drivers, isLoading, error: errorInfo };
}