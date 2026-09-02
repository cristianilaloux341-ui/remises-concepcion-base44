import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { MapPin, Phone, User, Clock, Trash2 } from "lucide-react";
import OrderStatusBadge from "./OrderStatusBadge";
import { formatTimeBA } from "@/lib/utils";

function OfferCountdown({ order }) {
  const [seconds, setSeconds] = useState(null);

  useEffect(() => {
    if (order.status !== "ofrecido") {
      setSeconds(null);
      return;
    }

    const explicitExpiry = Number(order.offerExpiresAt);
    const assignedMs = order.assigned_at ? new Date(order.assigned_at).getTime() : NaN;
    const updatedMs = order.updated_date ? new Date(order.updated_date).getTime() : NaN;
    const createdMs = order.created_date ? new Date(order.created_date).getTime() : NaN;
    const baseMs = Number.isFinite(assignedMs) ? assignedMs : (Number.isFinite(updatedMs) ? updatedMs : createdMs);
    const expiresMs = order.offerExpiresAt != null && Number.isFinite(explicitExpiry)
      ? explicitExpiry
      : baseMs + 30000;

    if (!Number.isFinite(expiresMs)) {
      setSeconds(null);
      return;
    }

    const tick = () => setSeconds(Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [order.status, order.offerExpiresAt, order.assigned_at, order.updated_date, order.created_date, order.assignment_attempt]);

  if (seconds == null) return null;
  return (
    <span className={`font-mono text-xs font-black px-2 py-1 rounded-md ${seconds <= 10 ? "bg-red-600 text-white animate-pulse" : "bg-amber-400 text-black"}`}>
      ⏱ {String(seconds).padStart(2, "0")}s
    </span>
  );
}

export default function OrderCard({ order, onClick, isAdmin, onDelete }) {
  return (
    <Card
      className="p-4 cursor-pointer hover:shadow-md transition-all duration-200 hover:border-primary/30"
      onClick={() => onClick?.(order)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="font-bold text-black text-sm">{order.client_name}</p>
            <p className="font-bold text-black text-xs flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {order.client_phone}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.();
              }}
              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Eliminar viaje"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <OfferCountdown order={order} />
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center mt-0.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-green-500" />
          </div>
          <span className="text-muted-foreground line-clamp-1">{order.pickup_address}</span>
        </div>
        {order.dropoff_address && (
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center mt-0.5 shrink-0">
              <MapPin className="w-3 h-3 text-red-500" />
            </div>
            <span className="text-muted-foreground line-clamp-1">{order.dropoff_address}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {formatTimeBA(order.created_date, "short")}
        </div>
        {order.fare && (
          <span className="font-bold text-sm">${order.fare.toLocaleString()}</span>
        )}
        {order.driver_name && (
          <span className="text-sm font-extrabold text-black bg-gray-100 px-2 py-1 rounded-md border border-gray-300">🚗 {order.driver_name}</span>
        )}
      </div>
    </Card>
  );
}