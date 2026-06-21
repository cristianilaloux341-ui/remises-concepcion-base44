import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { startOfDay, startOfWeek, startOfMonth, startOfYear, isAfter } from "date-fns";
import { es } from "date-fns/locale";
import { Car, TrendingUp, Calendar } from "lucide-react";

const PERIODS = [
  { key: "dia", label: "Hoy" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "año", label: "Año" },
  { key: "total", label: "Total" },
];

function getPeriodStart(key) {
  const now = new Date();
  if (key === "dia") return startOfDay(now);
  if (key === "semana") return startOfWeek(now, { locale: es });
  if (key === "mes") return startOfMonth(now);
  if (key === "año") return startOfYear(now);
  return null; // total
}

export default function ClientTripStats({ clientId, clientName }) {
  const [period, setPeriod] = useState("mes");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["client-orders", clientId],
    queryFn: () => base44.entities.RideOrder.filter({ client_id: clientId }, "-created_date", 500),
    enabled: !!clientId,
  });

  const completedOrders = orders.filter(o => o.status === "completado");
  const cancelledOrders = orders.filter(o => o.status === "cancelado");

  const filterByPeriod = (list) => {
    const start = getPeriodStart(period);
    if (!start) return list;
    return list.filter(o => isAfter(new Date(o.created_date), start));
  };

  const periodCompleted = filterByPeriod(completedOrders);
  const periodCancelled = filterByPeriod(cancelledOrders);
  const periodTotal = filterByPeriod(orders);

  const totalFare = periodCompleted.reduce((sum, o) => sum + (o.importe_real_actual || o.fare || 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex gap-1 bg-muted p-1 rounded-xl">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-all ${
              period === p.key
                ? "bg-white shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stats del período */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-black text-blue-700">{periodCompleted.length}</p>
          <p className="text-xs text-blue-500 font-medium mt-1 flex items-center justify-center gap-1">
            <Car className="w-3 h-3" /> Viajes completados
          </p>
        </div>
        <div className={`rounded-xl p-4 text-center ${periodCancelled.length > 0 ? "bg-red-50" : "bg-muted"}`}>
          <p className={`text-3xl font-black ${periodCancelled.length > 0 ? "text-red-600" : "text-foreground"}`}>
            {periodCancelled.length}
          </p>
          <p className="text-xs text-muted-foreground font-medium mt-1">Cancelados</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 text-center">
          <p className="text-3xl font-black text-green-700">
            ${Math.round(totalFare).toLocaleString()}
          </p>
          <p className="text-xs text-green-600 font-medium mt-1 flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3" /> Total facturado
          </p>
        </div>
        <div className="bg-muted rounded-xl p-4 text-center">
          <p className="text-3xl font-black text-foreground">{periodTotal.length}</p>
          <p className="text-xs text-muted-foreground font-medium mt-1">Pedidos totales</p>
        </div>
      </div>

      {/* Últimos viajes */}
      {periodCompleted.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Últimos viajes del período
          </p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {periodCompleted.slice(0, 10).map(o => (
              <div key={o.id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{o.pickup_address}</p>
                  {o.dropoff_address && (
                    <p className="text-muted-foreground truncate">→ {o.dropoff_address}</p>
                  )}
                </div>
                <div className="text-right shrink-0 ml-2">
                  {(o.importe_real_actual || o.fare) > 0 && (
                    <p className="font-bold text-green-700">${Math.round(o.importe_real_actual || o.fare).toLocaleString()}</p>
                  )}
                  <p className="text-muted-foreground">{new Date(o.created_date).toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {periodCompleted.length === 0 && (
        <div className="text-center py-6 text-muted-foreground text-sm">
          Sin viajes completados en este período
        </div>
      )}
    </div>
  );
}