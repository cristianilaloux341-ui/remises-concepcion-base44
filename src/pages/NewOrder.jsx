import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "@/components/orders/OrderForm";
import { findBestDriver, findDriverInZone, assignDriverToOrder, broadcastOrder } from "@/lib/dispatchLogic";

export default function NewOrder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Guardamos la asignación manual para hacerla pasar por assignDriverToOrder
      const manualDriverId = data.driver_id;
      const manualDriverName = data.driver_name;
      const manualStatus = data.status;

      if (manualDriverId) {
        data.driver_id = null;
        data.driver_name = null;
      }
      // NUNCA lo creamos como "pendiente" para evitar que el dispatch automático (broadcast) 
      // intercepte el viaje antes de que el servidor lo asigne de forma síncrona.
      data.status = "procesando_despacho";

      // 1. Crear la orden
      const newOrder = await base44.entities.RideOrder.create(data);

      // Lanzamos la lógica de asignación en segundo plano (fire-and-forget)
      // para que no bloquee la interfaz y la creación/redirección sea instantánea.
      (async () => {
        try {
          const [drivers, bases] = await Promise.all([
            base44.entities.Driver.list(),
            base44.entities.Base.list(),
          ]);

          if (manualDriverId) {
            const driver = drivers.find(d => d.id === manualDriverId);
            if (driver) {
              await assignDriverToOrder(newOrder, driver);
            } else {
              await base44.entities.RideOrder.update(newOrder.id, {
                driver_id: manualDriverId,
                driver_name: manualDriverName,
                status: manualStatus,
              });
            }
            return;
          }

          if (newOrder.status === "procesando_despacho" || newOrder.status === "pendiente") {
            if (newOrder.zone) {
              const zoneDriver = findDriverInZone(newOrder.zone, drivers);
              if (zoneDriver) {
                await assignDriverToOrder(newOrder, zoneDriver);
              } else {
                await broadcastOrder(newOrder, drivers);
              }
            } else {
              const bestDriver = await findBestDriver(newOrder, drivers, bases);
              if (bestDriver) {
                await assignDriverToOrder(newOrder, bestDriver);
              } else {
                await broadcastOrder(newOrder, drivers);
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
      <OrderForm onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} />
    </div>
  );
}