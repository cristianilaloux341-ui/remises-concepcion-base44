import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import RideMap from "@/components/map/RideMap";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { Car, MapPin } from "lucide-react";

export default function MapView() {
  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 50),
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const activeOrders = orders.filter(o =>
    ["pendiente", "asignado", "en_camino", "en_viaje"].includes(o.status)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Mapa en Vivo</h1>
        <p className="text-muted-foreground mt-1">
          {activeOrders.length} viajes activos · {drivers.filter(d => d.status === "disponible").length} conductores disponibles
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 h-[calc(100vh-220px)] min-h-[500px]">
          <RideMap orders={activeOrders} drivers={drivers} className="h-full" />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Car className="w-4 h-4" />
                Viajes Activos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeOrders.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Sin viajes activos</p>
              ) : (
                activeOrders.map(order => (
                  <div key={order.id} className="p-2 rounded-lg bg-muted/50 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{order.client_name}</span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="text-muted-foreground truncate">{order.pickup_address}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Conductores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {drivers.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Sin conductores</p>
              ) : (
                drivers.map(driver => (
                  <div key={driver.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs">
                    <div>
                      <p className="font-medium">{driver.name}</p>
                      <p className="text-muted-foreground">{driver.vehicle_plate}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        driver.status === "disponible"
                          ? "bg-green-100 text-green-700 border-green-200"
                          : driver.status === "en_viaje"
                          ? "bg-blue-100 text-blue-700 border-blue-200"
                          : "bg-gray-100 text-gray-700 border-gray-200"
                      }
                    >
                      {driver.status?.replace("_", " ")}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}