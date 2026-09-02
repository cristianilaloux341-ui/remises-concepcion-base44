import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { X, TrendingUp, DollarSign, Car, Download, Calendar, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startOfDay, startOfWeek, startOfMonth, endOfDay, endOfWeek, endOfMonth, format, subDays } from "date-fns";
import { es } from "date-fns/locale";

function computeStats(orders, from, to) {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const inRange = safeOrders.filter(o => {
    const d = new Date(o.created_date);
    return d >= from && d <= to && o.status === "completado";
  });
  const total = inRange.reduce((acc, o) => acc + (o.importe_real_actual || o.fare || 0), 0);
  return { count: inRange.length, total: Math.round(total), orders: inRange };
}

const money = value => Math.round(Number(value) || 0).toLocaleString("es-AR");
const safeFilePart = value => String(value || "viaje").replace(/[^a-zA-Z0-9_-]+/g, "_");

function TicketModal({ order, driverName, onClose }) {
  if (!order) return null;
  const importe = order.importe_real_actual || order.fare || order.importe_final || 0;
  const esOcasional = order.client_name === "Viaje Ocasional (Calle)" || order.pickup_address === "Viaje en calle";
  const metros = Number(order.metros_taximetro || order.distancia_teorica_metros || 0);
  const espera = Number(order.segundos_espera_acumulados || 0);

  const handleDownloadTicket = () => {
    const fecha = format(new Date(order.created_date), "dd/MM/yyyy HH:mm");
    const lines = [
      "REMISES CONCEPCION",
      "COMPROBANTE DE VIAJE",
      "------------------------------",
      `Fecha: ${fecha}`,
      `Chofer: ${order.driver_name || driverName || ""}`,
      `Pasajero: ${order.client_name || ""}`,
      `Origen: ${order.pickup_address || ""}`,
      order.dropoff_address ? `Destino: ${order.dropoff_address}` : null,
      metros > 0 ? `Distancia: ${(metros / 1000).toFixed(2)} km` : null,
      espera > 0 ? `Espera: ${espera} s` : null,
      "------------------------------",
      `TOTAL: $${money(importe)}`,
      esOcasional ? "Viaje ocasional" : "Viaje solicitado",
      `ID: ${order.id || ""}`,
    ].filter(Boolean);
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ticket_${format(new Date(order.created_date), "yyyyMMdd_HHmm")}_${safeFilePart(order.id)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4" style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
      <div className="relative w-full max-w-sm max-h-full overflow-y-auto bg-white text-gray-900 rounded-2xl shadow-2xl p-5">
        <button
          onClick={onClose}
          aria-label="Cerrar ticket"
          className="sticky top-0 float-right z-10 w-11 h-11 -mt-1 -mr-1 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center pt-1 pb-4 border-b border-dashed border-gray-300 clear-none">
          <p className="text-lg font-black">REMISES CONCEPCIÓN</p>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Comprobante de viaje</p>
        </div>

        <div className="py-4 space-y-2 text-sm clear-both">
          <div className="flex justify-between gap-3"><span className="text-gray-500">Fecha</span><span className="font-semibold text-right">{format(new Date(order.created_date), "dd/MM/yyyy HH:mm")}</span></div>
          <div className="flex justify-between gap-3"><span className="text-gray-500">Chofer</span><span className="font-semibold text-right">{order.driver_name || driverName}</span></div>
          <div className="flex justify-between gap-3"><span className="text-gray-500">Pasajero</span><span className="font-semibold text-right">{order.client_name || "-"}</span></div>
          <div className="pt-2 border-t border-dashed border-gray-200">
            <p className="text-xs text-gray-500">Origen</p>
            <p className="font-semibold break-words">{order.pickup_address || "-"}</p>
          </div>
          {order.dropoff_address && <div><p className="text-xs text-gray-500">Destino</p><p className="font-semibold break-words">{order.dropoff_address}</p></div>}
          {metros > 0 && <div className="flex justify-between"><span className="text-gray-500">Distancia</span><span className="font-semibold">{(metros / 1000).toFixed(2)} km</span></div>}
          {espera > 0 && <div className="flex justify-between"><span className="text-gray-500">Espera</span><span className="font-semibold">{espera} s</span></div>}
          {esOcasional && <p className="text-xs font-bold text-blue-700 text-center pt-1">VIAJE OCASIONAL</p>}
        </div>

        <div className="border-t-2 border-dashed border-gray-300 pt-4 flex items-end justify-between gap-3">
          <span className="font-bold">TOTAL</span>
          <span className="text-3xl font-black text-green-600">${money(importe)}</span>
        </div>

        <Button onClick={handleDownloadTicket} className="w-full mt-5 h-12 rounded-xl gap-2 font-bold">
          <Download className="w-4 h-4" /> Descargar ticket
        </Button>
      </div>
    </div>
  );
}

export default function DriverStats({ driverId, driverName, onClose }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dia");
  const [ticketOrder, setTicketOrder] = useState(null);

  useEffect(() => {
    setLoading(true);
    const since = subDays(new Date(), 90).toISOString();
    void since;
    base44.entities.RideOrder.filter({ driver_id: driverId, status: "completado" })
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [driverId]);

  const now = new Date();
  const statsDia = computeStats(orders, startOfDay(now), endOfDay(now));
  const statsSemana = computeStats(orders, startOfWeek(now, { weekStartsOn: 1 }), endOfWeek(now, { weekStartsOn: 1 }));
  const statsMes = computeStats(orders, startOfMonth(now), endOfMonth(now));
  const activeStats = tab === "dia" ? statsDia : tab === "semana" ? statsSemana : statsMes;
  const tabLabel = tab === "dia" ? "hoy" : tab === "semana" ? "esta semana" : "este mes";

  const handleDownload = () => {
    const rows = [
      ["Fecha", "Cliente", "Origen", "Destino", "Importe"],
      ...activeStats.orders.map(o => [
        format(new Date(o.created_date), "dd/MM/yyyy HH:mm"),
        o.client_name || "",
        o.pickup_address || "",
        o.dropoff_address || "",
        (o.importe_real_actual || o.fare || 0).toString(),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `viajes_${tab}_${driverName.replace(/\s+/g, "_")}_${format(now, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 flex flex-col" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-blue-400" />
          <div><p className="font-bold text-white text-sm">Mis Estadísticas</p><p className="text-xs text-gray-400">{driverName}</p></div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl bg-gray-800 text-gray-400"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex px-5 pt-4 gap-2 shrink-0">
        {[{ id: "dia", label: "Hoy" }, { id: "semana", label: "Semana" }, { id: "mes", label: "Mes" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === t.id ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800"><div className="flex items-center gap-2 mb-2"><Car className="w-4 h-4 text-blue-400" /><p className="text-xs text-gray-400 font-medium uppercase">Viajes</p></div><p className="text-4xl font-black text-white">{activeStats.count}</p><p className="text-xs text-gray-500 mt-1">{tabLabel}</p></div>
            <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800"><div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-green-400" /><p className="text-xs text-gray-400 font-medium uppercase">Recaudación</p></div><p className="text-3xl font-black text-green-400">${activeStats.total.toLocaleString()}</p><p className="text-xs text-gray-500 mt-1">{tabLabel}</p></div>
          </div>

          {activeStats.count > 0 && <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800 flex items-center justify-between"><p className="text-sm text-gray-400">Promedio por viaje</p><p className="text-xl font-bold text-white">${Math.round(activeStats.total / activeStats.count).toLocaleString()}</p></div>}

          {activeStats.count > 0 && <Button onClick={handleDownload} variant="outline" className="w-full rounded-2xl border-gray-700 text-gray-300 hover:bg-gray-800 gap-2"><Download className="w-4 h-4" />Descargar CSV — {activeStats.count} viajes</Button>}

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Detalle de viajes</p>
            {activeStats.orders.length === 0 ? (
              <div className="bg-gray-900 rounded-2xl p-6 text-center"><p className="text-gray-500 text-sm">Sin viajes completados {tabLabel}</p></div>
            ) : (
              [...activeStats.orders].sort((a, b) => new Date(b.created_date) - new Date(a.created_date)).map(o => (
                <div key={o.id} className="bg-gray-900 rounded-2xl p-4 border border-gray-800 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500">{format(new Date(o.created_date), "dd/MM HH:mm", { locale: es })}</p>
                      <p className="text-sm text-gray-300 truncate">{o.pickup_address}</p>
                      {o.dropoff_address && <p className="text-xs text-gray-500 truncate">→ {o.dropoff_address}</p>}
                    </div>
                    <p className="text-lg font-bold text-green-400 shrink-0">${(o.importe_real_actual || o.fare || 0).toLocaleString()}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-600 truncate">{o.client_name}</p>
                    <button onClick={() => setTicketOrder(o)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-xs font-bold active:scale-95">
                      <Receipt className="w-4 h-4" /> Ticket
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {ticketOrder && <TicketModal order={ticketOrder} driverName={driverName} onClose={() => setTicketOrder(null)} />}
    </div>
  );
}
