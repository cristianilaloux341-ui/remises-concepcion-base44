import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { motion } from "framer-motion";

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
    let unsubscribe = null;

    const connect = () => {
      unsubscribe?.();
      base44.entities.PanicAlert.filter({ status: "activo" }).then(data => {
        const activeIds = data.map(p => p.id);
        setPanics(prev => {
          const current = [...prev];
          data.forEach(p => { if (!current.some(x => x.id === p.id)) { current.push(p); seenIds.current.add(p.id); } });
          return current.filter(p => activeIds.includes(p.id));
        });
      }).catch(() => {});

      unsubscribe = base44.entities.PanicAlert.subscribe((event) => {
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
    };

    connect();

    return () => {
      unsubscribe?.();
    };
  }, []);

  const dismiss = async (panic) => {
    await base44.entities.PanicAlert.update(panic.id, { status: "atendido" });
    setPanics(prev => prev.filter(p => p.id !== panic.id));
  };

  if (panics.length === 0) return null;

  return (
    <>
      {panics.map((panic) => (
        <motion.div
          drag dragMomentum={false} style={{ touchAction: "none" }}
          key={panic.id}
          className="pointer-events-auto w-full bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-red-500 animate-in slide-in-from-right-8 fade-in duration-200 shrink-0"
        >
          <div className="bg-red-600 px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-white shrink-0 animate-pulse" />
            <div className="flex-1 min-w-0">
              <p className="font-black text-white text-base leading-tight uppercase">¡ALERTA DE PÁNICO!</p>
              <p className="text-red-100 text-xs font-bold truncate">Móvil: {panic.driver_name} ({panic.vehicle_plate})</p>
            </div>
          </div>
          <div className="p-4 space-y-4">
             {panic.current_lat && panic.current_lng ? (
                <div className="flex items-center gap-2 bg-red-50 p-2 rounded-lg text-sm text-red-800 font-semibold">
                  <MapPin className="w-4 h-4 text-red-600" /> 
                  <a href={`https://www.google.com/maps?q=${panic.current_lat},${panic.current_lng}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 decoration-red-300">
                    Ver ubicación en mapa
                  </a>
                </div>
              ) : (
                <p className="text-sm text-gray-500 italic">Sin ubicación reportada</p>
              )}
             <div className="flex gap-2">
                <Button
                  size="sm"
                  className="w-full rounded-xl bg-red-600 hover:bg-red-700 font-bold"
                  onClick={() => dismiss(panic)}
                >
                  Marcar como Atendido
                </Button>
            </div>
          </div>
        </motion.div>
      ))}
    </>
  );
}