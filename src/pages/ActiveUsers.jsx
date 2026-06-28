import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Car, Users } from "lucide-react";
import { useEffect, useState } from "react";

export default function ActiveUsers() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const { data: operators = [], isLoading: isLoadingOp } = useQuery({
    queryKey: ["operators_active"],
    queryFn: () => base44.entities.Operator.list(),
    refetchInterval: 15000,
  });

  const { data: drivers = [], isLoading: isLoadingDr } = useQuery({
    queryKey: ["drivers_active"],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: 15000,
  });

  // Filtra usuarios que han reportado actividad en los últimos 3 minutos (180,000 ms)
  const isOnline = (isoString) => {
    if (!isoString) return false;
    return (now - new Date(isoString).getTime()) < 180000;
  };

  const activeOperators = operators.filter(o => isOnline(o.last_active));
  const activeDrivers = drivers.filter(d => isOnline(d.last_active));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-green-500 animate-pulse" />
          Conectados Ahora
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Monitoreo en tiempo real de los usuarios usando el sistema (activos en los últimos 3 minutos).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="bg-muted/30 border-b py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Operadores y Admins ({activeOperators.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {activeOperators.map(op => (
                <li key={op.id} className="p-4 flex items-center justify-between hover:bg-muted/20">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <div>
                      <p className="font-semibold text-sm">{op.name}</p>
                      <p className="text-xs text-muted-foreground uppercase">{op.role}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Activo hace {formatDistanceToNow(new Date(op.last_active), { locale: es })}
                  </span>
                </li>
              ))}
              {activeOperators.length === 0 && !isLoadingOp && (
                <li className="p-8 text-center text-muted-foreground text-sm">Ningún operador conectado.</li>
              )}
              {isLoadingOp && <li className="p-4 text-center text-xs text-muted-foreground">Cargando...</li>}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="w-5 h-5 text-amber-500" />
              Móviles / Choferes ({activeDrivers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {activeDrivers.map(d => (
                <li key={d.id} className="p-4 flex items-center justify-between hover:bg-muted/20">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <div>
                      <p className="font-semibold text-sm">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.vehicle_plate} • {d.status.replace("_", " ")}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Hace {formatDistanceToNow(new Date(d.last_active), { locale: es })}
                  </span>
                </li>
              ))}
              {activeDrivers.length === 0 && !isLoadingDr && (
                <li className="p-8 text-center text-muted-foreground text-sm">Ningún chofer conectado.</li>
              )}
              {isLoadingDr && <li className="p-4 text-center text-xs text-muted-foreground">Cargando...</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}