import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getEffectiveRole } from "@/lib/permissions";
import { useAuth } from "@/lib/AuthContext";
import { useRealtimeOrders } from "@/lib/useRealtimeOrders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Phone, MapPin, User, DollarSign, Trash2, Loader2, XCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import RideTicket from "@/components/orders/RideTicket";
import RideMap from "@/components/map/RideMap";
import { assignDriverToOrder } from "@/lib/dispatchLogic";
import { formatTimeBA } from "@/lib/utils";

export default function OrderDetail() {
  const { user } = useAuth();
  const canEmergencyAssign = ["admin", "supervisor", "operador"].includes(getEffectiveRole(user));
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = window.location.pathname.split("/").pop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useRealtimeOrders();

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 100),
    staleTime: 60000,
  });

  // El detalle no puede depender de que el pasaje siga dentro de los últimos 100.
  // Un viaje viejo/enganchado debe poder abrirse siempre por su ID para que Central
  // pueda revisarlo, cancelarlo o resolverlo manualmente.
  const {
    data: fetchedOrder,
    isLoading: isOrderLoading,
    isError: isOrderError,
    refetch: refetchOrder,
  } = useQuery({
    queryKey: ["order-detail", orderId],
    queryFn: () => base44.entities.RideOrder.get(orderId),
    enabled: Boolean(orderId),
    staleTime: 5000,
    refetchOnWindowFocus: true,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  // Si realtime ya tiene una versión más nueva, usarla; si no, usar la búsqueda directa.
  const order = orders.find(o => o.id === orderId) || fetchedOrder;

  const manualCompleteMutation = useMutation({
    mutationFn: async () => {
      const driverId = order.driver_id || order.reserved_driver_id || null;
      if (!driverId) throw new Error("El pasaje no tiene móvil vinculado");
      const response = await base44.functions.invoke("finishRide", {
        orderId: order.id,
        driverId,
        importeFinal: order.importe_real_actual ?? 0,
        operationKey: `CENTRAL_MANUAL_FINISH_${order.id}_${Date.now()}`,
        sessionToken: sessionStorage.getItem("local_operator_token")
      });
      if (!response.data?.success) {
        throw new Error(response.data?.reason || "No se pudo terminar el pasaje");
      }
      return response.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["order-detail", orderId] }),
        queryClient.invalidateQueries({ queryKey: ["drivers"] })
      ]);
    }
  });

  const manualCompleteRide = async () => {
    const confirmed = window.confirm(
      "¿Marcar este pasaje como TERMINADO?\n\nUsá esta opción sólo si el viaje ya finalizó y quedó enganchado en el sistema."
    );
    if (!confirmed) return;
    try {
      await manualCompleteMutation.mutateAsync();
    } catch (error) {
      alert(error?.message || "No se pudo terminar el pasaje manualmente.");
    }
  };

  // Cancelación autoritativa: Central pide la acción; backend libera vínculos,
  // conserva la regla comercial de devolver primero y registra la transición.
  const cancelOrder = async () => {
    const response = await base44.functions.invoke("operatorOrderAction", {
      action: "cancel",
      orderId: order.id,
      sessionToken: sessionStorage.getItem("local_operator_token")
    });
    if (!response?.data?.success) {
      alert(response?.data?.reason || "No se pudo cancelar el pasaje.");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      let localOperator = null;
      try { localOperator = JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch {}
      const response = await base44.functions.invoke("operatorDeleteRide", {
        orderId: id,
        sessionToken: sessionStorage.getItem("local_operator_token"),
        operatorName: localOperator?.nombre || localOperator?.name || localOperator?.usuario || "Central"
      });
      if (!response?.data?.success) throw new Error(response?.data?.reason || "No se pudo eliminar el viaje");
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
      navigate("/orders");
    },
  });

  if (!order && isOrderLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 text-center space-y-4">
        <p className="font-semibold text-lg">No se pudo cargar este pasaje.</p>
        <p className="text-sm text-muted-foreground">
          {isOrderError
            ? "La Central no pudo consultar el pasaje por su ID."
            : "El pasaje no existe o ya no está disponible."}
        </p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => navigate("/orders")}>Volver</Button>
          <Button onClick={() => refetchOrder()}>Reintentar</Button>
        </div>
      </div>
    );
  }

  const handleAssignDriver = async (driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) {
      alert("No se encontró el móvil seleccionado. Actualizá la lista e intentá nuevamente.");
      return;
    }
    if (driver.status !== "disponible") {
      alert(`El móvil ${driver.name} está fuera de servicio u ocupado. El pasaje no fue enviado.`);
      return;
    }
    try {
      await assignDriverToOrder(order, driver, { requireDriverConfirmation: true, forceManual: true });
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
    } catch (err) {
      alert(err?.message || "No se pudo asignar el pasaje");
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
    }
  };

  const isDriverWorking = (d) => {
    // En esta pantalla no descargamos la tabla completa de Movil. La lista visual
    // usa el estado operativo del Driver y assignRide hace la validación definitiva
    // del Movil seleccionado (activo, suspensión y fuera de servicio) antes del push.
    // La base autoritativa manda. current_base queda sólo como dato compatible/visual.
    const effectiveBase = d.queue_authoritative_base || null;
    if (d.status !== "disponible" || !effectiveBase) return false;
    if (d.active_order_id || d.active_ride_id || d.reserved_order_id) return false;
    if (d.dispatch_status != null && d.dispatch_status !== "normal") return false;
    return true;
  };

  const availableDrivers = drivers.filter(d => isDriverWorking(d) || d.id === order?.driver_id);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="gap-2" onClick={() => navigate("/orders")}>
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Button>
        <div className="flex gap-2">
          {order.status !== "cancelado" && (
            <>
              {order.status === "completado" && (
                <RideTicket order={order} />
              )}
              {["aceptado", "en_camino", "en_viaje"].includes(order.status) && (
                <Button
                  size="sm"
                  className="gap-2 bg-green-600 hover:bg-green-700"
                  onClick={manualCompleteRide}
                  disabled={manualCompleteMutation.isPending}
                >
                  {manualCompleteMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <CheckCircle2 className="w-4 h-4" />}
                  {manualCompleteMutation.isPending ? "Terminando..." : "Terminar pasaje"}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-red-200 text-red-600 hover:bg-red-50"
                onClick={cancelOrder}
              >
                <XCircle className="w-4 h-4" /> Cancelar
              </Button>
            </>
          )}
          {(() => {
            try {
              if (getEffectiveRole(user) === "admin") {
                return (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2"
                    onClick={() => deleteMutation.mutate(order.id)}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Eliminar
                  </Button>
                );
              }
            } catch { return null; }
            return null;
          })()}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Detalle del Viaje</CardTitle>
              <OrderStatusBadge status={order.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">{order.client_name}</p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {order.client_phone}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center mt-0.5 shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">RECOGIDA</p>
                  <p className="font-medium">{order.pickup_address}</p>
                </div>
              </div>
              {order.dropoff_address && (
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center mt-0.5 shrink-0">
                    <MapPin className="w-3.5 h-3.5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">DESTINO</p>
                    <p className="font-medium">{order.dropoff_address}</p>
                  </div>
                </div>
              )}
            </div>

            {order.fare && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-xl">
                <DollarSign className="w-5 h-5 text-green-600" />
                <span className="font-bold text-lg">${Number(order.fare).toLocaleString()}</span>
              </div>
            )}

            {order.notes && (
              <div className="p-3 bg-muted rounded-xl">
                <p className="text-xs text-muted-foreground mb-1">NOTAS</p>
                <p className="text-sm">{order.notes}</p>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Creado: {order.created_date ? formatTimeBA(order.created_date, "short") : "Fecha desconocida"}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {canEmergencyAssign ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Asignación de emergencia</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {order.driver_id ? "Reasignar Conductor" : "Asignar Conductor"}
                  </label>
                  <Select value={order.driver_id || undefined} onValueChange={handleAssignDriver}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar conductor" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableDrivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} - {d.vehicle_plate}{d.queue_authoritative_base ? ` (${d.queue_authoritative_base || d.current_base})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                El despacho se resuelve automáticamente por la cola de la zona o desde Pendientes.
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardContent className="p-0 h-[250px]">
              <RideMap orders={[order]} drivers={[]} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}