import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getBaseQueue, BASES } from "@/lib/dispatchLogic";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowUp, ArrowDown, XCircle, Plus, Clock, Settings } from "lucide-react";

const BASE_COLORS = {
  "1-Puerto": "bg-blue-500", "2-Plaza": "bg-green-500", "3-Columna": "bg-purple-500",
  "4-Base": "bg-yellow-500", "5-Cementerio": "bg-gray-500", "6-Díaz Vélez": "bg-pink-500",
  "7-Don Bosco": "bg-orange-500", "8-Monumento": "bg-cyan-500",
};

function QueueEditor({ baseName, queue, drivers, onClose, movilByPlate = {} }) {
  const queryClient = useQueryClient();
  const [addingDriver, setAddingDriver] = useState("");

  const notInQueue = drivers.filter(d =>
    d.status !== "en_viaje" && !queue.find(q => q.id === d.id)
  );

  const moveMutation = useMutation({
    mutationFn: async ({ driver, newPosition }) => {
      // Recalculate queue_entered_at to reflect new position
      const currentQueue = [...queue];
      const idx = currentQueue.findIndex(d => d.id === driver.id);
      if (idx === -1) return;
      currentQueue.splice(idx, 1);
      currentQueue.splice(newPosition, 0, driver);

      // Reassign timestamps to maintain order
      const baseTime = new Date();
      await Promise.all(
        currentQueue.map((d, i) =>
          base44.entities.Driver.update(d.id, {
            queue_entered_at: new Date(baseTime.getTime() + i * 1000).toISOString(),
          })
        )
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (driver) => base44.entities.Driver.update(driver.id, {
      current_base: null, status: "no_disponible", queue_entered_at: null,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const addMutation = useMutation({
    mutationFn: (driverId) => {
      const existingCount = queue.length;
      return base44.entities.Driver.update(driverId, {
        current_base: baseName,
        status: "disponible",
        queue_entered_at: new Date(Date.now() + existingCount * 1000).toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setAddingDriver("");
    }
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Modificá el orden de la cola en <strong>{baseName}</strong>. Los cambios se aplican inmediatamente.
      </p>

      <div className="space-y-2">
        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Cola vacía</p>
        ) : queue.map((driver, idx) => {
          const nroMovil = movilByPlate[driver.vehicle_plate?.toUpperCase()];
          return (
          <div key={driver.id} className="flex items-center gap-2 p-3 bg-muted/50 rounded-xl">
            <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {nroMovil && <span className="text-primary font-bold mr-1">#{nroMovil}</span>}
                {driver.name}
              </p>
            </div>
            {driver.queue_entered_at && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(driver.queue_entered_at), { locale: es })}
              </span>
            )}
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7"
                disabled={idx === 0 || moveMutation.isPending}
                onClick={() => moveMutation.mutate({ driver, newPosition: idx - 1 })}>
                <ArrowUp className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7"
                disabled={idx === queue.length - 1 || moveMutation.isPending}
                onClick={() => moveMutation.mutate({ driver, newPosition: idx + 1 })}>
                <ArrowDown className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                onClick={() => removeMutation.mutate(driver)}>
                <XCircle className="w-3 h-3" />
              </Button>
            </div>
          </div>
          );
        })}
      </div>

      {notInQueue.length > 0 && (
        <div className="flex gap-2">
          <Select value={addingDriver} onValueChange={setAddingDriver}>
            <SelectTrigger className="flex-1 h-9 rounded-xl text-xs">
              <SelectValue placeholder="Agregar móvil a la cola..." />
            </SelectTrigger>
            <SelectContent>
              {notInQueue.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name} — {d.vehicle_plate}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-1 rounded-xl px-4"
            disabled={!addingDriver || addMutation.isPending}
            onClick={() => addMutation.mutate(addingDriver)}>
            <Plus className="w-3 h-3" /> Agregar
          </Button>
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={onClose}>Cerrar</Button>
    </div>
  );
}

export default function BaseQueueManager({ drivers, moviles = [] }) {
  // Mapa patente → número de móvil para lookup rápido
  const movilByPlate = Object.fromEntries(moviles.map(m => [m.dominio?.toUpperCase(), m.numero_movil]));
  const [editingBase, setEditingBase] = useState(null);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {BASES.map(baseName => {
          const queue = getBaseQueue(drivers, baseName);
          const color = BASE_COLORS[baseName] || "bg-primary";
          return (
            <Card key={baseName} className="overflow-hidden">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${color}`} />
                    <CardTitle className="text-sm font-semibold">{baseName}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs">{queue.length}</Badge>
                    <Button size="icon" variant="ghost" className="h-6 w-6"
                      onClick={() => setEditingBase(baseName)}>
                      <Settings className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                {queue.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">Vacía</p>
                ) : queue.slice(0, 4).map((driver, idx) => {
                  const nroMovil = movilByPlate[driver.vehicle_plate?.toUpperCase()];
                  return (
                    <div key={driver.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/50">
                      <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">
                          {nroMovil && <span className="text-primary font-bold mr-1">#{nroMovil}</span>}
                          {driver.name}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {queue.length > 4 && (
                  <p className="text-xs text-muted-foreground text-center">+{queue.length - 4} más</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editingBase} onOpenChange={(o) => { if (!o) setEditingBase(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cola de Base — {editingBase}</DialogTitle>
          </DialogHeader>
          {editingBase && (
            <QueueEditor
              baseName={editingBase}
              queue={getBaseQueue(drivers, editingBase)}
              drivers={drivers}
              onClose={() => setEditingBase(null)}
              movilByPlate={movilByPlate}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}