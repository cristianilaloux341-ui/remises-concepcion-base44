import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

// ── Audio engine ───────────────────────────────────────────────────────────────
let _audioCtx = null;
function getCtx() {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _audioCtx;
}

// Plays one "blip" burst: two ascending tones
function playBlip(ctx) {
  [[0, 900, 0.55], [250, 1200, 0.45]].forEach(([delay, freq, vol]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = "square";
    o.frequency.value = freq;
    const t = ctx.currentTime + delay / 1000;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.start(t); o.stop(t + 0.35);
  });
}

// Toca UNA sola vez (sin loop)
function playAlertOnce() {
  try {
    const ctx = getCtx();
    const doPlay = () => playBlip(ctx);
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
  try { navigator.vibrate?.([400, 200, 400]); } catch (_) {}
}

// ── Hook ───────────────────────────────────────────────────────────────────────
// Returns: { pendingMessages, dismissMessage }
// pendingMessages = array of message objects that need acknowledgement
export function useDriverMessageAlert(driverId) {
  const [pendingMessages, setPendingMessages] = useState([]);
  const seenIds = useRef(new Set());

  // Subscribe to new messages in real-time — suena UNA sola vez por mensaje nuevo
  useEffect(() => {
    if (!driverId) return;

    let unsubscribe = null;

    const connect = () => {
      unsubscribe?.();
      unsubscribe = base44.entities.Message.subscribe((event) => {
        if (event.type !== "create") return;
        const msg = event.data;
        if (!msg) return;
        if (msg.from_type !== "operador") return; // only operator → driver
        // Must be broadcast (no to_driver_id) or targeted at this driver
        const isForMe = !msg.to_driver_id || msg.to_driver_id === driverId;
        if (!isForMe) return;
        if (seenIds.current.has(msg.id)) return;

        seenIds.current.add(msg.id);
        setPendingMessages(prev => [...prev, msg]);
        // Sonido una sola vez por mensaje nuevo
        playAlertOnce();
      });
    };

    connect();

    return () => {
      unsubscribe?.();
    };
  }, [driverId]);

  const dismissMessage = (msgId) => {
    // Mark as read in DB (fire and forget)
    base44.entities.Message.update(msgId, { read: true }).catch(() => {});
    setPendingMessages(prev => Array.isArray(prev) ? prev.filter(m => m.id !== msgId) : []);
  };

  return { pendingMessages, dismissMessage };
}