import { useEffect, useRef, useCallback } from "react";

/**
 * useWakeLock — Mantiene la pantalla activa.
 * Usa Screen Wake Lock API cuando está disponible (Android Chrome).
 * Fallback: video invisible en loop (funciona en iOS Safari).
 * Re-adquiere automáticamente al volver al primer plano.
 */
export function useWakeLock(enabled = true) {
  const lockRef = useRef(null);
  const videoRef = useRef(null);

  // ── Fallback video para iOS ──────────────────────────────────────────────
  const startVideoFallback = useCallback(() => {
    if (videoRef.current) return;
    try {
      const vid = document.createElement("video");
      vid.setAttribute("playsinline", "");
      vid.setAttribute("muted", "");
      vid.setAttribute("loop", "");
      vid.style.cssText = "position:fixed;width:1px;height:1px;opacity:0.001;pointer-events:none;top:0;left:0;";
      // Vídeo mínimo 1x1 en base64 (negro, 1s loop)
      vid.src = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrAYF//+o3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTMgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yOC4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAPZWxpYnggAAADAAADAAM";
      vid.oncanplay = () => vid.play().catch(() => {});
      document.body.appendChild(vid);
      videoRef.current = vid;
    } catch (_) {}
  }, []);

  const stopVideoFallback = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.remove();
      videoRef.current = null;
    }
  }, []);

  // ── Screen Wake Lock API ─────────────────────────────────────────────────
  const acquire = useCallback(async () => {
    if (!enabled) return;
    // Intentar Screen Wake Lock (Android/Chrome)
    if ("wakeLock" in navigator) {
      if (lockRef.current && !lockRef.current.released) return;
      try {
        lockRef.current = await navigator.wakeLock.request("screen");
        return; // éxito, no necesitamos el fallback
      } catch (_) {}
    }
    // Fallback: video invisible para iOS Safari
    startVideoFallback();
  }, [enabled, startVideoFallback]);

  const release = useCallback(async () => {
    if (lockRef.current && !lockRef.current.released) {
      await lockRef.current.release().catch(() => {});
      lockRef.current = null;
    }
    stopVideoFallback();
  }, [stopVideoFallback]);

  useEffect(() => {
    if (!enabled) { release(); return; }

    acquire();

    // Re-adquirir cuando la página vuelve a ser visible (pantalla desbloqueada / foreground)
    const onVisible = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [enabled, acquire, release]);
}