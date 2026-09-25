import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, User, MapPin, Loader2, ChevronRight, Car, CheckCircle2 } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import { getBaseQueue } from "@/lib/dispatchLogic";
import { getDriverDisplay } from "@/lib/utils";
import { resolveActiveDriverForMobile } from "@/lib/mobileDriverResolver";

function PendingOrderCard({ order, drivers, moviles, bases, onDispatched }) {
  const [dispatching, setDispatching] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const isDriverWorking = (d) => {
    if (d.status !== "disponible") return false;
    const mobileId = String(d.vehicle_model || "");
    const movil = moviles?.find(m => String(m.id || "") === mobileId);
    if (!movil || movil.activo === false || movil.fuera_de_servicio === true || movil.suspension_motivo) {
      return false;
    }
    return true;
  };

  const availableDrivers = drivers.filter(d => isDriverWorking(d));
  const isRequestedReview = order.pending_reason === "REQUESTED_DRIVER_NOT_ACCEPTED" ||
    order.processingAction === "CENTRAL_REVIEW_REQUIRED_DRIVER";
  const isZoneZero = order.pending_reason === "ZONE_0_DIRECT_PENDING";
  const isZoneReview = order.processingAction === "CENTRAL_REVIEW_ZONE_REQUIRED";

  // Zona del pedido → primera en cola
  const zoneQueue = order.zone ? getBaseQueue(availableDrivers, order.zone) : [];
  const suggestedDriver = zoneQueue[0] || null;

  const handleAutoAssign = async () => {
    setDispatching(true);
    try {
      // La vista local es informativa. La decisión real siempre la toma el backend
      // con una lectura fresca de la cola autoritativa.
      const res = await base44.functions.invoke("operatorDispatchPendingRide", {
        orderId: order.id,
        sessionToken: sessionStorage.getItem("local_operator_token")
      });
      if (!res?.data?.success) throw new Error(res?.data?.reason || "No se pudo despachar el pendiente");

      const localOp = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
      base44.entities.AuditLog.create({
        action: "asignar_viaje",
        user_type: localOp?.role || "operador",
        user_name: localOp?.name || "Operador",
        details: `Despacho de pendiente para ${order.client_name}`
      }).catch(() => {});
      onDispatched();
    } catch (err) {
      alert(err?.message || "No se pudo despachar el pendiente");
    } finally {
      setDispatching(false);
    }
  };

  const handleManualAssign = async () => {
    if (!selectedDriverId) return;
    setDispatching(true);

    try {
      const inputTrimmed = selectedDriverId.trim();
      const resolved = resolveActiveDriverForMobile(inputTrimmed, drivers, moviles);
      if (!resolved.driver) throw new Error(resolved.error);

      const driver = resolved.driver;
      const res = await base44.functions.invoke("operatorDispatchPendingRide", {
        orderId: order.id,
        driverId: driver.id,
        mobileId: resolved.mobile?.id || null,
        manual: true,
        sessionToken: sessionStorage.getItem("local_operator_token")
      });
      if (!res?.data?.success) throw new Error(res?.data?.reason || "No se pudo asignar el pasaje");

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
    <div className={`p-3 rounded-xl border space-y-3 ${isRequestedReview ? "bg-red-50 border-red-300" : isZoneZero ? "bg-orange-50 border-orange-400" : "bg-amber-50 border-amber-200"}`}> 
      {/* Orden info */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-sm truncate">{order.client_name}</p>
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
          {isRequestedReview && (
            <div className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2">
              <p className="text-xs font-black text-red-700">⚠ MÓVIL REQUERIDO NO ACEPTÓ</p>
              <p className="text-xs text-slate-700">No se envía a otros móviles automáticamente. Consultá al cliente o elegí otro móvil abajo.</p>
            </div>
          )}
          {isZoneReview && (
            <div className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-2">
              <p className="text-xs font-black text-red-700">⚠ ZONA SIN RESOLVER</p>
              <p className="text-xs text-slate-700">Corregí la zona del viaje antes de despacharlo. No se permite asignar un móvil mientras la zona sea desconocida.</p>
            </div>
          )}
          {isZoneZero && (
            <div className="mt-2 rounded-lg border border-orange-400 bg-white px-3 py-2">
              <p className="text-xs font-black text-orange-700">⚠ ZONA 0 · ATENCIÓN OPERADOR</p>
              <p className="text-xs text-slate-700">Este pasaje entra directo a Pendientes. No inicia despacho automático por cola.</p>
            </div>
          )}
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Chofer sugerido (primero en zona) */}
      {!isRequestedReview && !isZoneZero && !isZoneReview && (
        suggestedDriver ? (
          <div className="bg-white rounded-lg border border-amber-200 px-3 py-2 flex items-center gap-2">
            <Car className="w-4 h-4 text-amber-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-black truncate">{getDriverDisplay(moviles.find(m => String(m.id || "") === String(suggestedDriver.vehicle_model || ""))?.numero_movil, suggestedDriver.name)}</p>
              <p className="text-xs font-medium text-black font-mono">{suggestedDriver.queue_authoritative_base}</p>
            </div>
            <Badge className="text-xs bg-amber-100 text-amber-700 border-0 shrink-0">1° en zona</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            <Car className="w-3 h-3" />
            Sin móviles en zona · Quedará pendiente
          </div>
        )
      )}

      {/* Auto-asignar: nunca para un requerido retenido; ahí decide el operador */}
      {!isRequestedReview && !isZoneZero && !isZoneReview && (
        <Button
          size="sm"
          className="w-full gap-2 rounded-lg h-8 font-extrabold"
          onClick={handleAutoAssign}
          disabled={dispatching}
        >
          {dispatching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {suggestedDriver ? `Despachar · sugerido ${getDriverDisplay(moviles.find(m => String(m.id || "") === String(suggestedDriver.vehicle_model || ""))?.numero_movil, suggestedDriver.name)}` : "Consultar cola y despachar"}
        </Button>
      )}

      {/* Selector manual: una zona desconocida debe resolverse primero. */}
      {!isZoneReview && <div className="flex gap-2">
        <input 
          className="flex-1 h-8 text-base font-extrabold text-slate-900 rounded-lg border-2 border-slate-400 px-3 bg-white placeholder:text-slate-500 placeholder:font-normal"
          style={{ color: "#000000", backgroundColor: "#ffffff" }}
          placeholder={isRequestedReview ? "Reasignar: Nº o nombre..." : "Emergencia: Nº o nombre..."}
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

function OfferCountdown({ order }) {
  const [seconds, setSeconds] = useState(null);

  useEffect(() => {
    if (order.status !== "ofrecido") {
      setSeconds(null);
      return;
    }

    // Central sólo muestra el reloj comercial autoritativo del backend.
    // Antes de ALERT_PRESENTED no existe vencimiento comercial.
    const expiresMs = order.offerExpiresAt != null ? Number(order.offerExpiresAt) : NaN;

    if (!Number.isFinite(expiresMs)) {
      setSeconds(null);
      return;
    }

    const update = () => setSeconds(Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [order.status, order.offerExpiresAt, order.assigned_at, order.assignment_attempt]);

  if (seconds == null) {
    return order.status === "ofrecido" ? (
      <span className="font-mono text-xs font-bold px-2 py-1 rounded-lg border text-slate-700 bg-slate-100 border-slate-300">
        Esperando presentación en teléfono
      </span>
    ) : null;
  }
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span className={`font-mono text-sm font-black px-2 py-1 rounded-lg border ${seconds <= 10 ? "text-white bg-red-600 border-red-700 animate-pulse" : "text-amber-900 bg-amber-100 border-amber-300"}`}>
      ⏱ QUEDAN {mm}:{ss}
    </span>
  );
}

export default function DispatchPanel({ orders, drivers, bases, moviles, onOrderClick }) {
  const [dispatchingAll, setDispatchingAll] = useState(false);

  const pending = orders.filter(o =>
    o.status === "pendiente" &&
    (o.processingAction === "PENDING_AUTHORIZED" ||
     o.processingAction === "CENTRAL_REVIEW_REQUIRED_DRIVER" ||
     o.processingAction === "CENTRAL_REVIEW_ZONE_REQUIRED")
  );
  const active = orders.filter(o => ["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status));

  const handleDispatchAll = async () => {
    setDispatchingAll(true);
    
    // Serial: cada pedido consulta al backend; la foto local nunca decide
    // si existe candidato ni cuál es el primero.
    for (const order of pending) {
      // Los requeridos no aceptados exigen una decisión explícita del operador.
      if (order.processingAction !== "PENDING_AUTHORIZED") continue;
      try {
        const res = await base44.functions.invoke("operatorDispatchPendingRide", {
          orderId: order.id,
          sessionToken: sessionStorage.getItem("local_operator_token")
        });
        if (!res?.data?.success) throw new Error(res?.data?.reason || "No se pudo despachar el pendiente");
      } catch (e) {
        console.warn("Despacho serial rechazado por backend", order.id, e);
      }
    }
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
                        <User className="w-3 h-3" />{getDriverDisplay(moviles.find(m => String(m.id || "") === String(d?.vehicle_model || ""))?.numero_movil, order.driver_name)}
                        {order.assigned_base && <span className="ml-1 font-normal text-gray-600">· {order.assigned_base}</span>}
                      </p>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <OrderStatusBadge status={order.status} />
                  <OfferCountdown order={order} />
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