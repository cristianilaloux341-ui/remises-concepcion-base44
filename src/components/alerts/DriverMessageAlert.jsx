import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { MessageCircle, X, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

// ── Audio ──────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playMessage() {
  try { navigator.vibrate?.([200, 100, 200, 100, 400]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      [[0, 520], [250, 660], [500, 800]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "sine";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.6, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.start(t); o.stop(t + 0.4);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function DriverMessageAlert() {
  const [alerts, setAlerts] = useState([]);
  const seenIds = useRef(new Set());
  const repeatRef = useRef(null);

  // Repetir sonido mientras haya alertas activas
  useEffect(() => {
    if (alerts.length > 0) {
      repeatRef.current = setInterval(playMessage, 5000);
    } else {
      clearInterval(repeatRef.current);
    }
    return () => clearInterval(repeatRef.current);
  }, [alerts.length]);

  useEffect(() => {
    // Suscribirse a mensajes nuevos de móviles en tiempo real
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.type !== "create") return;
      const msg = event.data;
      if (!msg) return;
      // Solo mensajes de móviles (choferes)
      if (msg.from_type !== "movil") return;
      // No repetir
      if (seenIds.current.has(msg.id)) return;

      seenIds.current.add(msg.id);
      setAlerts(prev => [...prev, msg]);
      playMessage();

      // Notificación del sistema
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(`📩 Mensaje de ${msg.from_name}`, {
            body: msg.content,
            icon: "/icon-192.png",
            requireInteraction: true,
          });
        } catch (_) {}
      }
    });

    return () => unsubscribe();
  }, []);

  const dismiss = (id) => setAlerts(prev => prev.filter(a => a.id !== id));
  const dismissAll = () => setAlerts([]);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-3 max-h-screen overflow-y-auto py-2">
        {alerts.map((msg) => (
          <div
            key={msg.id}
            className="bg-white rounded-3xl shadow-2xl overflow-hidden border-4 border-blue-400 animate-in slide-in-from-bottom-8 fade-in duration-300"
          >
            {/* Header */}
            <div className="bg-blue-600 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-bounce">
                  <MessageCircle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-black text-white text-lg leading-tight">¡MENSAJE DE MÓVIL!</p>
                  <p className="text-blue-100 text-xs font-medium">
                    {msg.from_name}
                    {msg.created_date
                      ? " — " + format(new Date(msg.created_date), "HH:mm") + "hs"
                      : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => dismiss(msg.id)}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Cuerpo */}
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Car className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">
                    {msg.from_name}
                  </p>
                  <p className="text-gray-800 text-base font-semibold leading-snug">
                    {msg.content}
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1 h-11 rounded-xl gap-2 bg-blue-600 hover:bg-blue-700 font-bold"
                  onClick={() => dismiss(msg.id)}
                >
                  Entendido
                </Button>
              </div>
            </div>
          </div>
        ))}

        {alerts.length > 1 && (
          <button
            onClick={dismissAll}
            className="w-full py-2.5 text-sm text-white/80 hover:text-white font-medium text-center"
          >
            Cerrar todas ({alerts.length})
          </button>
        )}
      </div>
    </div>
  );
}