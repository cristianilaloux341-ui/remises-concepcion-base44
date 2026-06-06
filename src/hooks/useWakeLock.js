import { useEffect, useRef, useCallback } from "react";

/**
 * useWakeLock — Mantiene la pantalla activa usando la Screen Wake Lock API.
 * Cuando el usuario minimiza la app o la pantalla se bloquea, re-adquiere el
 * lock automáticamente al volver al primer plano.
 *
 * @param {boolean} enabled — activar/desactivar el wake lock
 */
export function useWakeLock(enabled = true) {
  const lockRef = useRef(null);

  const acquire = useCallback(async () => {
    if (!enabled || !("wakeLock" in navigator)) return;
    if (lockRef.current && !lockRef.current.released) return; // ya activo
    try {
      lockRef.current = await navigator.wakeLock.request("screen");
    } catch (_) {
      // El dispositivo puede rechazarlo si la batería está baja — no crítico
    }
  }, [enabled]);

  const release = useCallback(async () => {
    if (lockRef.current && !lockRef.current.released) {
      await lockRef.current.release().catch(() => {});
      lockRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) { release(); return; }

    acquire();

    // Re-adquirir cuando la página vuelve a ser visible (pantalla desbloqueada)
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [enabled, acquire, release]);
}