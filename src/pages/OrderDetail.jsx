import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getEffectiveRole } from "@/lib/permissions";
import { useAuth } from "@/lib/AuthContext";
import { useRealtimeOrders, useRealtimeDrivers } from "@/lib/useRealtimeOrders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Phone, MapPin, User, DollarSign, Trash2, Loader2, XCircle, RefreshCw } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import RideTicket from "@/components/orders/RideTicket";
import RideMap from "@/components/map/RideMap";
import { assignDriverToOrder } from "@/lib/dispatchLogic";
import { formatTimeBA } from "@/lib/utils";

export default function OrderDetail() {
  const { user } = useAuth();
  const canEmergencyAssign = ["admin", "supervisor"].includes(getEffectiveRole(user));
  const urlParams = new URLSearchParams(window.location.search);
  const orderId = window.location.pathname.split("/").pop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useRealtimeOrders();
  useRealtimeDrivers();

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 100),
    staleTime: 60000,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
    staleTime: 60000,
  });

  const { data: moviles = [] } = useQuery({
    queryKey: ["moviles"],
    queryFn: () => base44.entities.Movil.list(),
    staleTime: 60000,
  });

  const order = orders.find(o => o.id === orderId);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.RideOrder.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueryData(["orders"]);
      queryClient.setQueryData(["orders"], old => old ? old.map(o => o.id === id ? { ...o, ...data } : o) : old);
      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) queryClient.setQueryData(["orders"], context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] }),
  });

  // When cancelling an active order, put the assigned driver first in queue
  const cancelOrder = async () => {
    await base44.entities.RideOrder.update(order.id, {
      status: "cancelado",
      offerExpiresAt: null,
      processingAction: null,
      processingOperationKey: null,
      processingOwnerId: null,
      processingLeaseExpiresAt: null,
      processingPhase: null
    });
    
    // offered_driver_ids es historial: no usar jamás como fallback.
    // Solo enviar cancelación al móvil activamente asignado o reservado.
    const toCancel = [...new Set([order.driver_id, order.reserved_driver_id, order.preassigned_driver_id])].filter(Boolean);

    if (order.preassigned_driver_id) {
      await base44.entities.Driver.updateMany(
        { id: order.preassigned_driver_id, next_order_id: order.id },
        { $set: { next_order_id: null, next_order_token: null } }
      ).catch(() => {});
    }
    
    if (toCancel.length > 0) {
      // Liberar únicamente móviles que todavía sigan vinculados a ESTA orden.
      await base44.entities.Driver.updateMany(
        { id: { $in: toCancel }, $or: [{ active_order_id: order.id }, { active_ride_id: order.id }, { reserved_order_id: order.id }] },
        {
          $set: {
            status: "disponible",
            dispatch_status: "normal",
            active_order_id: null,
            active_ride_id: null,
            reserved_order_id: null,
            reservation_token: null,
            manual_reservation_token: null,
            driver_reservation_key: null
          }
        }
      );

      if (order.driver_id && !order.preassigned_driver_id) {
        // Set queue_entered_at far in the past so driver appears first
        await base44.entities.Driver.update(order.driver_id, {
          queue_entered_at: new Date(Date.now() - 31536000000).toISOString(),
        });
      }
      
      const sessionToken = sessionStorage.getItem("local_operator_token");
      base44.functions.invoke("sendPushNotification", {
        action: "cancel_multiple",
        driversToCancel: toCancel,
        orderId: order.id,
        sessionToken
      }).catch(e => console.error("Cancel push error:", e));
    }
    
    queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const orderToDelete = orders.find(o => o.id === id);
      if (orderToDelete) {
        const toCancel = [...new Set([orderToDelete.driver_id, orderToDelete.reserved_driver_id])].filter(Boolean);
        if (orderToDelete.preassigned_driver_id) {
          await base44.entities.Driver.updateMany(
            { id: orderToDelete.preassigned_driver_id, next_order_id: orderToDelete.id },
            { $set: { next_order_id: null, next_order_token: null } }
          ).catch(() => {});
          base44.functions.invoke("sendPushNotification", {
            action: "cancel_multiple",
            driversToCancel: [orderToDelete.preassigned_driver_id],
            orderId: orderToDelete.id,
            sessionToken: sessionStorage.getItem("local_operator_token")
          }).catch(() => {});
        }
        if (toCancel.length > 0) {
          await base44.entities.Driver.updateMany(
            { id: { $in: toCancel }, $or: [{ active_order_id: orderToDelete.id }, { active_ride_id: orderToDelete.id }, { reserved_order_id: orderToDelete.id }] },
            {
              $set: {
                status: "disponible",
                dispatch_status: "normal",
                active_ride_id: null,
                reserved_order_id: null,
                reservation_token: null,
                manual_reservation_token: null,
                driver_reservation_key: null
              }
            }
          ).catch(() => {});
        }
      }
      return base44.entities.RideOrder.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
      navigate("/orders");
    },
  });

  if (!order) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
      await assignDriverToOrder(order, driver, { requireDriverConfirmation: true });
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
    } catch (err) {
      alert(err?.message || "No se pudo asignar el pasaje");
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
    }
  };

  const isDriverWorking = (d) => {
    if (d.status !== "disponible") return false;
    const mobileId = String(d.vehicle_model || "");
    const mobileNumber = parseInt(mobileId, 10);
    const movil = moviles.find(m => m.id === mobileId || m.numero_movil === mobileNumber);
    if (movil && (movil.activo === false || movil.fuera_de_servicio === true)) {
      return false;
    }
    return true;
  };

  const returnToPending = async () => {
    // Si había un conductor asignado o pre-reservado, liberarlo completamente.
    // Primero se limpia el chofer y recién después se reactiva la orden para que
    // nunca vuelva a circular con una reserva/lease de una asignación anterior.
    const toCancel = [...new Set([order.driver_id, order.reserved_driver_id])].filter(Boolean);
    if (order.preassigned_driver_id) {
      await base44.entities.Driver.updateMany(
        { id: order.preassigned_driver_id, next_order_id: order.id },
        { $set: { next_order_id: null, next_order_token: null } }
      ).catch(() => {});
    }
    if (toCancel.length > 0) {
      try {
        await base44.entities.Driver.updateMany(
          { id: { $in: toCancel }, $or: [{ active_order_id: order.id }, { active_ride_id: order.id }, { reserved_order_id: order.id }] },
          {
            $set: {
              status: "disponible",
              dispatch_status: "normal",
              active_order_id: null,
              active_ride_id: null,
              reserved_order_id: null,
              reservation_token: null,
              manual_reservation_token: null,
              driver_reservation_key: null
            }
          }
        );
      } catch (e) {
        console.error("Error liberando conductores", e);
        alert("No se pudo liberar el móvil anterior. El pasaje no fue reactivado.");
        return;
      }
    }

    await updateMutation.mutateAsync({
      id: order.id,
      data: {
        status: "pendiente",
        driver_id: null,
        driver_name: null,
        assigned_base: null,
        reserved_driver_id: null,
        preassigned_driver_id: null,
        preassignment_token: null,
        preassigned_at: null,
        claimed_from_pending: false,
        reservation_token: null,
        manual_reservation_token: null,
        offerExpiresAt: null,
        processingAction: null,
        processingOperationKey: null,
        processingOwnerId: null,
        processingLeaseExpiresAt: null,
        processingPhase: null,
        pendingEffectType: null,
        pendingEffectKey: null,
        pendingEffectStatus: null,
        pendingEffectCorrelationId: null,
        effectOwnerId: null,
        effectLeaseExpiresAt: null
      }
    });
    queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
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
          {order.status === "cancelado" ? (
            <Button
              size="sm"
              className="gap-2 bg-green-600 hover:bg-green-700"
              onClick={returnToPending}
            >
              <RefreshCw className="w-4 h-4" /> Reactivar
            </Button>
          ) : (
            <>
              {order.status !== "pendiente" && order.status !== "completado" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={returnToPending}
                >
                  <RefreshCw className="w-4 h-4" /> Volver a Pendiente
                </Button>
              )}
              {order.status === "completado" && (
                <RideTicket order={order} />
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
                          {d.name} - {d.vehicle_plate}{d.current_base ? ` (${d.current_base})` : ""}
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