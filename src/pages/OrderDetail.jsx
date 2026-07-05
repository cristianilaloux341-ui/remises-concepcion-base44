import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useRealtimeOrders, useRealtimeDrivers } from "@/lib/useRealtimeOrders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Phone, MapPin, User, DollarSign, Trash2, Loader2, XCircle, RefreshCw } from "lucide-react";
import OrderStatusBadge from "@/components/orders/OrderStatusBadge";
import RideMap from "@/components/map/RideMap";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function OrderDetail() {
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
    await base44.entities.RideOrder.update(order.id, { status: "cancelado" });
    if (order.driver_id && ["aceptado", "en_camino", "en_viaje", "ofrecido"].includes(order.status)) {
      // Set queue_entered_at far in the past so driver appears first
      await base44.entities.Driver.update(order.driver_id, {
        status: "disponible",
        queue_entered_at: new Date("2000-01-01").toISOString(),
      });
    }
    queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.RideOrder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
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

  const handleStatusChange = (status) => {
    updateMutation.mutate({ id: order.id, data: { status } });
  };

  const handleAssignDriver = (driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    updateMutation.mutate({
      id: order.id,
      data: {
        driver_id: driverId,
        driver_name: driver?.name || "",
        status: "ofrecido",
        offered_driver_ids: [...(order.offered_driver_ids || []), driverId],
      },
    });
  };

  const availableDrivers = drivers.filter(d => d.status === "disponible" || d.id === order?.driver_id);

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
              onClick={() => updateMutation.mutate({ id: order.id, data: { status: "pendiente" } })}
            >
              <RefreshCw className="w-4 h-4" /> Reactivar
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-red-200 text-red-600 hover:bg-red-50"
              onClick={cancelOrder}
            >
              <XCircle className="w-4 h-4" /> Cancelar
            </Button>
          )}
          {(() => {
            try {
              const op = JSON.parse(sessionStorage.getItem("local_operator") || "null");
              if (op?.rol === "Administrador General" || op?.role === "admin" || op?.rol === "admin") {
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
                <span className="font-bold text-lg">${order.fare.toLocaleString()}</span>
              </div>
            )}

            {order.notes && (
              <div className="p-3 bg-muted rounded-xl">
                <p className="text-xs text-muted-foreground mb-1">NOTAS</p>
                <p className="text-sm">{order.notes}</p>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Creado: {format(new Date(order.created_date), "dd MMM yyyy · HH:mm", { locale: es })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acciones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Cambiar Estado</label>
                <Select value={order.status} onValueChange={handleStatusChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                    <SelectItem value="ofrecido">Ofrecido</SelectItem>
                    <SelectItem value="aceptado">Aceptado</SelectItem>
                    <SelectItem value="en_camino">En Camino</SelectItem>
                    <SelectItem value="en_viaje">En Viaje</SelectItem>
                    <SelectItem value="completado">Completado</SelectItem>
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {order.driver_id ? "Reasignar Conductor" : "Asignar Conductor"}
                </label>
                <Select value={order.driver_id || ""} onValueChange={handleAssignDriver}>
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