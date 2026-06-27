import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";

// ── Sonido de pánico ── fuerte, repetitivo, urgente
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playPanicSound() {
  try { navigator.vibrate?.([300, 100, 300, 100, 300, 100, 300]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      // Sirena urgente: onda cuadrada de alta amplitud alternando frecuencias
      const freqs = [
        [0, 900], [200, 600], [400, 900], [600, 600],
        [800, 900], [1000, 600], [1200, 900], [1400, 600],
      ];
      freqs.forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "square";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.02);
        g.gain.setValueAtTime(0.9, t + 0.15);
        g.gain.linearRampToValueAtTime(0, t + 0.19);
        o.start(t); o.stop(t + 0.2);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
}

export default function PanicAlertBanner() {
  const [panics, setPanics] = useState([]);
  const seenIds = useRef(new Set());
  const soundIntervalRef = useRef(null);

  // Repetir sonido mientras haya alertas activas
  useEffect(() => {
    if (panics.length > 0) {
      playPanicSound();
      soundIntervalRef.current = setInterval(playPanicSound, 3000);
    } else {
      clearInterval(soundIntervalRef.current);
    }
    return () => clearInterval(soundIntervalRef.current);
  }, [panics.length]);

  useEffect(() => {
    const unsubscribe = base44.entities.PanicAlert.subscribe((event) => {
      if (event.type === "create") {
        if (seenIds.current.has(event.id)) return;
        seenIds.current.add(event.id);
        if (event.data?.status === "activo") {
          setPanics(prev => [...prev, event.data]);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            try {
              new Notification("🚨 ALERTA DE PÁNICO", {
                body: `${event.data.driver_name} — ${event.data.vehicle_plate}`,
                icon: "/icon-192.png",
                requireInteraction: true,
              });
            } catch (_) {}
          }
        }
      } else if (event.type === "update") {
        if (event.data?.status !== "activo") {
          setPanics(prev => prev.filter(p => p.id !== event.id));
        } else {
          setPanics(prev => prev.map(p => p.id === event.id ? { ...p, ...event.data } : p));
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const dismiss = async (panic) => {
    await base44.entities.PanicAlert.update(panic.id, { status: "atendido" });
    setPanics(prev => prev.filter(p => p.id !== panic.id));
  };

  if (panics.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-red-900/80 backdrop-blur-sm" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-md space-y-3 max-h-screen overflow-y-auto py-2">
        {panics.map((panic) => (
          <div
            key={panic.id}
            className="bg-white rounded-3xl shadow-2xl overflow-hidden border-4 border-red-500 animate-in slide-in-from-top-8 fade-in duration-200"
          >
            {/* Header rojo pulsante */}
            <div className="bg-red-600 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center animate-ping absolute" />
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center relative">
                  <AlertTriangle className="w-7 h-7 text-white" />
                </div>
                <div>
                  <p className="font-black text-white text-xl leading-tight tracking-wide">🚨 PÁNICO</p>
                  <p className="text-red-100 text-xs font-bold uppercase tracking-widest">
                    {panic.created_date ? format(new Date(panic.created_date), "HH:mm:ss") + " hs" : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Cuerpo */}
            <div className="p-5 space-y-4 bg-red-50">
              <div className="text-center space-y-1">
                <p className="text-3xl font-black text-red-700">{panic.driver_name}</p>
                <p className="text-lg font-bold text-red-600 bg-red-100 rounded-xl py-1 px-3 inline-block">
                  🚗 {panic.vehicle_plate}
                </p>
              </div>

              {(panic.current_lat && panic.current_lng) && (
                <a
                  href={`https://www.google.com/maps?q=${panic.current_lat},${panic.current_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-white border border-red-200 rounded-2xl px-4 py-3 text-red-700 font-semibold text-sm hover:bg-red-50 transition-colors"
                >
                  <MapPin className="w-5 h-5 shrink-0" />
                  Ver ubicación en el mapa
                </a>
              )}

              <Button
                className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-700 font-black text-lg gap-2"
                onClick={() => dismiss(panic)}
              >
                <X className="w-5 h-5" /> ATENDIDO — CERRAR ALERTA
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}