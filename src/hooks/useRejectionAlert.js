import { useEffect, useRef } from "react";

/**
 * Detecta cuando un viaje pasa de "ofrecido" → "pendiente" (rechazo de chofer)
 * y dispara una alarma sonora en la central + reasignación automática.
 */

let alertAudioCtx = null;

function getAlertCtx() {
  if (!alertAudioCtx || alertAudioCtx.state === "closed") {
    alertAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return alertAudioCtx;
}

function playRejectionAlarm() {
  try {
    const ctx = getAlertCtx();
    const doPlay = () => {
      // Patrón: 3 tonos descendentes urgentes (diferente al tono del chofer)
      const pattern = [
        [0,   900, 0.7],
        [200, 700, 0.7],
        [400, 500, 0.8],
        [700, 900, 0.7],
        [900, 700, 0.7],
        [1100, 500, 0.8],
      ];
      pattern.forEach(([delay, freq, gain]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = "sawtooth";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.start(t);
        o.stop(t + 0.18);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}

  try { navigator.vibrate?.([300, 100, 300, 100, 600]); } catch (_) {}
}

export function useRejectionAlert(orders, onRejected) {
  // Map of orderId → last known status
  const prevStatusRef = useRef({});

  useEffect(() => {
    orders.forEach((order) => {
      const prev = prevStatusRef.current[order.id];
      const curr = order.status;

      // Detectar transición ofrecido → pendiente (rechazo)
      if (prev === "ofrecido" && curr === "pendiente") {
        playRejectionAlarm();
        // Llamar callback para reasignar
        onRejected?.(order);
      }

      prevStatusRef.current[order.id] = curr;
    });
  }, [orders]);
}