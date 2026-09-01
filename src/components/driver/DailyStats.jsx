import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Car, DollarSign, Navigation } from "lucide-react";

export default function DailyStats({ driverId }) {
  const [stats, setStats] = useState({ viajes: 0, km: 0, total: 0 });

  const fetchStats = async () => {
    if (!driverId) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const orders = await base44.entities.RideOrder.filter({
      driver_id: driverId,
      status: "completado",
    });

    const safeOrders = Array.isArray(orders) ? orders : [];
    const todayOrders = safeOrders.filter(o => o.created_date >= todayISO);

    const viajes = todayOrders.length;
    const km = todayOrders.reduce((acc, o) => acc + (o.distancia_teorica_metros || 0), 0) / 1000;
    const total = todayOrders.reduce((acc, o) => acc + (o.importe_real_actual || o.fare || 0), 0);

    setStats({ viajes, km, total });
  };

  useEffect(() => {
    fetchStats();
  }, [driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-4 mt-4 bg-gray-900 rounded-2xl p-4 border border-gray-800">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Resumen de hoy</p>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <Car className="w-4 h-4 text-blue-400 mx-auto mb-1" />
          <p className="text-xl font-black text-white">{stats.viajes}</p>
          <p className="text-xs text-gray-500">Viajes</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <Navigation className="w-4 h-4 text-purple-400 mx-auto mb-1" />
          <p className="text-xl font-black text-white">{stats.km.toFixed(1)}</p>
          <p className="text-xs text-gray-500">Km</p>
        </div>
        <div className="bg-gray-800 rounded-xl p-3 text-center">
          <DollarSign className="w-4 h-4 text-green-400 mx-auto mb-1" />
          <p className="text-xl font-black text-white">${Math.round(stats.total).toLocaleString()}</p>
          <p className="text-xs text-gray-500">Recaudado</p>
        </div>
      </div>
    </div>
  );
}