import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, User, MapPin, Phone, Loader2, ChevronRight } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { findBestDriver, assignDriverToOrder } from "@/lib/dispatchLogic";

export default function DispatchPanel({ orders, drivers, bases, onOrderClick }) {
  const queryClient = useQueryClient();
  const [dispatching, setDispatching] = useState(null);

  const pending = orders.filter(o => o.status === "pendiente");
  const active = orders.filter(o => ["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status));

  const handleAutoDispatch = async (order) => {
    setDispatching(order.id);
    const driver = await findBestDriver(order, drivers, bases);
    if (driver) {
      await assignDriverToOrder(order, driver);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
    setDispatching(null);
  };

  const handleDispatchAll = async () => {
    setDispatching("all");
    for (const order of pending) {
      const driver = await findBestDriver(order, drivers, bases);
      if (driver) await assignDriverToOrder(order, driver);
    }
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    setDispatching(null);
  };

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{pending.length} pendiente(s)</p>
          <Button size="sm" className="gap-2 rounded-lg" onClick={handleDispatchAll} disabled={dispatching === "all"}>
            {dispatching === "all" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Despachar Todo
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pendientes</p>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sin pedidos pendientes</p>
        ) : (
          pending.map(order => (
            <div key={order.id} className="p-3 rounded-xl border bg-amber-50 border-amber-200 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{order.client_name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3" />{order.client_phone}
                  </p>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>
              <p className="text-xs flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3 h-3 shrink-0 text-green-500" />{order.pickup_address}
              </p>
              {order.dropoff_address && (
                <p className="text-xs flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3 h-3 shrink-0 text-red-500" />{order.dropoff_address}
                </p>
              )}
              <Button
                size="sm"
                className="w-full gap-2 rounded-lg h-8"
                onClick={() => handleAutoDispatch(order)}
                disabled={!!dispatching}
              >
                {dispatching === order.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Asignar Automático
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">En Curso</p>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Sin viajes activos</p>
        ) : (
          active.map(order => (
            <div
              key={order.id}
              className="p-3 rounded-xl border bg-blue-50 border-blue-200 cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => onOrderClick?.(order)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{order.client_name}</p>
                  {order.driver_name && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" />{order.driver_name}
                      {order.assigned_base && <span className="ml-1">· {order.assigned_base}</span>}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <OrderStatusBadge status={order.status} />
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}