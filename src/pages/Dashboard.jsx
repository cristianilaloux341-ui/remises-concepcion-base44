import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
// base44 y useQuery se usan solo para bases (dato estático, no necesita tiempo real)
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeDrivers } from "@/hooks/useRealtimeDrivers";
import useRejectionAlert from "@/hooks/useRejectionAlert.jsx";

import { Car, Clock, CheckCircle2, Users, ArrowRight, Zap, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import RideMap from "@/components/map/RideMap";
import BaseQueueManager, { QuickAssignInput } from "@/components/operator/BaseQueueManager";
import { reassignAfterReject } from "@/lib/dispatchLogic";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { resolvePanicAlert } from "@/lib/panicAlerts";

function RideAge({ createdDate }) {
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    const tick = () => {
      const createdMs = new Date(createdDate || Date.now()).getTime();
      setMinutes(Math.max(0, Math.floor((Date.now() - createdMs) / 60000)));
    };
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, [createdDate]);

  return (
    <Badge className={`${minutes >= 15 ? "bg-red-600" : minutes >= 5 ? "bg-amber-500" : "bg-slate-600"} text-white font-black`}>
      ⏱ {minutes < 1 ? "Recién ingresado" : `${minutes} min`}
    </Badge>
  );
}

function CentralOfferCountdown({ order }) {
  const [seconds, setSeconds] = useState(null);

  useEffect(() => {
    if (order.status !== "ofrecido") {
      setSeconds(null);
      return;
    }
    const assignedMs = order.assigned_at ? new Date(order.assigned_at).getTime() : NaN;
    const expiresMs = order.offerExpiresAt != null
      ? Number(order.offerExpiresAt)
      : (Number.isFinite(assignedMs) ? assignedMs + 30000 : NaN);
    if (!Number.isFinite(expiresMs)) {
      setSeconds(null);
      return;
    }
    const tick = () => setSeconds(Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [order.status, order.offerExpiresAt, order.assigned_at, order.assignment_attempt]);

  if (seconds == null) return null;
  return (
    <Badge className={`${seconds <= 10 ? "bg-red-600 animate-pulse" : "bg-amber-500"} text-white font-mono text-sm font-black px-3 py-1`}>
      ⏱ QUEDAN 00:{String(seconds).padStart(2, "0")}
    </Badge>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  // Suscripciones en tiempo real — actualizaciones instantáneas sin polling
  const { orders, isLoading: loadingOrders } = useRealtimeOrders({ limit: 100 });
  const { drivers } = useRealtimeDrivers();

  // Alarma + reasignación automática cuando un chofer rechaza
  useRejectionAlert(orders, async (rejectedOrder) => {
    // drivers puede estar desactualizado en el closure, obtener frescos
    const freshDrivers = await base44.entities.Driver.list();
    await reassignAfterReject(rejectedOrder, freshDrivers, []);
  });

  const { data: bases = [] } = useQuery({
    queryKey: ["bases"],
    queryFn: () => base44.entities.Base.list(),
  });

  const { data: moviles = [] } = useQuery({
    queryKey: ["moviles"],
    queryFn: () => base44.entities.Movil.list(),
    staleTime: 60_000,
  });

  const [panicAlerts, setPanicAlerts] = useState([]);
  const [showPanicPanel, setShowPanicPanel] = useState(false);

  // Monitoreo de Viajes Nuevos (Burbuja/Notificación para el Operador)
  useEffect(() => {
    let unsubscribe = null;
    let knownOrderIds = new Set(orders.map(o => o.id));

    unsubscribe = base44.entities.RideOrder.subscribe((event) => {
      if (event.type === "create" && event.data?.status === "pendiente") {
        if (!knownOrderIds.has(event.id)) {
          knownOrderIds.add(event.id);
          
          // Sonido de viaje nuevo en la central
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === "suspended") ctx.resume();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = "sine";
            o.frequency.setValueAtTime(880, ctx.currentTime);
            o.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
            g.gain.setValueAtTime(0, ctx.currentTime);
            g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            o.connect(g); g.connect(ctx.destination);
            o.start(); o.stop(ctx.currentTime + 0.3);
          } catch (_) {}

          // Burbuja visual de Nuevo Viaje con botón de acción
          toast({
            title: "🚕 ¡Nuevo viaje entrante!",
            description: `${event.data.pickup_address} (${event.data.client_name || 'Cliente'})`,
            action: (
              <ToastAction altText="Ver" onClick={() => window.location.href = `/orders/${event.id}`}>
                Ver Viaje
              </ToastAction>
            ),
            duration: 10000,
          });
        }
      }
    });
    return () => unsubscribe?.();
  }, [orders, toast]);

  // Mantener únicamente alertas activas. Las atendidas nunca vuelven al recargar.
  useEffect(() => {
    let unsubscribe = null;
    let lastEvent = Date.now();
    let pollInterval = null;

    const loadActive = () => {
      base44.entities.PanicAlert.filter({ status: "activo" })
        .then(data => setPanicAlerts(data.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))))
        .catch(() => {});
    };

    const connect = () => {
      unsubscribe?.();
      loadActive();
      unsubscribe = base44.entities.PanicAlert.subscribe((event) => {
        lastEvent = Date.now();
        if (event.type === "create" && event.data?.status === "activo") {
          setPanicAlerts(prev => prev.some(a => a.id === event.id) ? prev : [event.data, ...prev]);
          setShowPanicPanel(true);
          try {
            navigator.vibrate?.([500, 200, 500, 200, 500]);
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === "suspended") ctx.resume();
            [0, 300, 600].forEach(delay => {
              const o = ctx.createOscillator();
              const g = ctx.createGain();
              o.connect(g); g.connect(ctx.destination);
              o.type = "sine"; o.frequency.value = 1000;
              const t = ctx.currentTime + delay / 1000;
              g.gain.setValueAtTime(0, t);
              g.gain.linearRampToValueAtTime(0.8, t + 0.05);
              g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
              o.start(t); o.stop(t + 0.4);
            });
          } catch (_) {}
        } else if (event.type === "update") {
          if (event.data?.status !== "activo") {
            setPanicAlerts(prev => prev.filter(alert => alert.id !== event.id));
          } else {
            setPanicAlerts(prev => prev.map(alert => alert.id === event.id ? { ...alert, ...event.data } : alert));
          }
        } else if (event.type === "delete") {
          setPanicAlerts(prev => prev.filter(alert => alert.id !== event.id));
        }
      });
    };

    connect();
    pollInterval = setInterval(() => {
      if (Date.now() - lastEvent > 15000) connect();
    }, 15000);

    return () => {
      unsubscribe?.();
      clearInterval(pollInterval);
    };
  }, []);

  const handleResolvePanic = async (panic) => {
    setPanicAlerts(prev => prev.filter(item => item.id !== panic.id));
    try {
      await resolvePanicAlert(panic.id);
    } catch (error) {
      setPanicAlerts(prev => prev.some(item => item.id === panic.id) ? prev : [panic, ...prev]);
      window.alert(error?.message || "No se pudo marcar la alerta como atendida.");
    }
  };

  const activeOrders = orders.filter(o => ["pendiente", "preasignado_proximo", "ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status));
  const pendingOrders = orders.filter(o => o.status === "pendiente");
  const claimedPendingOrders = activeOrders.filter(o =>
    o.claimed_from_pending &&
    ["preasignado_proximo", "aceptado", "en_camino", "en_viaje"].includes(o.status)
  );
  const completedToday = orders.filter(o => {
    if (o.status !== "completado") return false;
    return new Date(o.updated_date).toDateString() === new Date().toDateString();
  });

  const isDriverWorking = (d) => {
    if (d.status !== "disponible") return false;
    const mobileId = String(d.vehicle_model || "");
    const mobileNumber = parseInt(mobileId, 10);
    const movil = moviles?.find(m => m.id === mobileId || m.numero_movil === mobileNumber);
    if (movil && (movil.activo === false || movil.fuera_de_servicio === true)) {
      return false;
    }
    return true;
  };
  const availableDrivers = drivers.filter(d => isDriverWorking(d) && d.current_base);

  const handleDownloadReport = async () => {
    const start = new Date('2026-08-21T09:00:00Z'); 
    const end = new Date('2026-08-21T16:00:00Z');   

    const rides = await base44.entities.RideOrder.list('-created_date', 1000);
    const filtered = rides.filter(r => {
      const d = new Date(r.created_date);
      return d >= start && d <= end && r.driver_name;
    });

    filtered.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));

    let csv = "\uFEFFHora,Cliente,Origen,Destino,Chofer,Estado,Importe\n"; 
    let totalImporte = 0;
    let asignados = 0;

    filtered.forEach(r => {
      const d = new Date(r.created_date);
      d.setHours(d.getHours() - 3); 
      const timeStr = d.toISOString().substr(11, 5);
      
      const cliente = (r.client_name || '-').replace(/,/g, '');
      const origen = (r.pickup_address || '-').replace(/,/g, '');
      const destino = (r.dropoff_address || '-').replace(/,/g, '');
      const chofer = (r.driver_name || '-').replace(/,/g, '');
      const estado = r.status;
      const importe = r.importe_real_actual || r.fare || 0;
      
      if(estado !== 'cancelado' && estado !== 'rechazado') {
          totalImporte += Number(importe) || 0;
          asignados++;
      }

      csv += `${timeStr},${cliente},${origen},${destino},${chofer},${estado},$${importe}\n`;
    });

    csv += `\nRESUMEN,,,,,\n`;
    csv += `Viajes asignados (sin cancelar): ${asignados},,,,,\n`;
    csv += `Recaudacion aprox: $${totalImporte},,,,,\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "reporte-viajes-06a13.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stats = [
    { title: "Activos", value: activeOrders.length, icon: Car, color: "bg-blue-500" },
    { title: "Pendientes", value: pendingOrders.length, icon: Clock, color: "bg-amber-500" },
    { title: "Completados Hoy", value: completedToday.length, icon: CheckCircle2, color: "bg-green-500" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Central de Despacho</h1>
          <p className="text-muted-foreground mt-1">Gestión en tiempo real</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleDownloadReport} variant="outline" className="rounded-xl border-green-200 text-green-700 bg-green-50">
            Descargar Reporte 06-13hs
          </Button>
          <Link to="/orders/new">
            <Button className="rounded-xl gap-2">
              <Car className="w-4 h-4" />
              Nuevo Pedido
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      {/* Ofertas activas: contador visible en la Central real */}
      {activeOrders.some(o => o.status === "ofrecido") && (
        <div className="space-y-2">
          {activeOrders.filter(o => o.status === "ofrecido").map(order => (
            <div key={order.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">{order.client_name || "Viaje"}</p>
                <p className="text-xs font-semibold text-slate-600 truncate">Ofrecido a {order.driver_name || "móvil"}</p>
              </div>
              <CentralOfferCountdown order={order} />
            </div>
          ))}
        </div>
      )}

      {claimedPendingOrders.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Tomados desde Pendientes
          </h2>
          {claimedPendingOrders
            .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0))
            .map(order => (
              <Link key={order.id} to={`/orders/${order.id}`} className="block">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border-2 border-green-300 bg-green-50 px-4 py-3 shadow-sm hover:bg-green-100">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">
                      {order.pickup_address || order.client_name || "Pasaje"}
                    </p>
                    <p className="text-xs font-semibold text-slate-600 truncate">
                      🚗 {order.driver_name || "Móvil asignado"} · {order.zone || "Sin zona"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <RideAge createdDate={order.created_date} />
                    <Badge className={order.status === "preasignado_proximo" ? "bg-orange-500 text-white" : "bg-green-600 text-white"}>
                      {order.status === "preasignado_proximo" ? "PRÓXIMO VIAJE" :
                       order.status === "aceptado" ? "ACEPTADO" :
                       order.status === "en_camino" ? "EN CAMINO" : "EN VIAJE"}
                    </Badge>
                  </div>
                </div>
              </Link>
            ))}
        </div>
      )}

      {/* Base Queues */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Colas por Base
        </h2>
        
        {/* Top Bar for Quick Assign - Posición de Choferes */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-3 rounded-xl mb-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500 text-slate-900 rounded-lg shadow-sm">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-none">Chóferes en Posición: {availableDrivers.length}</h2>
              <p className="text-xs text-slate-400 font-medium">Asignación rápida a bases</p>
            </div>
          </div>
          <div className="hidden xl:flex items-center gap-2 overflow-x-auto">
            {bases.map(b => {
              const q = drivers.filter(d => d.current_base === b.name && isDriverWorking(d));
              return (
                <div key={b.name} className="flex flex-col items-center justify-center bg-slate-800 rounded-lg px-2 py-1 min-w-[3rem]">
                  <span className="text-[10px] text-slate-400 truncate w-full text-center max-w-[4rem]">{b.name.split("-")[1]}</span>
                  <span className="text-sm font-bold text-white">{q.length}</span>
                </div>
              );
            })}
          </div>
          <div className="w-full sm:w-80 shrink-0">
            <QuickAssignInput drivers={drivers} moviles={moviles} />
          </div>
        </div>

        <BaseQueueManager drivers={drivers} moviles={moviles} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Map */}
        <div className="col-span-1">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Mapa en Vivo</CardTitle>
              <Link to="/map">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  Ver completo <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[400px]">
                <RideMap orders={activeOrders} drivers={drivers} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Panic Alerts */}
      {panicAlerts.length > 0 && (
        <Card className="border-red-400 bg-red-50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2 text-red-700">
                <AlertCircle className="w-5 h-5 animate-pulse" />
                Alertas de Pánico ({panicAlerts.length})
              </CardTitle>
              <button
                onClick={() => setShowPanicPanel(!showPanicPanel)}
                className="text-red-600 hover:text-red-700"
              >
                {showPanicPanel ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </CardHeader>
          {showPanicPanel && (
            <CardContent className="space-y-2">
              {panicAlerts.slice(0, 5).map(alert => (
                <div key={alert.id} className="bg-white rounded-lg p-3 border border-red-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-red-700">{alert.driver_name}</p>
                      <p className="text-xs text-gray-600">{alert.vehicle_plate}</p>
                    </div>
                    <Badge className="bg-red-600 text-white border-0">PÁNICO</Badge>
                  </div>
                  {alert.current_lat && alert.current_lng && (
                    <p className="text-xs text-gray-500 font-mono">
                      📍 {Number(alert.current_lat).toFixed(4)}, {Number(alert.current_lng).toFixed(4)}
                    </p>
                  )}
                  <p className="text-xs text-gray-400">{format(new Date(alert.created_date), "HH:mm:ss")}</p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => window.open(`https://www.google.com/maps/?q=${alert.current_lat},${alert.current_lng}`, "_blank")}
                      className="flex-1 text-xs bg-blue-500 hover:bg-blue-600 text-white py-1 rounded"
                    >
                      Ver en Maps
                    </button>
                    <button
                      onClick={() => handleResolvePanic(alert)}
                      className="flex-1 text-xs bg-green-500 hover:bg-green-600 text-white py-1 rounded"
                    >
                      Atendido
                    </button>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

    </div>
  );
}