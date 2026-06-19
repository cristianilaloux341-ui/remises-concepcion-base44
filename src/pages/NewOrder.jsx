import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import OrderForm from "@/components/orders/OrderForm";
import { findBestDriver, findDriverInZone, assignDriverToOrder } from "@/lib/dispatchLogic";

export default function NewOrder() {
  const navigate = useNavigate();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // 1. Crear la orden
      const newOrder = await base44.entities.RideOrder.create(data);

      // 2. Si ya viene con driver asignado desde el formulario, no hacer nada más
      if (newOrder.driver_id) return newOrder;

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
    onSuccess: () => {
      navigate("/orders");
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