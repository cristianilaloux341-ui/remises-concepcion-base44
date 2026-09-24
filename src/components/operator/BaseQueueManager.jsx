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
import { getBaseQueue, getEffectiveQueueBase, BASES } from "@/lib/dispatchLogic";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowUp, ArrowDown, XCircle, Plus, Clock, Settings, Zap, TriangleAlert } from "lucide-react";
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
    const int = setInterval(update, 15000); // Indicador visual: no necesita refresco cada 5s
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

function QueueEditor({ baseName, queue, drivers, onClose, movilById = {} }) {
  const queryClient = useQueryClient();
  const [addingDriver, setAddingDriver] = useState("");

  const notInQueue = drivers.filter(d =>
    d.status === "disponible" && !queue.find(q => q.id === d.id)
  );

  const moveMutation = useMutation({
    mutationFn: async ({ driverId, newPosition }) => {
      const sessionToken = sessionStorage.getItem('local_operator_token') || null;
      const res = await base44.functions.invoke('manualReorderDriverQueue', {
        driverId, baseName, newPosition, sessionToken
      });
      if (!res?.data?.success) {
        if (res?.data?.skipped) return res.data;
        throw new Error(res?.data?.reason === 'unauthorized'
          ? 'Sesión de operador expirada. Volvé a ingresar.'
          : (res?.data?.reason || 'No se pudo reordenar la cola.'));
      }
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    // El drag ya no puede alterar la cola por un roce/scroll accidental. Toda
    // modificación manual requiere una confirmación explícita del operador.
    const driver = queue.find(d => d.id === result.draggableId);
    const from = result.source.index + 1;
    const to = result.destination.index + 1;
    const ok = window.confirm(`Mover ${driver?.name || "este móvil"} de ${from}° a ${to}° en ${baseName}?`);
    if (!ok) return;
    
    moveMutation.mutate({ 
      driverId: result.draggableId, 
      newPosition: result.destination.index 
    });
  };

  const removeMutation = useMutation({
    mutationFn: async (driver) => {
      const sessionToken = sessionStorage.getItem('local_operator_token') || null;
      const res = await base44.functions.invoke('leaveDriverQueue', {
        driverId: driver.id,
        source: "central_queue_editor",
        sessionToken
      });
      const data = res?.data || res;
      if (data?.success !== true && data?.idempotent !== true) {
        throw new Error(data?.reason || "El móvil cambió de estado o recibió un pasaje. No se lo sacó de la lista.");
      }
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const addMutation = useMutation({
    mutationFn: async (inputValue) => {
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

      // Nunca borrar una oferta/viaje por agregar el móvil a una base desde el editor.
      // Solo un móvil realmente libre puede ingresar o cambiar de cola.
      if (["en_viaje", "aceptado", "en_camino"].includes(driver.status) || driver.active_ride_id || driver.reserved_order_id || driver.dispatch_status === "automatic_pending") {
        throw new Error(`El móvil tiene un viaje u oferta activa. Esperá a que termine antes de ponerlo en ${baseName}.`);
      }

      // Misma entrada atómica que usa la APK: Central nunca publica un estado
      // intermedio con queue_position=null.
      const sessionToken = sessionStorage.getItem('local_operator_token') || null;
      const entered = await base44.functions.invoke('enterDriverQueue', {
        driverId: driver.id,
        baseName,
        sessionToken
      });
      const data = entered?.data || entered;
      if (data?.success !== true && data?.idempotent !== true) {
        throw new Error(data?.reason || `El móvil cambió de estado. No se modificó su posición en ${baseName}.`);
      }

      for (let check = 0; check < 8; check++) {
        const fresh = await base44.entities.Driver.get(driver.id).catch(() => null);
        const pos = Number(fresh?.queue_position);
        const marker = Number(fresh?.queue_authority_marker);
        if (fresh?.queue_authoritative_base === baseName &&
            fresh?.status === "disponible" &&
            (fresh?.dispatch_status == null || fresh?.dispatch_status === "normal") &&
            Number.isFinite(pos) && pos > 0 &&
            Number.isFinite(marker) && marker === pos &&
            !fresh?.reserved_order_id && !fresh?.active_ride_id) {
          return fresh;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // El backend ya confirmó el commit. Si la lectura todavía viene atrasada,
      // refrescar la Central sin volver a escribir la cola.
      return data;
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
                const nroMovil = movilById[String(driver.vehicle_model || "")];
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
                            {getDriverDisplay(nroMovil, driver.name)}
                          </p>
                          <ConnectivityIndicator lastActive={driver.last_active} />
                        </div>
                        {driver.queue_entered_at && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1" title="Posición">
                            #{driver.queue_position}
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
    
    // El número ingresado resuelve primero el Movil; el chofer debe apuntar
    // exactamente a ese ID mediante Driver.vehicle_model.
    const driver = movil
      ? drivers.find(d => String(d.vehicle_model || "") === String(movil.id))
      : null;

    // Auto-crear bloqueado - evitamos crear móviles fantasma
    if (!movil || !driver) {
      alert(`No se encontró un chofer registrado para el móvil ${movilNum}. Por favor, registralo primero.`);
      setIsProcessing(false);
      return;
    }

    // Un móvil marcado fuera de servicio no puede reactivarse de forma silenciosa
    // por escribir una posición. Debe volver a servicio explícitamente primero.
    if (!movil.activo || movil.fuera_de_servicio) {
      alert(`El móvil ${movilNum} está fuera de servicio. Reactivalo primero antes de ponerlo en una base.`);
      setIsProcessing(false);
      return;
    }

    // Nunca completar ni borrar una reserva por escribir móvil.base o móvil.0.
    // También bloquear una oferta pendiente de respuesta, no solo un viaje aceptado.
    if (["en_viaje", "aceptado", "en_camino"].includes(driver.status) || driver.active_ride_id || driver.reserved_order_id || driver.dispatch_status === "automatic_pending") {
      alert(`El móvil ${movilNum} tiene un viaje u oferta activa. Esperá a que termine antes de cambiarlo de base o sacarlo de servicio.`);
      setIsProcessing(false);
      return;
    }

    // Salida de servicio rápida con .00 o .0
    if (baseNumStr === "00" || baseNumStr === "0") {
    try {
      const sessionToken = sessionStorage.getItem('local_operator_token') || null;
      const res = await base44.functions.invoke('leaveDriverQueue', {
        driverId: driver.id,
        source: "central_quick_assign",
        sessionToken
      });
      const data = res?.data || res;
      if (data?.success !== true && data?.idempotent !== true) {
        throw new Error(data?.reason || "No se pudo sacar el móvil de servicio.");
      }
      window.dispatchEvent(new Event("force-driver-refresh"));
      } catch (err) {
        alert(err?.message || `No se pudo sacar de servicio al móvil ${movilNum}.`);
        window.dispatchEvent(new Event("force-driver-refresh"));
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
      // Se utiliza la misma función estricta que los choferes para prevenir
      // condiciones de carrera y garantizar el orden exacto en base.
      const sessionToken = sessionStorage.getItem('local_operator_token') || null;
      const res = await base44.functions.invoke('enterDriverQueue', {
        driverId: driver.id,
        baseName: baseName,
        sessionToken
      });
      
      const data = res?.data || res;
      if (data?.success !== true && data?.idempotent !== true) {
        const fresh = await base44.entities.Driver.get(driver.id);
        const pos = Number(fresh?.queue_position);
        const marker = Number(fresh?.queue_authority_marker);
        const alreadyThere = fresh?.queue_authoritative_base === baseName &&
          fresh?.status === "disponible" &&
          (fresh?.dispatch_status == null || fresh?.dispatch_status === "normal") &&
          Number.isFinite(pos) && pos > 0 &&
          Number.isFinite(marker) && marker === pos &&
          !fresh?.reserved_order_id && !fresh?.active_ride_id;
        if (!alreadyThere) throw new Error(data?.reason || "El móvil cambió de estado; no se modificó su posición.");
      }
      
      // Forzar recarga rápida de la UI después del commit server-side.
      window.dispatchEvent(new Event("force-driver-refresh"));
    } catch (err) {
      alert(err?.message || `No se pudo ubicar al móvil ${movilNum} en ${baseName}.`);
      // Si hubo una carrera, refrescar la verdad del servidor en vez de dejar
      // que la Central parezca haber aceptado una operación que falló.
      window.dispatchEvent(new Event("force-driver-refresh"));
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
  // Driver.vehicle_model guarda el ID real de la entidad Movil.
  const movilById = Object.fromEntries(moviles.map(m => [String(m.id), m.numero_movil]));
  const [editingBase, setEditingBase] = useState(null);

  // Respaldo visual de cola: compara únicamente movimientos del MISMO móvil
  // dentro de la MISMA base. No escribe ni corrige posiciones.
  const previousQueueRef = useRef(new Map());
  const [queueMovementAlerts, setQueueMovementAlerts] = useState({});

  useEffect(() => {
    const previous = previousQueueRef.current;
    const next = new Map();
    const alerts = {};

    for (const d of drivers || []) {
      const base = getEffectiveQueueBase(d);
      const pos = Number(d.queue_position);
      if (!base || !Number.isFinite(pos) || pos <= 0) continue;

      const current = { base, pos };
      const before = previous.get(d.id);

      if (before && before.base === current.base && before.pos !== current.pos) {
        alerts[d.id] = {
          base: current.base,
          from: before.pos,
          to: current.pos,
          detectedAt: Date.now()
        };
      }
      next.set(d.id, current);
    }

    previousQueueRef.current = next;
    if (Object.keys(alerts).length) {
      setQueueMovementAlerts(prev => ({ ...prev, ...alerts }));
    }
  }, [drivers]);

  useEffect(() => {
    if (!Object.keys(queueMovementAlerts).length) return;
    // Es sólo una alerta visual de movimiento: un único timeout basta. Evita
    // despertar/re-renderizar toda la botonera de colas cada segundo.
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 30000;
      setQueueMovementAlerts(prev => Object.fromEntries(
        Object.entries(prev).filter(([, movement]) => movement.detectedAt >= cutoff)
      ));
    }, 30000);
    return () => clearTimeout(timer);
  }, [queueMovementAlerts]);

  const getLinkedMovil = (d) => {
    const mobileId = String(d.vehicle_model || "");
    return moviles?.find(m => String(m.id || "") === mobileId);
  };

  const isDriverEnabled = (d) => {
    const movil = getLinkedMovil(d);
    return Boolean(
      movil &&
      movil.activo !== false &&
      movil.fuera_de_servicio !== true &&
      !movil.suspension_motivo
    );
  };

  const isDriverWorking = (d) => d.status === "disponible" && isDriverEnabled(d);
  const workingDrivers = drivers.filter(isDriverWorking);
  const enabledDrivers = drivers.filter(isDriverEnabled);

  // Visibilidad ≠ elegibilidad de despacho.
  // Un móvil ofrecido/reservado/en viaje sigue perteneciendo visualmente a su base,
  // pero NO participa de getBaseQueue ni recibe otro pasaje.
  const getBusyDriversForBase = (baseName) => enabledDrivers.filter(d => {
    if (d.status === "no_disponible") return false;
    if (getEffectiveQueueBase(d) !== baseName) return false;
    return (
      d.status !== "disponible" ||
      (d.dispatch_status != null && d.dispatch_status !== "normal") ||
      Boolean(d.reserved_order_id || d.active_ride_id)
    );
  });

  const getBusyLabel = (d) => {
    if (d.status === "en_viaje" || d.active_ride_id) return "EN VIAJE";
    if (d.dispatch_status === "automatic_pending" || d.reserved_order_id) return "OFRECIDO";
    return "OCUPADO";
  };

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {BASES.map(baseName => {
          const queue = getBaseQueue(workingDrivers, baseName);
          const busyDrivers = getBusyDriversForBase(baseName);
          const visibleCount = queue.length + busyDrivers.length;
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
                    <Badge variant="secondary" className="text-xs">{visibleCount}</Badge>
                    <Button size="icon" variant="ghost" className="h-6 w-6"
                      onClick={() => setEditingBase(baseName)}>
                      <Settings className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1.5">
                {visibleCount === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">Vacía</p>
                ) : (
                  <>
                    {queue.slice(0, 4).map((driver, idx) => {
                      const nroMovil = movilById[String(driver.vehicle_model || "")];
                      return (
                        <div key={driver.id} className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/50">
                          <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {idx + 1}
                          </span>
                          <div className="flex-1 min-w-0 flex items-center">
                            <p className="text-xs font-medium truncate text-primary font-bold">
                              {getDriverDisplay(nroMovil, driver.name)}
                            </p>
                            {queueMovementAlerts[driver.id]?.base === baseName && (
                              <span
                                className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-extrabold text-red-600 shrink-0"
                                title={`Movimiento detectado dentro de ${baseName}: ${queueMovementAlerts[driver.id].from}° → ${queueMovementAlerts[driver.id].to}°`}
                              >
                                <TriangleAlert className="w-3.5 h-3.5" />
                                {queueMovementAlerts[driver.id].from}°→{queueMovementAlerts[driver.id].to}°
                              </span>
                            )}
                            <ConnectivityIndicator lastActive={driver.last_active} />
                          </div>
                        </div>
                      );
                    })}
                    {queue.length > 4 && (
                      <p className="text-xs text-muted-foreground text-center">+{queue.length - 4} libres más</p>
                    )}
                    {busyDrivers.map((driver) => {
                      const nroMovil = movilById[String(driver.vehicle_model || "")];
                      return (
                        <div key={`busy-${driver.id}`} className="flex items-center gap-2 p-1.5 rounded-lg border border-dashed">
                          <span className="text-[10px] font-bold shrink-0">•</span>
                          <div className="flex-1 min-w-0 flex items-center">
                            <p className="text-xs font-medium truncate">
                              {getDriverDisplay(nroMovil, driver.name)}
                            </p>
                            <ConnectivityIndicator lastActive={driver.last_active} />
                          </div>
                          <span className="text-[9px] font-semibold text-muted-foreground shrink-0">
                            {getBusyLabel(driver)}
                          </span>
                        </div>
                      );
                    })}
                  </>
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
            movilById={movilById}
          />
        )}
      </DraggableModal>
    </>
  );
}