import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
// base44 y useQuery se usan solo para bases (dato estático, no necesita tiempo real)
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeDrivers } from "@/hooks/useRealtimeDrivers";

import { Car, Clock, CheckCircle2, Users, ArrowRight, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import RideMap from "@/components/map/RideMap";
import BaseQueueManager, { QuickAssignInput } from "@/components/operator/BaseQueueManager";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { getEffectiveQueueBase } from "@/lib/dispatchLogic";

function isVisiblePending(order) {
  if (!order || order.status !== "pendiente") return false;
  // Pendientes visibles/reclamables sólo existen cuando el backend los autoriza.
  // Las revisiones exclusivas de Central (zona faltante / móvil requerido) no se
  // mezclan con la cartelera normal de Pendientes.
  return order.processingAction === "PENDING_AUTHORIZED";
}

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
    // Sin ALERT_PRESENTED/offerExpiresAt todavía no empezó la ventana comercial.
    const expiresMs = order.offerExpiresAt != null ? Number(order.offerExpiresAt) : NaN;
    if (!Number.isFinite(expiresMs)) {
      setSeconds(null);
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((expiresMs - Date.now()) / 1000);
      setSeconds(remaining > 0 ? remaining : null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [order.status, order.offerExpiresAt, order.assigned_at, order.assignment_attempt]);

  if (seconds == null) {
    return order.status === "ofrecido" ? (
      <Badge className="bg-slate-500 text-white font-mono text-xs font-bold px-3 py-1">
        Esperando teléfono
      </Badge>
    ) : null;
  }
  return (
    <Badge className={`${seconds <= 10 ? "bg-red-600 animate-pulse" : "bg-amber-500"} text-white font-mono text-sm font-black px-3 py-1`}>
      ⏱ QUEDAN 00:{String(seconds).padStart(2, "0")}
    </Badge>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  // Suscripciones en tiempo real — actualizaciones instantáneas sin polling
  const { orders, isLoading: loadingOrders } = useRealtimeOrders({ limit: 100, verifyActiveMs: 10000 });
  const { drivers } = useRealtimeDrivers({ refreshIntervalMs: 0 });

  // Las alertas de rechazo se muestran una sola vez desde AppLayout.
  // Dashboard no ejecuta ninguna reasignación ni abre una segunda suscripción.

  const { data: bases = [] } = useQuery({
    queryKey: ["bases"],
    queryFn: () => base44.entities.Base.list(),
  });

  const dashboardMobileIds = [...new Set(drivers.map(d => String(d.vehicle_model || "")).filter(Boolean))].sort();

  const { data: moviles = [] } = useQuery({
    queryKey: ["moviles_dashboard", dashboardMobileIds.join(",")],
    queryFn: async () => (await Promise.all(
      dashboardMobileIds.map(id => base44.entities.Movil.get(id).catch(() => null))
    )).filter(Boolean),
    enabled: dashboardMobileIds.length > 0,
    staleTime: 60_000,
  });

  const activeOrders = orders.filter(o =>
    ["preasignado_proximo", "ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status) ||
    isVisiblePending(o)
  );
  const pendingOrders = orders.filter(isVisiblePending);
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
    const movil = moviles?.find(m => String(m.id || "") === mobileId);
    if (!movil || movil.activo === false || movil.fuera_de_servicio === true || movil.suspension_motivo) {
      return false;
    }
    return true;
  };
  const availableDrivers = drivers.filter(d => isDriverWorking(d) && getEffectiveQueueBase(d));

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
      
      if(estado !== 'cancelado') {
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
    { title: "Activos", value: activeOrders.length, icon: Car, color: "bg-cyan-400" },
    { title: "Pendientes", value: pendingOrders.length, icon: Clock, color: "bg-orange-400" },
    { title: "Completados Hoy", value: completedToday.length, icon: CheckCircle2, color: "bg-emerald-400" }
  ];

  return (
    <div className="min-h-screen -m-4 md:-m-6 p-4 md:p-6 space-y-6 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-cyan-400/20 bg-slate-900/90 p-4 shadow-xl backdrop-blur-sm">
        <div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">Central de Despacho</h1>
          <p className="text-cyan-300 font-medium mt-1">Gestión en tiempo real</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleDownloadReport} variant="outline" className="rounded-xl border-slate-600 text-slate-100 bg-slate-800 hover:bg-slate-700 font-bold">
            Descargar Reporte 06-13hs
          </Button>
          <Link to="/orders/new">
            <Button className="rounded-xl gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black shadow-lg shadow-cyan-950/30">
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
            <div key={order.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 shadow-sm ring-1 ring-amber-100">
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
          <h2 className="text-lg font-extrabold text-blue-950 flex items-center gap-2">
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
        <h2 className="text-lg font-extrabold text-blue-950 mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Colas por Base
        </h2>
        
        {/* Top Bar for Quick Assign - Posición de Choferes */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-blue-950 border border-blue-900 p-3 rounded-xl mb-4 shadow-sm">
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
              const q = drivers.filter(d => getEffectiveQueueBase(d) === b.name && isDriverWorking(d));
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
          <Card className="border-blue-100 bg-white/95 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-extrabold text-blue-950">Mapa en Vivo</CardTitle>
              <Link to="/map">
                <Button variant="ghost" size="sm" className="text-xs gap-1 text-blue-700 hover:text-blue-900 hover:bg-blue-50">
                  Ver completo <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[400px]">
                <RideMap orders={activeOrders} drivers={drivers} moviles={moviles} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>



    </div>
  );
}