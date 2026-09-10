import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "@/components/orders/OrderForm";
import { assignDriverToOrder } from "@/lib/dispatchLogic";
import { useAuth } from "@/lib/AuthContext";
import { getEffectiveRole } from "@/lib/permissions";

export default function NewOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManualAssign = ["admin", "supervisor", "operador"].includes(getEffectiveRole(user));

  const scheduledRideId = location.state?.scheduled_ride_id;
  const initialData = location.state?.initialData;

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const manualDriverId = canManualAssign ? data.driver_id : null;
      const resolvedMobileId = data._resolved_mobile_id || null;
      const orderData = { ...data };
      delete orderData._resolved_mobile_id;

      // La asignación manual conserva el flujo actual y exige confirmación del chofer.
      if (manualDriverId) {
        orderData.status = "pendiente";
        delete orderData.driver_id;
        delete orderData.driver_name;
        delete orderData.reserved_driver_id;

        const newOrder = await base44.entities.RideOrder.create(orderData);

        if (scheduledRideId) {
          await base44.entities.ScheduledRide.update(scheduledRideId, {
            status: "despachado",
            order_id: newOrder.id
          }).catch(() => {});
        }

        const driver = await base44.entities.Driver.get(manualDriverId);
        if (!driver || driver.status !== "disponible") {
          throw new Error("El móvil está fuera de servicio u ocupado. El pasaje quedó pendiente y no fue enviado.");
        }
        await assignDriverToOrder(newOrder, driver, {
          requireDriverConfirmation: true,
          forceManual: true,
          mobileId: resolvedMobileId,
        });
        return newOrder;
      }

      // Despacho automático unificado en servidor: crear + buscar móvil de la zona +
      // ofrecer. Se elimina Driver.list/Movil.list/Driver.get desde el navegador.
      orderData.status = "procesando_despacho";
      delete orderData.driver_id;
      delete orderData.driver_name;
      delete orderData.reserved_driver_id;

      const sessionToken = sessionStorage.getItem("local_operator_token") || "client_demo_token";
      const dispatchRes = await base44.functions.invoke("clientCreateAndDispatchRide", {
        orderData,
        sessionToken
      });

      if (!dispatchRes.data?.success || !dispatchRes.data?.orderId) {
        throw new Error(dispatchRes.data?.error || "No se pudo crear/despachar el pasaje");
      }

      const newOrder = {
        ...orderData,
        id: dispatchRes.data.orderId,
        status: dispatchRes.data.status || (dispatchRes.data.assigned ? "ofrecido" : "pendiente")
      };

      if (scheduledRideId) {
        await base44.entities.ScheduledRide.update(scheduledRideId, {
          status: "despachado",
          order_id: newOrder.id
        }).catch(() => {});
      }

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
      <OrderForm order={initialData} onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} onCancel={() => navigate(-1)} allowManualAssignment={canManualAssign} />
    </div>
  );
}