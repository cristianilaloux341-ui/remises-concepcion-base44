import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Clock, MapPin, X, ListChecks, CheckCircle2 } from "lucide-react";

const formatWait = (createdDate) => {
  const ms = Date.now() - new Date(createdDate || Date.now()).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return minutes < 1 ? "Recién ingresado" : `Hace ${minutes} min`;
};

export default function PendingRidesOverlay({
  orders = [],
  driver,
  asNext = false,
  onClose,
  onClaimed
}) {
  const [claimingId, setClaimingId] = useState(null);
  const [message, setMessage] = useState("");

  const pending = useMemo(
    () => orders
      .filter(order =>
        order?.status === "pendiente" &&
        !order.driver_id &&
        !order.reserved_driver_id &&
        !order.preassigned_driver_id
      )
      .sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0)),
    [orders]
  );

  const nextOrder = useMemo(
    () => orders.find(order =>
      order?.id === driver?.next_order_id &&
      order?.status === "preasignado_proximo" &&
      order?.preassigned_driver_id === driver?.id
    ),
    [orders, driver?.next_order_id, driver?.id]
  );

  const claim = async (order) => {
    if (!driver?.id || claimingId || driver.next_order_id) return;
    setClaimingId(order.id);
    setMessage("");
    try {
      const response = await base44.functions.invoke("claimNextRide", {
        action: "claim",
        orderId: order.id,
        driverId: driver.id,
        asNext,
        sessionToken:
          sessionStorage.getItem("driver_session_token") ||
          localStorage.getItem("driver_session_token") ||
          sessionStorage.getItem("session_token") ||
          localStorage.getItem("session_token") ||
          ""
      });
      if (response.data?.success) {
        setMessage(response.data.mode === "next"
          ? "Quedó guardado como tu próximo viaje."
          : "El pasaje quedó asignado a tu móvil.");
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        onClaimed?.(response.data);
      } else {
        const reason = response.data?.reason;
        setMessage(
          reason === "already_taken" ? "Otro móvil acaba de tomar este pasaje." :
          reason === "driver_already_has_next" ? "Ya tenés un próximo viaje asignado." :
          reason === "driver_off_service" ? "Tenés que estar en servicio para tomarlo." :
          "No se pudo tomar el pasaje. Actualizá e intentá nuevamente."
        );
      }
    } catch (error) {
      setMessage("No se pudo conectar con la Central.");
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[10002] bg-gray-950 flex flex-col max-w-md mx-auto">
      <div className="px-4 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-white text-xl font-black flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-orange-400" />
            Pasajes pendientes
          </h2>
          <p className="text-gray-400 text-xs mt-1">El primero que lo toma se lo queda.</p>
        </div>
        <button onClick={onClose} className="p-3 rounded-xl bg-gray-800 text-white" aria-label="Cerrar pendientes">
          <X className="w-6 h-6" />
        </button>
      </div>

      {nextOrder && (
        <div className="m-4 p-4 rounded-2xl border border-green-500/50 bg-green-500/10">
          <p className="text-green-400 font-black flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" /> Tu próximo viaje
          </p>
          <p className="text-white font-bold mt-2">{nextOrder.pickup_address}</p>
          <p className="text-gray-400 text-sm">{nextOrder.zone || "Sin zona"}</p>
          <p className="text-xs text-green-300 mt-2">Confirmado. Solo puede cancelarlo la Central o el cliente.</p>
        </div>
      )}

      {message && (
        <div className="mx-4 mt-3 rounded-xl bg-blue-500/15 border border-blue-500/30 p-3 text-blue-200 text-sm font-semibold">
          {message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {driver?.next_order_id && !nextOrder && (
          <div className="rounded-2xl bg-gray-900 border border-gray-800 p-4 text-gray-300">
            Ya tenés un próximo viaje reservado. Sincronizando información…
          </div>
        )}

        {!driver?.next_order_id && pending.map(order => (
          <div key={order.id} className="rounded-2xl bg-gray-900 border border-gray-800 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-orange-400 text-xs font-black uppercase">{order.zone || "Sin zona"}</p>
                <p className="text-white font-bold text-lg mt-1 break-words">{order.pickup_address}</p>
                {order.dropoff_address && (
                  <p className="text-gray-400 text-sm mt-1 break-words">Destino: {order.dropoff_address}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {formatWait(order.created_date)}
              </span>
            </div>

            <button
              disabled={!!claimingId}
              onClick={() => claim(order)}
              className="mt-4 w-full h-14 rounded-2xl bg-orange-500 text-gray-950 font-black text-lg disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
            >
              <MapPin className="w-5 h-5" />
              {claimingId === order.id ? "Tomando…" : asNext ? "Tomar como próximo" : "Tomar pasaje"}
            </button>
          </div>
        ))}

        {!driver?.next_order_id && pending.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 px-8">
            <ListChecks className="w-14 h-14 mb-3 opacity-40" />
            <p className="font-bold text-lg">No hay pasajes pendientes</p>
            <p className="text-sm mt-1">La lista se actualiza automáticamente.</p>
          </div>
        )}
      </div>
    </div>
  );
}
