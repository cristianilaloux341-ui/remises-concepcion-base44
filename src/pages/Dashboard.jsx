import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Car, Clock, CheckCircle2, Users, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/dashboard/StatCard";
import OrderCard from "@/components/orders/OrderCard";
import RideMap from "@/components/map/RideMap";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 50),
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const activeOrders = orders.filter(o => ["pendiente", "asignado", "en_camino", "en_viaje"].includes(o.status));
  const pendingOrders = orders.filter(o => o.status === "pendiente");
  const completedToday = orders.filter(o => {
    if (o.status !== "completado") return false;
    const today = new Date().toDateString();
    return new Date(o.updated_date).toDateString() === today;
  });
  const availableDrivers = drivers.filter(d => d.status === "disponible");

  const stats = [
    { title: "Viajes Activos", value: activeOrders.length, icon: Car, color: "bg-blue-500" },
    { title: "Pendientes", value: pendingOrders.length, icon: Clock, color: "bg-amber-500" },
    { title: "Completados Hoy", value: completedToday.length, icon: CheckCircle2, color: "bg-green-500" },
    { title: "Conductores Libres", value: availableDrivers.length, icon: Users, color: "bg-purple-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Panel de Control</h1>
          <p className="text-muted-foreground mt-1">Gestión de viajes en tiempo real</p>
        </div>
        <Link to="/orders/new">
          <Button className="rounded-xl gap-2">
            <Car className="w-4 h-4" />
            Nuevo Viaje
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatCard key={stat.title} {...stat} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
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
              <div className="h-[350px]">
                <RideMap orders={activeOrders} drivers={drivers} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Viajes Recientes</CardTitle>
              <Link to="/orders">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  Ver todos <ArrowRight className="w-3 h-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingOrders ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : activeOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No hay viajes activos</p>
              ) : (
                activeOrders.slice(0, 5).map(order => (
                  <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}