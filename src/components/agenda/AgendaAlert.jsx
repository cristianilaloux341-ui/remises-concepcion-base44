import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { differenceInMinutes } from "date-fns";
import { Bell, Clock, X } from "lucide-react";
import { Link } from "react-router-dom";

function minutesUntil(datetime) {
  return differenceInMinutes(new Date(datetime), new Date());
}

export default function AgendaAlert() {
  const queryClient = useQueryClient();
  const notifiedRef = useRef(new Set());
  const [alerts, setAlerts] = useState([]); // visible alerts on screen

  const { data: rides = [] } = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => base44.entities.ScheduledRide.list("-scheduled_datetime", 200),
    refetchInterval: 15000,
  });

  const playSound = () => {
    try {
      navigator.vibrate?.([400, 150, 400, 150, 800]);
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
      resume.then(() => {
        [0, 500, 1000].forEach(delay => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = "sine"; o.frequency.value = 660;
          const t = ctx.currentTime + delay / 1000;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.6, t + 0.05);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
          o.start(t); o.stop(t + 0.5);
        });
      });
    } catch (_) {}
  };

  useEffect(() => {
    const check = () => {
      rides.filter(r => r.status === "pendiente").forEach(r => {
        const mins = minutesUntil(r.scheduled_datetime);
        const threshold = r.notify_minutes_before ?? 10;
        if (mins <= threshold && mins >= -5 && !notifiedRef.current.has(r.id)) {
          notifiedRef.current.add(r.id);

          // Update status to notificado
          base44.entities.ScheduledRide.update(r.id, { status: "notificado" });
          queryClient.invalidateQueries({ queryKey: ["scheduled"] });

          // Play sound
          playSound();

          // Show on-screen alert
          setAlerts(prev => [...prev, { ...r, alertedAt: Date.now() }]);

          // System notification
          if (typeof Notification !== "undefined") {
            const notify = () => new Notification(`⏰ Agenda: ${r.client_name}`, {
              body: `${r.pickup_address} — en ${Math.max(0, mins)} min`,
              requireInteraction: true,
            });
            if (Notification.permission === "granted") {
              notify();
            } else if (Notification.permission !== "denied") {
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

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-3 max-w-sm w-full">
      {alerts.map(alert => (
        <div
          key={alert.id}
          className="bg-amber-500 text-white rounded-2xl shadow-2xl p-4 flex flex-col gap-2 animate-pulse border-2 border-amber-300"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 shrink-0" />
              <span className="font-bold text-sm">¡AGENDA PRÓXIMA!</span>
            </div>
            <button onClick={() => dismiss(alert.id)} className="opacity-80 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-sm font-semibold">{alert.client_name}</div>
          <div className="text-xs opacity-90 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {alert.pickup_address}
          </div>
          <Link to="/agenda" onClick={() => dismiss(alert.id)}>
            <div className="mt-1 bg-white text-amber-700 font-bold text-xs rounded-lg py-1.5 px-3 text-center hover:bg-amber-50 transition-colors">
              Ver Agenda →
            </div>
          </Link>
        </div>
      ))}
    </div>
  );
}