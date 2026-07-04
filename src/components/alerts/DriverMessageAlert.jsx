import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
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

function playOnce() {
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

// Toca UNA sola vez (sin loop)
function playAlert() {
  playOnce();
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function DriverMessageAlert() {
  const [alerts, setAlerts] = useState([]);
  const seenIds = useRef(new Set());
  const location = useLocation();
  const onMessagesPage = location.pathname === "/messages";

  // Parar sonido y limpiar alertas cuando el operador navega a /messages
  useEffect(() => {
    if (onMessagesPage) {
      setAlerts([]);
    }
  }, [onMessagesPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let unsubscribe = null;

    const connect = () => {
      unsubscribe?.();
      unsubscribe = base44.entities.Message.subscribe((event) => {
        if (event.type !== "create") return;
        const msg = event.data;
        if (!msg) return;
        if (msg.from_type !== "movil") return;
        if (seenIds.current.has(msg.id)) return;
        // No alertar si ya estamos en la página de mensajes
        if (onMessagesPage) { seenIds.current.add(msg.id); return; }

        seenIds.current.add(msg.id);
        setAlerts(prev => [...prev, msg]);

        // Sonido una sola vez por mensaje nuevo
        playAlert();

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
    };

    connect();

    return () => {
      unsubscribe?.();
    };
  }, [onMessagesPage]);

  const dismiss = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };
  const dismissAll = () => { setAlerts([]); };

  if (alerts.length === 0) return null;

  return (
    <>
        {alerts.map((msg) => (
          <div
            key={msg.id}
            className="pointer-events-auto w-full bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-blue-400 animate-in slide-in-from-right-8 fade-in duration-200 shrink-0"
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
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(msg.id);
                }}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors relative z-10"
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
            type="button"
            onClick={dismissAll}
            className="pointer-events-auto w-full py-2 bg-blue-600/90 hover:bg-blue-600 rounded-xl text-sm text-white font-bold text-center shadow-lg animate-in fade-in"
          >
            Cerrar {alerts.length} mensajes
          </button>
        )}
    </>
  );
}