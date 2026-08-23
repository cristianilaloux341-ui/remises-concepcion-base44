import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DraggableModal from "@/components/ui/draggable-modal";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { GripVertical } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getBaseQueue, BASES } from "@/lib/dispatchLogic";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowUp, ArrowDown, XCircle, Plus, Clock, Settings, Zap } from "lucide-react";
import { getDriverDisplay } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

export function ConnectivityIndicator({ lastActive }) {
  const [dot, setDot] = useState({ color: 'bg-gray-400', label: '' });

  useEffect(() => {
    const update = () => {
      if (!lastActive) {
        setDot({ color: 'bg-red-500', label: '' });
        return;
      }
      const diffSecs = Math.floor((Date.now() - new Date(lastActive).getTime()) / 1000);
      if (diffSecs < 20) {
        setDot({ color: 'bg-green-500', label: '' });
      } else if (diffSecs <= 60) {
        setDot({ color: 'bg-yellow-500', label: `${diffSecs}s` });
      } else {
        const mins = Math.floor(diffSecs / 60);
        const secs = diffSecs % 60;
        setDot({ color: 'bg-red-500', label: `${mins}m ${secs}s` });
      }
    };
    update();
    const int = setInterval(update, 5000); // Actualiza cada 5s para ahorrar CPU
    return () => clearInterval(int);
  }, [lastActive]);

  return (
    <div className="flex items-center gap-1 shrink-0 ml-1" title={`Última vez activo: ${lastActive ? new Date(lastActive).toLocaleTimeString() : 'Desconocido'}`}>
      <span className={`w-2 h-2 rounded-full ${dot.color} shadow-sm border border-black/10`}></span>
      {dot.label && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{dot.label}</span>}
    </div>
  );
}

const BASE_COLORS = {
  "1-Puerto": "bg-blue-500", "2-Plaza": "bg-green-500", "3-Columna": "bg-purple-500",
  "4-Base": "bg-yellow-500", "5-Cementerio": "bg-gray-500", "6-Díaz Vélez": "bg-pink-500",
  "7-Don Bosco": "bg-orange-500", "8-Monumento": "bg-cyan-500",
};

