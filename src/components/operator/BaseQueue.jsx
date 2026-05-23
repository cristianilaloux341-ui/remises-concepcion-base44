import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Clock } from "lucide-react";
import { getBaseQueue } from "@/lib/dispatchLogic";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const BASE_COLORS = {
  Puerto: "bg-blue-500",
  Plaza: "bg-green-500",
  Columna: "bg-purple-500",
  Cementerio: "bg-gray-500",
  "Don Bosco": "bg-orange-500",
  "Díaz Vélez": "bg-pink-500",
  Monumento: "bg-cyan-500",
};

export default function BaseQueue({ baseName, drivers, onDriverClick }) {
  const queue = getBaseQueue(drivers, baseName);
  const color = BASE_COLORS[baseName] || "bg-primary";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <CardTitle className="text-sm font-semibold">{baseName}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">{queue.length} en cola</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {queue.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">Sin chóferes en espera</p>
        ) : (
          queue.map((driver, idx) => (
            <div
              key={driver.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
              onClick={() => onDriverClick?.(driver)}
            >
              <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{driver.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{driver.vehicle_plate}</p>
              </div>
              {driver.queue_entered_at && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatDistanceToNow(new Date(driver.queue_entered_at), { locale: es, addSuffix: false })}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}