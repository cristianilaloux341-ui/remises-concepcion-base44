import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, User, MapPin, Loader2, ChevronRight, Car, CheckCircle2 } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { findBestDriver, assignDriverToOrder, getBaseQueue, BASES } from "@/lib/dispatchLogic";

function PendingOrderCard({ order, drivers, bases, onDispatched }) {
  const [dispatching, setDispatching] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [suggestedDriver, setSuggestedDriver] = useState(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);

  // Load suggestion on mount
  useEffect(() => {
    setLoadingSuggestion(true);
    findBestDriver(order, drivers, bases).then(d => {
      setSuggestedDriver(d);
      setLoadingSuggestion(false);
    });
  }, [order.id, drivers.length]);

  const handleAssign = async (driverIdOverride) => {
    setDispatching(true);
    const driverId = driverIdOverride || selectedDriverId;
    let driver;
    if (driverId) {
      driver = drivers.find(d => d.id === driverId);
    } else {
      driver = suggestedDriver || (await findBestDriver(order, drivers, bases));
    }
    if (driver) {
      await assignDriverToOrder(order, driver);
      onDispatched();
    }
    setDispatching(false);
  };

  return (
    <div className="p-3 rounded-xl border bg-amber-50 border-amber-200 space-y-3">
      {/* Order info */}
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-sm">{order.client_name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 shrink-0 text-green-500" />{order.pickup_address}
          </p>
          {order.dropoff_address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0 text-red-500" />{order.dropoff_address}
            </p>
          )}
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Suggested driver */}
      {loadingSuggestion ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> Buscando mejor chofer...
        </div>
      ) : suggestedDriver ? (
        <div className="bg-white rounded-lg border border-amber-200 px-3 py-2 flex items-center gap-2">
          <Car className="w-4 h-4 text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">{suggestedDriver.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{suggestedDriver.vehicle_plate} · {suggestedDriver.current_base}</p>
          </div>
          <Badge className="text-xs bg-amber-100 text-amber-700 border-0 shrink-0">sugerido</Badge>
        </div>
      ) : (
        <p className="text-xs text-red-500">Sin chóferes disponibles</p>
      )}

      {/* Auto assign button */}
      <Button
        size="sm"
        className="w-full gap-2 rounded-lg h-8"
        onClick={() => handleAssign()}
        disabled={dispatching || (!suggestedDriver && !selectedDriverId)}
      >
        {dispatching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        Asignar {suggestedDriver ? suggestedDriver.name : "Auto"}
      </Button>

      {/* Manual selector */}
      <div className="flex gap-2">
        <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
          <SelectTrigger className="h-8 text-xs rounded-lg flex-1">
            <SelectValue placeholder="Elegir otro chofer..." />
          </SelectTrigger>
          <SelectContent>
            {availableDrivers.map(d => (
              <SelectItem key={d.id} value={d.id}>
                {d.name} — {d.vehicle_plate} ({d.current_base})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3 rounded-lg shrink-0"
          onClick={() => handleAssign(selectedDriverId)}
          disabled={!selectedDriverId || dispatching}
        >
          <CheckCircle2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

export default function DispatchPanel({ orders, drivers, bases, onOrderClick }) {
  const [dispatchingAll, setDispatchingAll] = useState(false);

  const pending = orders.filter(o => o.status === "pendiente");
  const active = orders.filter(o => ["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status));

  const handleDispatchAll = async () => {
    setDispatchingAll(true);
    // Despachar todos en paralelo para máxima velocidad
    await Promise.all(
      pending.map(async (order) => {
        const driver = await findBestDriver(order, drivers, bases);
        if (driver) await assignDriverToOrder(order, driver);
      })
    );
    setDispatchingAll(false);
    // No necesita invalidateQueries — la suscripción en tiempo real actualiza el estado automáticamente
  };

  // No necesita invalidateQueries — la suscripción en tiempo real actualiza automáticamente
  const handleDispatched = () => {};

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{pending.length} pendiente(s)</p>
          <Button size="sm" className="gap-2 rounded-lg" onClick={handleDispatchAll} disabled={dispatchingAll}>
            {dispatchingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
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
            <PendingOrderCard
              key={order.id}
              order={order}
              drivers={drivers}
              bases={bases}
              onDispatched={handleDispatched}
            />
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