import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { differenceInMinutes, format } from "date-fns";
import { es } from "date-fns/locale";
import { Bell, Clock, MapPin, X, Zap, Car, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { autoDispatch, assignDriverToOrder } from "@/lib/dispatchLogic";

function minutesUntil(datetime) {
  return differenceInMinutes(new Date(datetime), new Date());
}

export default function AgendaAlert() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const notifiedRef = useRef(new Set());
  const [alerts, setAlerts] = useState([]);
  const audioCtxRef = useRef(null);
  const repeatTimerRef = useRef(null);

  const { data: rides = [] } = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => base44.entities.ScheduledRide.list("-scheduled_datetime", 200),
    refetchInterval: 15000,
  });

  const handleDispatch = (ride) => {
    dismiss(ride.id);
    navigate("/orders/new", {
      state: {
        scheduled_ride_id: ride.id,
        initialData: {
          client_id: ride.client_id || "",
          client_name: ride.client_name || "",
          client_phone: ride.client_phone || "",
          pickup_address: ride.pickup_address || "",
          dropoff_address: ride.dropoff_address || "",
          zone: ride.zone || "",
          fare: ride.fare || "",
          notes: ride.notes || "",
          driver_id: ride.preferred_driver_id || "",
          driver_name: ride.preferred_driver_name || ""
        }
      }
    });
  };

  const getAudioCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  const playSound = () => {
    try {
      navigator.vibrate?.([400, 150, 400, 150, 800]);
      const ctx = getAudioCtx();
      const doPlay = () => {
        // 3 beeps urgentes
        [[0, 880], [400, 1100], [800, 880], [1200, 1100]].forEach(([delay, freq]) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = "triangle";
          o.frequency.value = freq;
          const t = ctx.currentTime + delay / 1000;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.7, t + 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          o.start(t); o.stop(t + 0.45);
        });
      };
      if (ctx.state === "suspended") ctx.resume().then(doPlay);
      else doPlay();
    } catch (_) {}
  };

  // Repetir sonido mientras haya alertas activas (máximo 4 veces para que "corte")
  useEffect(() => {
    if (alerts.length > 0) {
      let count = 0;
      repeatTimerRef.current = setInterval(() => {
        count++;
        if (count >= 4) {
          clearInterval(repeatTimerRef.current);
        } else {
          playSound();
        }
      }, 5000);
    } else {
      clearInterval(repeatTimerRef.current);
    }
    return () => clearInterval(repeatTimerRef.current);
  }, [alerts.length]);

  useEffect(() => {
    const check = () => {
      rides.filter(r => r.status === "pendiente").forEach(r => {
        const mins = minutesUntil(r.scheduled_datetime);
        const threshold = r.notify_minutes_before ?? 10;
        if (mins <= threshold && mins >= -5 && !notifiedRef.current.has(r.id)) {
          notifiedRef.current.add(r.id);

          base44.entities.ScheduledRide.update(r.id, { status: "notificado" });
          queryClient.invalidateQueries({ queryKey: ["scheduled"] });

          // Sonido inmediato
          playSound();

          // Agregar a la lista de alertas activas
          setAlerts(prev => [...prev, { ...r, alertedAt: Date.now() }]);

          // Notificación del sistema
          if (typeof Notification !== "undefined") {
            const notify = () => new Notification(`⏰ ¡AGENDA! ${r.client_name}`, {
              body: `${r.pickup_address}${r.dropoff_address ? " → " + r.dropoff_address : ""} — en ${Math.max(0, mins)} min`,
              requireInteraction: true,
              icon: "/icon-192.png",
            });
            if (Notification.permission === "granted") notify();
            else if (Notification.permission !== "denied") {
              Notification.requestPermission().then(p => { if (p === "granted") notify(); });
            }
          }
        }
      });
    };

    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [rides]);

  const dismiss = (id) => setAlerts(prev => prev.filter(a => a.id !== id));
  const dismissAll = () => setAlerts([]);

  if (alerts.length === 0) return null;

  return (
    <>
        {alerts.map((alert) => {
          const mins = minutesUntil(alert.scheduled_datetime);
          const hora = alert.scheduled_datetime ? format(new Date(alert.scheduled_datetime), "HH:mm", { locale: es }) : "--:--";
          return (
            <motion.div drag dragMomentum={false} style={{ touchAction: "none" }} key={alert.id} className="pointer-events-auto w-full bg-white rounded-2xl shadow-xl overflow-hidden border-2 border-amber-400 animate-in slide-in-from-right-8 fade-in duration-200 shrink-0">
              {/* Header llamativo */}
              <div className="bg-amber-500 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center animate-bounce">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-black text-white text-lg leading-tight">¡AGENDA PRÓXIMA!</p>
                    <p className="text-amber-100 text-xs font-medium">
                      {mins > 0 ? `En ${mins} minuto${mins !== 1 ? "s" : ""}` : "¡Ahora!"}
                      {" — "}{hora}hs
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dismiss(alert.id);
                  }}
                  className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors relative z-10"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>

              {/* Cuerpo */}
              <div className="p-5 space-y-4">
                <div>
                  <p className="font-bold text-gray-900 text-xl">{alert.client_name}</p>
                  {alert.client_phone && (
                    <p className="text-sm text-gray-500">{alert.client_phone}</p>
                  )}
                </div>

                <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-green-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Recogida</p>
                      <p className="font-semibold text-sm text-gray-800">{alert.pickup_address}</p>
                    </div>
                  </div>
                  {alert.dropoff_address && (
                    <div className="flex items-start gap-2.5">
                      <MapPin className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Destino</p>
                        <p className="font-semibold text-sm text-gray-800">{alert.dropoff_address}</p>
                      </div>
                    </div>
                  )}
                </div>

                {(alert.fare || alert.preferred_driver_name) && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {alert.fare && (
                      <span className="text-2xl font-black text-green-600">${alert.fare}</span>
                    )}
                    {alert.preferred_driver_name && (
                      <span className="flex items-center gap-1 text-sm text-blue-600 font-medium bg-blue-50 px-2.5 py-1 rounded-lg">
                        <Car className="w-3.5 h-3.5" /> {alert.preferred_driver_name}
                      </span>
                    )}
                  </div>
                )}

                {alert.notes && (
                  <p className="text-sm text-gray-500 italic">"{alert.notes}"</p>
                )}

                {/* Acciones */}
                <div className="flex gap-2 pt-1">
                  <Button 
                    className="flex-1 h-11 rounded-xl gap-2 bg-amber-500 hover:bg-amber-600 font-bold text-white shadow-md shadow-amber-500/20"
                    onClick={() => handleDispatch(alert)}
                  >
                    <Zap className="w-4 h-4" /> Abrir Pasaje
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 px-4 rounded-xl font-semibold"
                    onClick={() => dismiss(alert.id)}
                  >
                    Cerrar
                  </Button>
                </div>
              </div>
            </motion.div>
          );
        })}

        {alerts.length > 1 && (
          <button
            type="button"
            onClick={dismissAll}
            className="pointer-events-auto w-full py-2 bg-amber-500/90 hover:bg-amber-500 rounded-xl text-sm text-white font-bold text-center shadow-lg animate-in fade-in"
          >
            Cerrar {alerts.length} alertas
          </button>
        )}
    </>
  );
}