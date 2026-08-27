import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, X, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { resolvePanicAlert } from "@/lib/panicAlerts";

let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playPanicSound() {
  try { navigator.vibrate?.([300, 100, 300, 100, 300, 100, 300]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      const freqs = [[0,900],[200,600],[400,900],[600,600],[800,900],[1000,600],[1200,900],[1400,600]];
      freqs.forEach(([delay, freq]) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination); o.type = "square"; o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.9,t+0.02); g.gain.setValueAtTime(0.9,t+0.15); g.gain.linearRampToValueAtTime(0,t+0.19);
        o.start(t); o.stop(t+0.2);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay); else doPlay();
  } catch (_) {}
}

function isClientPanic(panic) {
  const type = String(panic?.type || panic?.tipo || panic?.source || panic?.origin || panic?.origen || "").toLowerCase();
  return type === "cliente" || type === "client" || type === "customer" || !!(panic?.client_name || panic?.customer_name || panic?.client_phone || panic?.customer_phone);
}

function clientData(panic) {
  return {
    name: panic.client_name || panic.customer_name || panic.passenger_name || panic.nombre_cliente || "Cliente sin nombre",
    phone: panic.client_phone || panic.customer_phone || panic.passenger_phone || panic.telefono_cliente || "Sin teléfono",
    mobile: panic.mobile_number || panic.vehicle_number || panic.driver_number || panic.movil || "Sin móvil",
    driver: panic.driver_name || panic.chofer_name || panic.driver || "Sin chofer",
    ride: panic.ride_id || panic.trip_id || panic.ride_number || panic.trip_number || panic.pasaje_id || "Sin dato",
  };
}

export default function PanicAlertBanner() {
  const [panics, setPanics] = useState([]);
  const seenIds = useRef(new Set());
  const soundIntervalRef = useRef(null);

  useEffect(() => {
    if (panics.length > 0) { playPanicSound(); soundIntervalRef.current = setInterval(playPanicSound, 3000); }
    else clearInterval(soundIntervalRef.current);
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
                const client = isClientPanic(event.data);
                const c = clientData(event.data);
                new Notification(client ? "🚨 ALERTA DE PÁNICO — CLIENTE" : "🚨 ALERTA DE PÁNICO", {
                  body: client ? `${c.name} — Tel: ${c.phone} — Móvil: ${c.mobile}` : `${event.data.driver_name || "Chofer"} — ${event.data.vehicle_plate || ""}`,
                  icon: "/icon-192.png",
                  requireInteraction: true,
                });
              } catch (_) {}
            }
          }
        } else if (event.type === "update") {
          if (event.data?.status !== "activo") setPanics(prev => prev.filter(p => p.id !== event.id));
          else setPanics(prev => prev.map(p => p.id === event.id ? { ...p, ...event.data } : p));
        }
      });
    };
    connect();
    return () => unsubscribe?.();
  }, []);

  const dismiss = async (panic) => {
    setPanics(prev => prev.filter(p => p.id !== panic.id));
    try { await resolvePanicAlert(panic.id); }
    catch (e) {
      console.error("Error al atender pánico", e);
      setPanics(prev => prev.some(p => p.id === panic.id) ? prev : [panic, ...prev]);
      alert(e?.message || "No se pudo marcar la alerta como atendida.");
    }
  };

  if (panics.length === 0) return null;

  return <>{panics.map((panic) => {
    const client = isClientPanic(panic);
    const c = clientData(panic);
    return (
      <motion.div drag dragMomentum={false} style={{ touchAction: "none" }} key={panic.id} className="pointer-events-auto w-full bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-red-500 animate-in slide-in-from-right-8 fade-in duration-200 shrink-0">
        <div className="bg-red-600 px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-white shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <p className="font-black text-white text-base leading-tight uppercase">{client ? "¡ALERTA DE PÁNICO — CLIENTE!" : "¡ALERTA DE PÁNICO!"}</p>
            <p className="text-red-100 text-xs font-bold truncate">{client ? `${c.name} — ${c.phone}` : `Móvil: ${panic.driver_name || "Chofer"} (${panic.vehicle_plate || "Sin patente"})`}</p>
          </div>
          <button className="text-red-200 hover:text-white shrink-0 opacity-50 p-1" onClick={() => dismiss(panic)} title="Cerrar y marcar como atendida"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          {client && <div className="bg-red-50 p-3 rounded-lg text-sm text-red-900 space-y-1"><p><strong>Cliente:</strong> {c.name}</p><p><strong>Teléfono:</strong> {c.phone}</p><p><strong>Móvil:</strong> {c.mobile}</p><p><strong>Chofer:</strong> {c.driver}</p><p><strong>Viaje:</strong> {c.ride}</p></div>}
          {panic.current_lat && panic.current_lng ? <div className="flex items-center gap-2 bg-red-50 p-2 rounded-lg text-sm text-red-800 font-semibold"><MapPin className="w-4 h-4 text-red-600" /><a href={`https://www.google.com/maps?q=${panic.current_lat},${panic.current_lng}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 decoration-red-300">Ver ubicación en mapa</a></div> : <p className="text-sm text-gray-500 italic">Sin ubicación reportada</p>}
          <div className="flex gap-2"><Button size="sm" className="w-full rounded-xl bg-red-600 hover:bg-red-700 font-bold" onClick={() => dismiss(panic)}>Marcar como Atendido</Button></div>
        </div>
      </motion.div>
    );
  })}</>;
}
