import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "@/components/orders/OrderForm";
import { findBestDriver, findDriverInZone, assignDriverToOrder } from "@/lib/dispatchLogic";

export default function NewOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const scheduledRideId = location.state?.scheduled_ride_id;
  const initialData = location.state?.initialData;

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const manualDriverId = data.driver_id;
      const resolvedMobileId = data._resolved_mobile_id || null;
      const orderData = { ...data };
      delete orderData._resolved_mobile_id;

      // La orden nunca nace aceptada. La asignación real pasa por el backend.
      if (manualDriverId) {
        orderData.status = "pendiente";
        delete orderData.driver_id;
        delete orderData.driver_name;
        delete orderData.reserved_driver_id;
      } else {
        orderData.status = "procesando_despacho";
      }

      // 1. Crear la orden sin saltar la validación del chofer
      const newOrder = await base44.entities.RideOrder.create(orderData);

      // Si viene de la agenda, marcamos el pasaje como despachado
      if (scheduledRideId) {
        await base44.entities.ScheduledRide.update(scheduledRideId, {
          status: "despachado",
          order_id: newOrder.id
        }).catch(() => {});
      }

      // La asignación manual se confirma antes de continuar y siempre exige respuesta del chofer.
      if (manualDriverId) {
        const driver = await base44.entities.Driver.get(manualDriverId);
        if (!driver || driver.status !== "disponible") {
          throw new Error("El móvil está fuera de servicio u ocupado. El pasaje quedó pendiente y no fue enviado.");
        }
        await assignDriverToOrder(newOrder, driver, {
          requireDriverConfirmation: true,
          mobileId: resolvedMobileId,
        });
        return newOrder;
      }

      // El despacho automático continúa en segundo plano.
      (async () => {
        try {
          const [drivers, bases] = await Promise.all([
            base44.entities.Driver.list(),
            base44.entities.Base.list(),
          ]);

          if (newOrder.status === "procesando_despacho" || newOrder.status === "pendiente") {
            if (newOrder.zone) {
              const zoneDriver = await findDriverInZone(newOrder.zone, drivers);
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
    onMutate: async () => {
      // No abandonar esta pantalla hasta que el backend confirme la asignación.
      // Así el operador siempre ve el cartel si el móvil está fuera de servicio,
      // ocupado o ya tiene otro viaje activo.
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      return { previous: queryClient.getQueryData(["orders"]) };
    },
    onError: (err, variables, context) => {
      if (context?.previous) queryClient.setQueryData(["orders"], context.previous);
      alert(err?.message || "No se pudo asignar el pasaje");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate("/orders");
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