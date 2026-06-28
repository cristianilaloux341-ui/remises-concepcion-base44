import { Card } from "@/components/ui/card";
import { MapPin, Phone, User, Clock, Trash2 } from "lucide-react";
import OrderStatusBadge from "./OrderStatusBadge";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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
            <p className="font-semibold text-sm">{order.client_name}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
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
          {format(new Date(order.created_date), "HH:mm · dd MMM", { locale: es })}
        </div>
        {order.fare && (
          <span className="font-bold text-sm">${order.fare.toLocaleString()}</span>
        )}
        {order.driver_name && (
          <span className="text-xs text-muted-foreground">🚗 {order.driver_name}</span>
        )}
      </div>
    </Card>
  );
}