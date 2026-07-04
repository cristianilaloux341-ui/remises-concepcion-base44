import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { XCircle, Car, MapPin, X } from "lucide-react";
import { Link } from "react-router-dom";

// ── Audio ──────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playCancel() {
  try { navigator.vibrate?.([300, 100, 300]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      // 3 tonos descendentes urgentes
      [[0, 880], [300, 660], [600, 440]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "sawtooth";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        o.start(t); o.stop(t + 0.4);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function CancellationAlert() {
  const [alerts, setAlerts] = useState([]);
  const seenIds = useRef(new Set());

  useEffect(() => {
    let unsubscribe = null;

    const connect = () => {
      unsubscribe?.();
      // Subscribe to RideOrder changes — detect transitions to "cancelado"
      unsubscribe = base44.entities.RideOrder.subscribe((event) => {
        if (event.type !== "update") return;
        const order = event.data;
        if (!order) return;
        if (order.status !== "cancelado") return;
        // Only alert once per order
        if (seenIds.current.has(order.id)) return;
        // Only alert if had a driver assigned (operator needs to free the slot)
        if (!order.driver_id && !order.driver_name) return;

        seenIds.current.add(order.id);
        setAlerts(prev => [...prev, order]);
        playCancel();
      });
    };

    connect();

    return () => {
      unsubscribe?.();
    };
  }, []);

  const dismiss = (orderId) => {
    setAlerts(prev => prev.filter(a => a.id !== orderId));
  };

  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm w-full">
      {alerts.map((order) => (
        <div
          key={order.id}
          className="bg-white border-2 border-red-400 rounded-2xl shadow-2xl shadow-red-500/20 overflow-hidden animate-in slide-in-from-right-8 fade-in duration-300"
        >
          {/* Header */}
          <div className="bg-red-500 px-4 py-3 flex items-center gap-2">
            <XCircle className="w-5 h-5 text-white shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm leading-tight">⚠️ Viaje Cancelado</p>
              <p className="text-red-100 text-xs truncate">Reasignar móvil: {order.driver_name}</p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(order.id);
              }}
              className="text-red-200 hover:text-white transition-colors shrink-0 relative z-10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3">
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <div className="w-4 h-4 rounded-full bg-green-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">RECOGIDA</p>
                  <p className="font-semibold truncate">{order.pickup_address}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Car className="w-4 h-4 shrink-0" />
                <span className="truncate">{order.client_name}</span>
                {order.zone && (
                  <span className="ml-auto shrink-0 text-xs font-medium bg-muted px-2 py-0.5 rounded-full">
                    {order.zone}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <Link to={`/orders/${order.id}`} className="flex-1">
                <Button
                  size="sm"
                  className="w-full rounded-xl bg-red-500 hover:bg-red-600 gap-1.5 text-xs font-bold"
                  onClick={() => dismiss(order.id)}
                >
                  <MapPin className="w-3.5 h-3.5" /> Ver y Reasignar
                </Button>
              </Link>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-xs"
                onClick={() => dismiss(order.id)}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}