function QueueEditor({ baseName, queue, drivers, onClose, movilByPlate = {} }) {
  const queryClient = useQueryClient();
  const [addingDriver, setAddingDriver] = useState("");

  const notInQueue = drivers.filter(d =>
    d.status === "disponible" && !queue.find(q => q.id === d.id)
  );

  const moveMutation = useMutation({
    mutationFn: async ({ driverId, newPosition }) => {
      // Recalculate queue_entered_at to reflect new position
      const currentQueue = [...queue];
      const idx = currentQueue.findIndex(d => d.id === driverId);
      if (idx === -1) return;
      
      const [driverToMove] = currentQueue.splice(idx, 1);
      currentQueue.splice(newPosition, 0, driverToMove);

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

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;
    
    moveMutation.mutate({ 
      driverId: result.draggableId, 
      newPosition: result.destination.index 
    });
  };

  const removeMutation = useMutation({
    mutationFn: (driver) => base44.entities.Driver.update(driver.id, {
      current_base: null, status: "no_disponible", queue_entered_at: null,
      dispatch_status: "normal", active_ride_id: null, reserved_order_id: null,
      reservation_token: null, manual_reservation_token: null, driver_reservation_key: null
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const addMutation = useMutation({
    mutationFn: async (inputValue) => {
      const existingCount = queue.length;
      const inputTrimmed = inputValue.trim();
      
      // Buscar si el chofer ya existe (por ID, modelo/número, o nombre)
      let driver = drivers.find(d => 
        d.id === inputTrimmed || 
        d.vehicle_model === inputTrimmed || 
        d.name.toLowerCase() === inputTrimmed.toLowerCase() ||
        (d.name && d.name.startsWith(inputTrimmed + " ")) || 
        (d.name && d.name === inputTrimmed)
      );

      // Búsqueda por número
      const movilNum = parseInt(inputTrimmed);
      if (!driver && !isNaN(movilNum)) {
        driver = drivers.find(d => d.name && (d.name.startsWith(`${movilNum} `) || d.name.includes(` ${movilNum} `)));
      }

      // Si no existe, alertamos y bloqueamos (ya no creamos móviles fantasma)
      if (!driver) {
         throw new Error(`No se encontró un chofer válido con el número/nombre: ${inputTrimmed}`);
      }

      // Finalizar cualquier viaje activo al ponerlo en posición
      if (["en_viaje", "aceptado", "en_camino"].includes(driver.status)) {
        try {
          const activeOrders = await base44.entities.RideOrder.filter({
            driver_id: driver.id,
            status: { $in: ["aceptado", "en_camino", "en_viaje"] }
          });
          for (const o of activeOrders) {
            await base44.entities.RideOrder.update(o.id, { status: "completado" });
          }
        } catch (e) {
          console.error("Error completando orden activa", e);
        }
      }

      return base44.entities.Driver.update(driver.id, {
        current_base: baseName,
        status: "disponible",
        dispatch_status: "normal",
        queue_entered_at: new Date(Date.now() + existingCount * 1000).toISOString(),
        active_ride_id: null,
        reserved_order_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        driver_reservation_key: null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      window.dispatchEvent(new Event("force-driver-refresh"));
      setAddingDriver("");
    }
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Modificá el orden de la cola en <strong>{baseName}</strong>. Los cambios se aplican inmediatamente.
      </p>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="base-queue">
          {(provided) => (
            <div 
              className={`space-y-2 relative ${moveMutation.isPending ? "opacity-50 pointer-events-none" : ""}`}
              {...provided.droppableProps} 
              ref={provided.innerRef}
            >
              {queue.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Cola vacía</p>
              ) : queue.map((driver, idx) => {
                const nroMovil = movilByPlate[driver.vehicle_plate?.toUpperCase()];
                return (
                  <Draggable key={driver.id} draggableId={driver.id} index={idx}>
                    {(provided, snapshot) => (
                      <div 
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex items-center gap-2 p-3 bg-muted/50 rounded-xl ${snapshot.isDragging ? "shadow-lg ring-1 ring-primary/20 bg-background" : ""}`}
                      >
                        <div {...provided.dragHandleProps} className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing p-1">
                          <GripVertical className="w-4 h-4" />
                        </div>
                        <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0 flex items-center">
                          <p className="text-sm font-medium truncate text-slate-900">
                            {getDriverDisplay(nroMovil || driver.vehicle_model || driver.vehicle_plate, driver.name)}
                          </p>
                          <ConnectivityIndicator lastActive={driver.last_active} />
                        </div>
                        {driver.queue_entered_at && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(driver.queue_entered_at), { locale: es })}
                          </span>
                        )}
                        <div className="flex gap-1 ml-auto">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700"
                            onClick={() => removeMutation.mutate(driver)}>
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <div className="flex gap-2">
        <Input 
          className="flex-1 h-9 rounded-xl text-xs" 
          placeholder="N° de móvil o nombre para agregar..." 
          value={addingDriver} 
          onChange={(e) => setAddingDriver(e.target.value)} 
          onKeyDown={(e) => {
            if (e.key === 'Enter' && addingDriver) {
              addMutation.mutate(addingDriver);
            }
          }}
        />
        <Button size="sm" className="gap-1 rounded-xl px-4"
          disabled={!addingDriver || addMutation.isPending}
          onClick={() => addMutation.mutate(addingDriver)}>
          <Plus className="w-3 h-3" /> Agregar
        </Button>
      </div>

      <Button variant="outline" className="w-full" onClick={onClose}>Cerrar</Button>
    </div>
  );
}

export function QuickAssignInput({ drivers, moviles = [] }) {
  // const { toast } = useToast(); // Desactivamos los carteles por pedido del usuario
  const [quickInput, setQuickInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const quickInputRef = useRef(null);

  React.useEffect(() => {
    // Al montar el componente, enfocamos automáticamente este input
    if (quickInputRef.current) {
      quickInputRef.current.focus();
    }
  }, []);

  const handleQuickAssign = async (e) => {
    if (e.key !== "Enter" || !quickInput.trim()) return;
    e.preventDefault();

    const input = quickInput.trim();
    setQuickInput("");
    setIsProcessing(true);

    if (!input.includes(".")) {
      setIsProcessing(false);
      return;
    }

    const [movilStr, baseStr] = input.split(".");
    const movilNum = parseInt(movilStr.trim());
    const baseNumStr = baseStr.trim();
    
    // Find movil
    let movil = moviles.find(m => m.numero_movil === movilNum);
    
    // Buscar chofer por móvil o directamente si no hay móvil asignado
    let driver = null;
    if (movil && movil.dominio) {
      driver = drivers.find(d => d.vehicle_plate?.toUpperCase() === movil.dominio.toUpperCase());
    } else {
      driver = drivers.find(d => d.vehicle_model === String(movilNum));
    }

    // Un fallback más directo: buscar por número de móvil exacto en caso de inconsistencia con patentes
    if (!driver) {
       driver = drivers.find(d => {
         const m = moviles.find(mv => mv.dominio?.toUpperCase() === d.vehicle_plate?.toUpperCase());
         return m && m.numero_movil === movilNum;
       });
    }

    // Auto-crear bloqueado - evitamos crear móviles fantasma
    if (!movil || !driver) {
      alert(`No se encontró un chofer registrado para el móvil ${movilNum}. Por favor, registralo primero.`);
      setIsProcessing(false);
      return;
    }

    if (!movil.activo || movil.fuera_de_servicio) {
      // Forzar activación (mantenemos esto por si el operador lo saca de servicio y luego lo ingresa con un comando)
      try {
        await base44.entities.Movil.update(movil.id, { activo: true, fuera_de_servicio: false });
      } catch (err) {}
    }

    // Finalizar cualquier viaje activo al ponerlo en posición o sacarlo de servicio
    if (["en_viaje", "aceptado", "en_camino"].includes(driver.status)) {
      try {
        const activeOrders = await base44.entities.RideOrder.filter({
          driver_id: driver.id,
          status: { $in: ["aceptado", "en_camino", "en_viaje"] }
        });
        for (const o of activeOrders) {
          await base44.entities.RideOrder.update(o.id, { status: "completado" });
        }
      } catch (e) {
        console.error("Error completando orden activa", e);
      }
    }

    // Salida de servicio rápida con .00 o .0
    if (baseNumStr === "00" || baseNumStr === "0") {
    try {
      await base44.entities.Driver.update(driver.id, {
        current_base: null,
        status: "no_disponible",
        dispatch_status: "normal",
        reserved_order_id: null,
        queue_entered_at: null,
        active_ride_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        driver_reservation_key: null
      });
        window.dispatchEvent(new Event("force-driver-refresh"));
      } catch (err) {
      }
      setIsProcessing(false);
      return;
    }

    // Find base
    const baseName = BASES.find(b => b.startsWith(baseNumStr + "-"));
    if (!baseName) {
      setIsProcessing(false);
      return;
    }

    try {
      // Como drivers no está actualizado con el driver nuevo si recién se creó, la cola se calcula normal
      const queue = getBaseQueue(drivers, baseName);
      await base44.entities.Driver.update(driver.id, {
        current_base: baseName,
        status: "disponible",
        queue_entered_at: new Date(Date.now() + queue.length * 1000).toISOString(),
      });
      
      // Forzar recarga rápida de la UI, ya que mutation invalidaría react-query pero acá no estamos usando el useMutation de BaseQueueManager sino update directo
      window.dispatchEvent(new Event("force-driver-refresh"));
    } catch (err) {
    }
    
    setIsProcessing(false);
  };

  return (
    <Input 
      ref={quickInputRef}
      placeholder={isProcessing ? "Asignando..." : "móvil.base (ej: 12.3) o salir (ej: 12.0)"} 
      value={quickInput}
      onChange={(e) => setQuickInput(e.target.value)}
      onKeyDown={handleQuickAssign}
      disabled={isProcessing}
      className="bg-white text-black font-bold text-sm h-10 border-2 border-purple-300 disabled:opacity-50 placeholder:text-slate-600 shadow-sm"
    />
  );
}

export default function BaseQueueManager({ drivers, moviles = [] }) {
  // Mapa patente → número de móvil para lookup rápido
  const movilByPlate = Object.fromEntries(moviles.map(m => [m.dominio?.toUpperCase(), m.numero_movil]));
  const [editingBase, setEditingBase] = useState(null);

  const isDriverWorking = (d) => {
    if (d.status !== "disponible") return false;
    const mobileId = String(d.vehicle_model || "");
    const mobileNumber = parseInt(mobileId, 10);
    const movil = moviles?.find(m => m.id === mobileId || m.numero_movil === mobileNumber);
    if (movil && (movil.activo === false || movil.fuera_de_servicio === true)) {
      return false;
    }
    return true;
  };
  const workingDrivers = drivers.filter(isDriverWorking);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {BASES.map(baseName => {
          const queue = getBaseQueue(workingDrivers, baseName);
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
                      <div className="flex-1 min-w-0 flex items-center">
                        <p className="text-xs font-medium truncate text-primary font-bold">
                          {getDriverDisplay(nroMovil || driver.vehicle_model || driver.vehicle_plate, driver.name)}
                        </p>
                        <ConnectivityIndicator lastActive={driver.last_active} />
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

      <DraggableModal 
        isOpen={!!editingBase} 
        onClose={() => setEditingBase(null)}
        title={`Cola de Base — ${editingBase}`}
      >
        {editingBase && (
          <QueueEditor
            baseName={editingBase}
            queue={getBaseQueue(workingDrivers, editingBase)}
            drivers={workingDrivers}
            onClose={() => setEditingBase(null)}
            movilByPlate={movilByPlate}
          />
        )}
      </DraggableModal>
    </>
  );
}