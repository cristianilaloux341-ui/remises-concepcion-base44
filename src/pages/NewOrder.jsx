import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "@/components/orders/OrderForm";
import { findBestDriver, findDriverInZone, assignDriverToOrder, broadcastOrder } from "@/lib/dispatchLogic";

export default function NewOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const scheduledRideId = location.state?.scheduled_ride_id;
  const initialData = location.state?.initialData;

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Guardamos la asignación manual para hacerla pasar por assignDriverToOrder
      const manualDriverId = data.driver_id;
      const manualDriverName = data.driver_name;
      const manualStatus = data.status;

      // Si es manual, lo creamos YA con el driver asignado y estado ofrecido/aceptado
      // para que en la interfaz aparezca instantáneamente asignado sin parpadear en "pendiente"
      if (manualDriverId) {
        data.status = manualStatus === "aceptado" ? "aceptado" : "ofrecido";
      } else {
        data.status = "procesando_despacho";
      }

      // 1. Crear la orden
      const newOrder = await base44.entities.RideOrder.create(data);

      // Si viene de la agenda, marcamos el pasaje como despachado
      if (scheduledRideId) {
        await base44.entities.ScheduledRide.update(scheduledRideId, {
          status: "despachado",
          order_id: newOrder.id
        }).catch(() => {});
      }

      // Lanzamos la lógica de asignación en segundo plano (fire-and-forget)
      (async () => {
        try {
          const [drivers, bases] = await Promise.all([
            base44.entities.Driver.list(),
            base44.entities.Base.list(),
          ]);

          if (manualDriverId) {
            const driver = drivers.find(d => d.id === manualDriverId);
            if (driver) {
              // Llamamos a assignDriverToOrder para que dispare la notificación al chofer y la reserva,
              // pero la orden YA se creó visualmente asignada.
              await assignDriverToOrder(newOrder, driver);
            }
            return;
          }

          if (newOrder.status === "procesando_despacho" || newOrder.status === "pendiente") {
            if (newOrder.zone) {
              const zoneDriver = findDriverInZone(newOrder.zone, drivers);
              if (zoneDriver) {
                await assignDriverToOrder(newOrder, zoneDriver);
              } else {
                await base44.entities.RideOrder.update(newOrder.id, { status: "pendiente" });
              }
            } else {
              const bestDriver = await findBestDriver(newOrder, drivers, bases);
              if (bestDriver) {
                await assignDriverToOrder(newOrder, bestDriver);
              } else {
                await base44.entities.RideOrder.update(newOrder.id, { status: "pendiente" });
              }
            }
          }
        } catch (err) {
          console.error("Error en despacho asíncrono:", err);
        }
      })();

      return newOrder;
    },
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      const previous = queryClient.getQueryData(["orders"]);
      queryClient.setQueryData(["orders"], old => {
        if (!old) return [];
        return [{ id: 'temp-' + Date.now(), ...data, created_date: new Date().toISOString() }, ...old];
      });
      navigate("/orders");
      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) queryClient.setQueryData(["orders"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Button variant="ghost" className="gap-2" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" />
        Volver
      </Button>
      <OrderForm order={initialData} onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} onCancel={() => navigate(-1)} />
    </div>
  );
}