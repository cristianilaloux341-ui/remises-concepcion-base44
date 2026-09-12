import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { withRetry } from "@/lib/retryFetch";

export function useRealtimeDrivers({ refreshIntervalMs = 10000 } = {}) {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorInfo, setErrorInfo] = useState(null);
  const mountedRef = useRef(true);
  const unsubRef = useRef(null);
  const realtimeBufferRef = useRef(new Map());
  const flushTimeoutRef = useRef(null);
  const fetchSeqRef = useRef(0);
  const realtimeSeqRef = useRef(0);

  const fetchAll = useCallback(() => {
    if (!mountedRef.current) return;
    const requestSeq = ++fetchSeqRef.current;
    const realtimeSeqAtStart = realtimeSeqRef.current;
    console.log("[Realtime-Background] Ejecutando fetchAll() en Drivers...");
    return withRetry(() => base44.entities.Driver.list('-created_date', 500)).then((data) => {
      if (mountedRef.current && requestSeq === fetchSeqRef.current) {
        const arr = Array.isArray(data) ? data : [];
        console.log(`[Realtime-Background] Fetch Drivers OK - ${arr.length} choferes`);

        // Un fetch puede arrancar antes que un evento realtime y terminar después.
        // No permitimos que una respuesta vieja haga retroceder queue_entered_at/base
        // en pantalla. Si hubo realtime durante el fetch, se conserva por registro el
        // estado con updated_date más nuevo.
        if (realtimeSeqRef.current !== realtimeSeqAtStart) {
          setDrivers(prev => {
            const prevById = new Map((Array.isArray(prev) ? prev : []).map(d => [d.id, d]));
            return arr.map(fresh => {
              const current = prevById.get(fresh.id);
              if (!current) return fresh;
              const freshMs = new Date(fresh.updated_date || 0).getTime();
              const currentMs = new Date(current.updated_date || 0).getTime();
              return currentMs > freshMs ? current : fresh;
            });
          });
        } else {
          setDrivers(arr);
        }
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

    // Cancelar suscripción/timer anterior antes de reconectar. El cleanup que
    // antes devolvía connect() no era consumido por el caller y podía dejar un
    // flush viejo vivo después de visibility/reconnect.
    unsubRef.current?.();
    unsubRef.current = null;
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    realtimeBufferRef.current.clear();

    // Fetch inicial
    fetchAll();

    // Buffer deduplicado por chofer: si un móvil manda varios heartbeats/GPS en
    // el mismo segundo, conservar solo el último evento de ese móvil.
    unsubRef.current = base44.entities.Driver.subscribe((event) => {
      if (!mountedRef.current || !event.data) return;
      realtimeSeqRef.current += 1;
      const eventId = event.data.id || event.id;
      if (!eventId) return;
      realtimeBufferRef.current.set(eventId, event);

      if (!flushTimeoutRef.current) {
        flushTimeoutRef.current = setTimeout(() => {
          flushTimeoutRef.current = null;
          if (!mountedRef.current) {
            realtimeBufferRef.current.clear();
            return;
          }

          const bufferedEvents = [...realtimeBufferRef.current.values()];
          realtimeBufferRef.current.clear();
          if (!bufferedEvents.length) return;

          setDrivers((prev) => {
            if (!Array.isArray(prev)) prev = [];
            let next = [...prev];
            let changed = false;

            for (const ev of bufferedEvents) {
              if (ev.type === "create" || ev.type === "update") {
                const eventDriver = { ...ev.data, id: ev.data.id || ev.id };
                const idx = next.findIndex(d => d.id === eventDriver.id);
                if (idx >= 0) {
                  const current = next[idx];
                  const hasDifference = Object.keys(eventDriver).some(k => current?.[k] !== eventDriver[k]);
                  if (hasDifference) {
                    next[idx] = { ...current, ...eventDriver };
                    changed = true;
                  }
                } else {
                  next.push(eventDriver);
                  changed = true;
                }
              } else if (ev.type === "delete") {
                const before = next.length;
                next = next.filter(d => d.id !== ev.id);
                if (next.length !== before) changed = true;
              }
            }
            return changed ? next : prev;
          });
        }, 1000);
      }
    });
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
        if (flushTimeoutRef.current) {
          clearTimeout(flushTimeoutRef.current);
          flushTimeoutRef.current = null;
        }
        realtimeBufferRef.current.clear();
      } else {
        startVisible();
      }
    };

    startVisible();
    document.addEventListener("visibilitychange", stopHidden);

    // Respaldo contra canales realtime congelados. El intervalo es configurable:
    // la Central usa 30s para no reconstruir 500 choferes seis veces por minuto,
    // mientras el comportamiento por defecto queda en 10s para no alterar otros consumidores.
    const refreshInterval = refreshIntervalMs > 0 ? setInterval(() => {
      if (mountedRef.current && document.visibilityState === "visible") {
        fetchAll();
      }
    }, refreshIntervalMs) : null;

    return () => {
      mountedRef.current = false;
      if (refreshInterval) clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", stopHidden);
      unsubRef.current?.();
      unsubRef.current = null;
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      realtimeBufferRef.current.clear();
    };
  }, [connect, fetchAll, refreshIntervalMs]);

  useEffect(() => {
    const handleForceRefresh = () => fetchAll();
    window.addEventListener('force-driver-refresh', handleForceRefresh);
    window.addEventListener('radiocab_reconnect', handleForceRefresh);
    window.addEventListener('online', handleForceRefresh);
    return () => {
      window.removeEventListener('force-driver-refresh', handleForceRefresh);
      window.removeEventListener('radiocab_reconnect', handleForceRefresh);
      window.removeEventListener('online', handleForceRefresh);
    };
  }, [fetchAll]);

  return { drivers, isLoading, error: errorInfo };
}