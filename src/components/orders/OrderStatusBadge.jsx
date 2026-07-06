import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig = {
  pendiente: { label: "Pendiente", className: "bg-amber-100 text-amber-700 border-amber-200" },
  ofrecido: { label: "Ofrecido", className: "bg-blue-100 text-blue-700 border-blue-200" },
  aceptado: { label: "Aceptado", className: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  asignado: { label: "Asignado", className: "bg-blue-100 text-blue-700 border-blue-200" },
  en_camino: { label: "En Camino", className: "bg-purple-100 text-purple-700 border-purple-200" },
  en_viaje: { label: "Con Pasajero", className: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  completado: { label: "Completado", className: "bg-green-100 text-green-700 border-green-200" },
  cancelado: { label: "Cancelado", className: "bg-red-100 text-red-700 border-red-200" },
  rechazado: { label: "Rechazado", className: "bg-rose-100 text-rose-700 border-rose-200" },
};

export default function OrderStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.pendiente;
  return (
    <Badge variant="outline" className={cn("font-medium text-xs", config.className)}>
      {config.label}
    </Badge>
  );
}