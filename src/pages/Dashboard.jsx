import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Car, Clock, CheckCircle2, Users, ArrowRight, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import RideMap from "@/components/map/RideMap";
import BaseQueue from "@/components/operator/BaseQueue";
import DispatchPanel from "@/components/operator/DispatchPanel";
import { BASES } from "@/lib/dispatchLogic";

export default function Dashboard() {
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 100),
    refetchInterval: 10000,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: 10000,
  });

  const { data: bases = [] } = useQuery({
    queryKey: ["bases"],
    queryFn: () => base44.entities.Base.list(),
  });

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {BASES.map(baseName => (
            <BaseQueue key={baseName} baseName={baseName} drivers={drivers} />
          ))}
        </div>
      </div>
    </div>
  );
}