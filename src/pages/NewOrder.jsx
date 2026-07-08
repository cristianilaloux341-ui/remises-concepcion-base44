import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "@/components/orders/OrderForm";
import { findBestDriver, findDriverInZone, assignDriverToOrder } from "@/lib/dispatchLogic";

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
        data.status = "pendiente";
      }

      // 1. Crear la orden
      const newOrder = await base44.entities.RideOrder.create(data);

      const [drivers, bases] = await Promise.all([
        base44.entities.Driver.list(),
        base44.entities.Base.list(),
      ]);

      // 2. Si ya viene con driver asignado desde el formulario, asignarlo pasando por dispatch logic (para empujar a los salteados y enviar push)
      if (manualDriverId) {
        const driver = drivers.find(d => d.id === manualDriverId);
        if (driver) {
          await assignDriverToOrder(newOrder, driver);
        } else {
          // Asignación manual sin entidad de chofer real (forzada)
          await base44.entities.RideOrder.update(newOrder.id, {
            driver_id: manualDriverId,
            driver_name: manualDriverName,
            status: manualStatus,
          });
        }
        return newOrder;
      }

      // 3. Auto-despacho: prioridad 1 = misma zona, prioridad 2 = proximidad (sin zona)
      if (newOrder.status === "pendiente") {
        const [drivers, bases] = await Promise.all([
          base44.entities.Driver.list(),
          base44.entities.Base.list(),
        ]);

        if (newOrder.zone) {
          // Zona definida → buscar chofer libre en ESA zona (FIFO)
          const zoneDriver = findDriverInZone(newOrder.zone, drivers);
          if (zoneDriver) {
            await assignDriverToOrder(newOrder, zoneDriver);
          }
          // Si no hay nadie en la zona → queda en "pendiente" → broadcast automático vía real-time
        } else {
          // Sin zona → fallback por proximidad
          const bestDriver = await findBestDriver(newOrder, drivers, bases);
          if (bestDriver) await assignDriverToOrder(newOrder, bestDriver);
        }
      }

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