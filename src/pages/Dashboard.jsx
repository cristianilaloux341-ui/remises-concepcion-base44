import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
// base44 y useQuery se usan solo para bases (dato estático, no necesita tiempo real)
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeDrivers } from "@/hooks/useRealtimeDrivers";
import { useRejectionAlert } from "@/hooks/useRejectionAlert";
import { Car, Clock, CheckCircle2, Users, ArrowRight, Zap, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import RideMap from "@/components/map/RideMap";
import BaseQueueManager from "@/components/operator/BaseQueueManager";
import DispatchPanel from "@/components/operator/DispatchPanel";
import { reassignAfterReject } from "@/lib/dispatchLogic";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function Dashboard() {
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

  const [panicAlerts, setPanicAlerts] = useState([]);
  const [showPanicPanel, setShowPanicPanel] = useState(false);

  // Suscribirse a alertas de pánico en tiempo real
  useEffect(() => {
    const unsubscribe = base44.entities.PanicAlert.subscribe((event) => {
      if (event.type === "create") {
        setPanicAlerts(prev => [event.data, ...prev]);
        setShowPanicPanel(true);
        // Audio alert
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
      }
    });
    return unsubscribe;
  }, []);

  const activeOrders = orders.filter(o => ["pendiente", "ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status));
  const pendingOrders = orders.filter(o => o.status === "pendiente");
  const completedToday = orders.filter(o => {
    if (o.status !== "completado") return false;
    return new Date(o.updated_date).toDateString() === new Date().toDateString();
  });
  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);

  const stats = [
    { title: "Activos", value: activeOrders.length, icon: Car, color: "bg-blue-500" },
    { title: "Pendientes", value: pendingOrders.length, icon: Clock, color: "bg-amber-500" },
    { title: "Completados Hoy", value: completedToday.length, icon: CheckCircle2, color: "bg-green-500" },
    { title: "Chóferes en Posición", value: availableDrivers.length, icon: Users, color: "bg-purple-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Central de Despacho</h1>
          <p className="text-muted-foreground mt-1">Gestión en tiempo real</p>
        </div>
        <Link to="/orders/new">
          <Button className="rounded-xl gap-2">
            <Car className="w-4 h-4" />
            Nuevo Pedido
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Map */}
        <div className="xl:col-span-2">
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
              <div className="h-[320px]">
                <RideMap orders={activeOrders} drivers={drivers} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dispatch panel */}
        <div>
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                Panel de Despacho
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-y-auto max-h-[400px]">
              <DispatchPanel
                orders={orders}
                drivers={drivers}
                bases={bases}
                onOrderClick={(o) => window.location.href = `/orders/${o.id}`}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Base Queues */}
      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Colas por Base
        </h2>
        <BaseQueueManager drivers={drivers} />
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
                      📍 {alert.current_lat.toFixed(4)}, {alert.current_lng.toFixed(4)}
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
                      onClick={() => base44.entities.PanicAlert.update(alert.id, { status: "atendido" }).then(() => setPanicAlerts(prev => prev.filter(a => a.id !== alert.id)))}
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