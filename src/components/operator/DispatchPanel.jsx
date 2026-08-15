import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, User, MapPin, Loader2, ChevronRight, Car, CheckCircle2, Radio } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { autoDispatch, assignDriverToOrder, getBaseQueue, BASES } from "@/lib/dispatchLogic";
import { getDriverDisplay } from "@/lib/utils";

function PendingOrderCard({ order, drivers, moviles, bases, onDispatched }) {
  const [dispatching, setDispatching] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);
  const isBroadcast = (order.notes || "").startsWith("[BROADCAST]");

  // Zona del pedido → primera en cola
  const zoneQueue = order.zone ? getBaseQueue(availableDrivers, order.zone) : [];
  const suggestedDriver = zoneQueue[0] || null;

  const handleAutoAssign = async () => {
    setDispatching(true);
    await autoDispatch(order, drivers, bases);
    
    const localOp = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
    base44.entities.AuditLog.create({
      action: "asignar_viaje",
      user_type: localOp?.role || "operador",
      user_name: localOp?.name || "Operador",
      details: `Despacho automático/broadcast para ${order.client_name}`
    }).catch(() => {});

    onDispatched();
    setDispatching(false);
  };

  const handleManualAssign = async () => {
    if (!selectedDriverId) return;
    setDispatching(true);

    try {
      const inputTrimmed = selectedDriverId.trim();
      const movilByPlate = Object.fromEntries((moviles || []).map(m => [m.dominio?.toUpperCase(), m.numero_movil]));

      // Solo se puede asignar un chofer real y actualmente disponible.
      const driver = drivers.find(d =>
        d.id === inputTrimmed ||
        d.vehicle_model === inputTrimmed ||
        d.name.toLowerCase() === inputTrimmed.toLowerCase() ||
        (movilByPlate[d.vehicle_plate?.toUpperCase()] === parseInt(inputTrimmed))
      );

      if (!driver) {
        throw new Error(`No existe un chofer registrado para el móvil "${inputTrimmed}".`);
      }
      if (driver.status !== "disponible") {
        throw new Error(`El móvil ${inputTrimmed} está fuera de servicio u ocupado. El pasaje no fue enviado.`);
      }

      await assignDriverToOrder(order, driver, { requireDriverConfirmation: true });

      const localOp = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
      base44.entities.AuditLog.create({
        action: "asignar_viaje",
        user_type: localOp?.role || "operador",
        user_name: localOp?.name || "Operador",
        details: `Asignó manualmente a ${driver.name} el viaje de ${order.client_name}`
      }).catch(() => {});

      setSelectedDriverId("");
      onDispatched();
      window.dispatchEvent(new Event("force-driver-refresh"));
    } catch (err) {
      alert(err?.message || "No se pudo asignar el pasaje");
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className={`p-3 rounded-xl border space-y-3 ${isBroadcast ? "bg-orange-50 border-orange-300" : "bg-amber-50 border-amber-200"}`}>
      {/* Orden info */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{order.client_name}</p>
            {isBroadcast && (
              <Badge className="bg-orange-100 text-orange-700 border-0 text-xs gap-1 shrink-0">
                <Radio className="w-2.5 h-2.5" /> broadcast
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3 shrink-0 text-green-500" />{order.pickup_address}
          </p>
          {order.dropoff_address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3 shrink-0 text-red-500" />{order.dropoff_address}
            </p>
          )}
          {order.zone && (
            <p className="text-xs text-blue-600 font-medium mt-0.5">Zona: {order.zone}</p>
          )}
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Chofer sugerido (primero en zona) */}
      {!isBroadcast && (
        suggestedDriver ? (
          <div className="bg-white rounded-lg border border-amber-200 px-3 py-2 flex items-center gap-2">
            <Car className="w-4 h-4 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-black truncate">{getDriverDisplay(suggestedDriver.vehicle_model || suggestedDriver.vehicle_plate, suggestedDriver.name)}</p>
              <p className="text-xs font-medium text-black font-mono">{suggestedDriver.current_base}</p>
            </div>
            <Badge className="text-xs bg-amber-100 text-amber-700 border-0 shrink-0">1° en zona</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2">
            <Radio className="w-3 h-3" />
            Sin móviles en zona · se enviará broadcast
          </div>
        )
      )}

      {isBroadcast && (
        <div className="flex items-center gap-2 text-xs text-orange-700 bg-orange-100 rounded-lg px-3 py-2">
          <Radio className="w-3 h-3" />
          Esperando que un móvil acepte...
        </div>
      )}

      {/* Auto-asignar */}
      <Button
        size="sm"
        className="w-full gap-2 rounded-lg h-8 font-extrabold"
        onClick={handleAutoAssign}
        disabled={dispatching}
      >
        {dispatching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        {suggestedDriver ? `Asignar a ${suggestedDriver.name}` : "Broadcast a todos"}
      </Button>

      {/* Selector manual */}
      <div className="flex gap-2">
        <input 
          className="flex-1 h-8 text-base font-extrabold text-slate-900 rounded-lg border-2 border-slate-400 px-3 bg-white placeholder:text-slate-500 placeholder:font-normal"
          style={{ color: "#000000", backgroundColor: "#ffffff" }}
          placeholder="Nº o Nombre para asignar..."
          value={selectedDriverId}
          onChange={(e) => setSelectedDriverId(e.target.value)}
          onKeyDown={(e) => {
             if (e.key === 'Enter' && selectedDriverId) {
               handleManualAssign();
             }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-3 rounded-lg shrink-0"
          onClick={handleManualAssign}
          disabled={!selectedDriverId || dispatching}
        >
          <CheckCircle2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

export default function DispatchPanel({ orders, drivers, bases, moviles, onOrderClick }) {
  const [dispatchingAll, setDispatchingAll] = useState(false);

  const pending = orders.filter(o => o.status === "pendiente");
  const active = orders.filter(o => ["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status));

  const handleDispatchAll = async () => {
    setDispatchingAll(true);
    await Promise.all(
      pending.map(order => autoDispatch(order, drivers, bases))
    );
    setDispatchingAll(false);
  };

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
              moviles={moviles}
              bases={bases}
              onDispatched={() => {}}
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
                  {order.driver_name && (() => {
                    const d = drivers.find(drv => drv.id === order.driver_id);
                    return (
                      <p className="text-xs font-bold text-black flex items-center gap-1">
                        <User className="w-3 h-3" />{getDriverDisplay(d?.vehicle_model || d?.vehicle_plate, order.driver_name)}
                        {order.assigned_base && <span className="ml-1 font-normal text-gray-600">· {order.assigned_base}</span>}
                      </p>
                    );
                  })()}
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