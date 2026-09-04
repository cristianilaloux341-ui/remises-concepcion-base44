import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { XCircle, Car, MapPin, X, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

// ── Audio ──────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playRejectionAlert() {
  try { navigator.vibrate?.([300, 100, 300]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      [[0, 600], [200, 400], [400, 300]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "square";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.3);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
}

export default function DriverRejectionAlert() {
  const [alerts, setAlerts] = useState([]);
  const activeOrdersRef = useRef(new Map());

  useEffect(() => {
    let unsubscribe = null;

    // Precargar las activas al inicio para saber qué rastrear
    base44.entities.RideOrder.filter({ status: { $in: ["ofrecido", "aceptado", "en_camino", "en_viaje"] } }).then(ords => {
      ords.forEach(o => {
        if (o.driver_id || o.reserved_driver_id) {
          activeOrdersRef.current.set(o.id, { driver_name: o.driver_name || "Móvil", driver_id: o.driver_id || o.reserved_driver_id });
        }
      });
    }).catch(()=>{});

    const connect = () => {
      unsubscribe?.();
      unsubscribe = base44.entities.RideOrder.subscribe((event) => {
        const order = event.data;
        if (!order) return;

        if (event.type === "update") {
           // Si estaba activa y ahora está pendiente sin chofer (el chofer rechazó/canceló)
           const wasActive = activeOrdersRef.current.get(order.id);
           
           if (order.status === "pendiente" && !order.driver_id) {
              if (wasActive) {
                // Chofer abandonó el viaje!
                const driverName = wasActive.driver_name;
                activeOrdersRef.current.delete(order.id);
                
                // Mostrar alerta
                setAlerts(prev => {
                   if (prev.some(a => a.id === order.id)) return prev;
                   return [...prev, { ...order, rejected_by: driverName }];
                });
                playRejectionAlert();
              }
           } else if (["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(order.status) && (order.driver_id || order.reserved_driver_id)) {
              // Sigue activa, la registramos/actualizamos
              activeOrdersRef.current.set(order.id, { driver_name: order.driver_name || "Móvil", driver_id: order.driver_id || order.reserved_driver_id });
           } else {
              // Completado o cancelado oficialmente
              activeOrdersRef.current.delete(order.id);
           }
        } else if (event.type === "delete") {
           activeOrdersRef.current.delete(event.id);
        }
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
    <>
      {alerts.map((order) => (
        <motion.div
          drag dragMomentum={false} style={{ touchAction: "none" }}
          key={order.id}
          className="pointer-events-auto w-full bg-white border-2 border-orange-400 rounded-2xl shadow-xl shadow-orange-500/20 overflow-hidden animate-in slide-in-from-right-8 fade-in duration-300 shrink-0"
        >
          {/* Header */}
          <div className="bg-orange-500 px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-white shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-sm leading-tight">⚠️ Móvil Abortó el Viaje</p>
              <p className="text-orange-100 text-xs truncate">{order.rejected_by} devolvió el viaje.</p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(order.id);
              }}
              className="text-orange-200 hover:text-white transition-colors shrink-0 relative z-10"
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
                  className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 gap-1.5 text-xs font-bold"
                  onClick={() => dismiss(order.id)}
                >
                  <MapPin className="w-3.5 h-3.5" /> Ver pasaje
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
        </motion.div>
      ))}
    </>
  );
}