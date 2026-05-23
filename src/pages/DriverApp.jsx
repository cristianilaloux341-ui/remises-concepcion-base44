import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Phone, CheckCircle2, XCircle, Navigation, Car, Clock, LogIn, Bell, List } from "lucide-react";
import RideMap from "@/components/map/RideMap";
import { BASES } from "@/lib/dispatchLogic";

// Play alert beep
function playAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 300, 600].forEach(delay => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.3, ctx.currentTime + delay / 1000);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay / 1000 + 0.3);
      o.start(ctx.currentTime + delay / 1000);
      o.stop(ctx.currentTime + delay / 1000 + 0.3);
    });
  } catch (_) {}
}

const STATUS_CONFIG = {
  ofrecido:  { label: "Nuevo Viaje",    bg: "bg-amber-500"  },
  aceptado:  { label: "Aceptado",       bg: "bg-blue-500"   },
  en_camino: { label: "En Camino",      bg: "bg-purple-500" },
  en_viaje:  { label: "En Viaje",       bg: "bg-cyan-500"   },
  completado:{ label: "Completado",     bg: "bg-green-500"  },
};

// ── Login screen ──────────────────────────────────────────────────────────────
function LoginScreen({ drivers, onSelect }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center mx-auto shadow-xl shadow-blue-600/30">
            <Car className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Remisería</h1>
          <p className="text-gray-400">App del Chófer</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-5 space-y-3 border border-gray-800">
          <p className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <LogIn className="w-4 h-4" /> Seleccioná tu perfil
          </p>
          {drivers.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              No hay chóferes registrados.<br />Pedile al operador que te agregue.
            </p>
          ) : (
            drivers.map(d => (
              <button
                key={d.id}
                className="w-full p-4 rounded-xl border border-gray-700 text-left hover:border-blue-500 hover:bg-blue-500/5 transition-all active:scale-95"
                onClick={() => onSelect(d.id)}
              >
                <p className="font-semibold text-white">{d.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">
                  {d.vehicle_plate}{d.vehicle_model ? ` · ${d.vehicle_model}` : ""}{d.vehicle_color ? ` · ${d.vehicle_color}` : ""}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Incoming ride alert ───────────────────────────────────────────────────────
function IncomingAlert({ order, onAccept, onReject }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center p-4 pb-8 animate-in fade-in slide-in-from-bottom-8 duration-300">
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">
        {/* flashing header */}
        <div className="bg-amber-500 px-5 py-4 flex items-center gap-3 animate-pulse">
          <Bell className="w-6 h-6 text-white" />
          <div>
            <p className="font-bold text-white text-lg leading-tight">¡Nuevo Viaje!</p>
            <p className="text-amber-100 text-xs">Respondé antes de que se reasigne</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Client */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <Phone className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="font-semibold">{order.client_name}</p>
              <p className="text-sm text-gray-500">{order.client_phone}</p>
            </div>
          </div>

          {/* Route */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400 font-medium">RECOGIDA</p>
                <p className="font-semibold text-sm">{order.pickup_address}</p>
              </div>
            </div>
            {order.dropoff_address && (
              <>
                <div className="ml-2.5 w-px h-4 bg-gray-300" />
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-gray-400 font-medium">DESTINO</p>
                    <p className="font-semibold text-sm">{order.dropoff_address}</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {order.fare && (
            <div className="flex items-center justify-between px-1">
              <span className="text-gray-500 text-sm">Tarifa</span>
              <span className="text-2xl font-bold text-green-600">${order.fare.toLocaleString()}</span>
            </div>
          )}

          {order.notes && (
            <p className="text-sm text-gray-500 italic px-1">"{order.notes}"</p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button
              size="lg"
              className="rounded-2xl h-14 bg-green-500 hover:bg-green-600 text-base font-bold gap-2 shadow-lg shadow-green-500/30"
              onClick={onAccept}
            >
              <CheckCircle2 className="w-5 h-5" /> Aceptar
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-2xl h-14 border-red-200 text-red-500 hover:bg-red-50 text-base font-bold gap-2"
              onClick={onReject}
            >
              <XCircle className="w-5 h-5" /> Rechazar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Active ride screen ────────────────────────────────────────────────────────
function ActiveRideScreen({ order, onStatusChange }) {
  const cfg = STATUS_CONFIG[order.status];
  return (
    <div className="flex-1 flex flex-col">
      {/* Map */}
      <div className="flex-1 min-h-0">
        <RideMap orders={[order]} drivers={[]} className="h-full" />
      </div>

      {/* Bottom sheet */}
      <div className="bg-white rounded-t-3xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-lg">Viaje en Curso</p>
          <Badge className={`${cfg?.bg} text-white border-0 px-3`}>{cfg?.label}</Badge>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">RECOGIDA</p>
              <p className="font-semibold text-sm">{order.pickup_address}</p>
            </div>
          </div>
          {order.dropoff_address && (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">DESTINO</p>
                <p className="font-semibold text-sm">{order.dropoff_address}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Phone className="w-4 h-4" />
            <span>{order.client_name} · </span>
            <a href={`tel:${order.client_phone}`} className="text-blue-600 font-medium">{order.client_phone}</a>
          </div>
        </div>

        {order.status === "aceptado" && (
          <Button className="w-full h-14 rounded-2xl gap-2 bg-purple-500 hover:bg-purple-600 text-base font-bold shadow-lg shadow-purple-500/20" onClick={() => onStatusChange("en_camino")}>
            <Navigation className="w-5 h-5" /> Saliendo a Buscar
          </Button>
        )}
        {order.status === "en_camino" && (
          <Button className="w-full h-14 rounded-2xl gap-2 bg-cyan-500 hover:bg-cyan-600 text-base font-bold shadow-lg shadow-cyan-500/20" onClick={() => onStatusChange("en_viaje")}>
            <Car className="w-5 h-5" /> Pasajero a Bordo
          </Button>
        )}
        {order.status === "en_viaje" && (
          <Button className="w-full h-14 rounded-2xl gap-2 bg-green-500 hover:bg-green-600 text-base font-bold shadow-lg shadow-green-500/20" onClick={() => onStatusChange("completado")}>
            <CheckCircle2 className="w-5 h-5" /> Completar Viaje
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Available orders list ─────────────────────────────────────────────────────
function AvailableOrders({ orders, onTake }) {
  if (orders.length === 0) return null;
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
      <p className="text-sm font-semibold text-gray-500 pt-2">
        <List className="inline w-4 h-4 mr-1" />
        {orders.length} viaje(s) disponible(s) — elegí uno
      </p>
      {orders.map(order => (
        <div key={order.id} className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 shadow-sm">
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm">
              <div className="w-4 h-4 rounded-full bg-green-500 mt-0.5 shrink-0" />
              <span className="font-semibold">{order.pickup_address}</span>
            </div>
            {order.dropoff_address && (
              <div className="flex items-start gap-2 text-sm text-gray-500">
                <MapPin className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <span>{order.dropoff_address}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{order.client_name}</span>
            {order.fare && <span className="font-bold text-green-600 text-lg">${order.fare.toLocaleString()}</span>}
          </div>
          <Button className="w-full rounded-xl h-11 font-bold" onClick={() => onTake(order)}>
            Tomar este Viaje
          </Button>
        </div>
      ))}
    </div>
  );
}

// ── Idle / waiting screen ─────────────────────────────────────────────────────
function IdleScreen({ driver, selectedBase, onBaseChange, onEnter }) {
  const isInBase = driver.current_base && driver.status === "disponible";
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-6">
      {isInBase ? (
        <>
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full bg-green-500 animate-ping absolute" />
            <Clock className="w-10 h-10 text-green-600 relative" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-800">En Posición</p>
            <p className="text-gray-500 mt-1">Base: <span className="font-semibold text-gray-700">{driver.current_base}</span></p>
            <p className="text-gray-400 text-sm mt-1">Esperando asignación de viaje...</p>
          </div>
        </>
      ) : (
        <>
          <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center">
            <Car className="w-10 h-10 text-gray-400" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-800">¿En qué base estás?</p>
            <p className="text-gray-500 text-sm mt-1">Seleccioná tu base para quedar en posición</p>
          </div>
          <div className="w-full max-w-xs space-y-3">
            <Select value={selectedBase} onValueChange={onBaseChange}>
              <SelectTrigger className="h-12 rounded-2xl text-base border-2">
                <SelectValue placeholder="Seleccionar base..." />
              </SelectTrigger>
              <SelectContent>
                {BASES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              className="w-full h-12 rounded-2xl text-base font-bold"
              disabled={!selectedBase}
              onClick={onEnter}
            >
              Entrar a la Cola
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DriverApp() {
  const queryClient = useQueryClient();
  const [myDriverId, setMyDriverId] = useState(() => localStorage.getItem("my_driver_id") || "");
  const [selectedBase, setSelectedBase] = useState("");
  const prevOfferedId = useRef(null);

  // GPS
  useEffect(() => {
    if (!navigator.geolocation || !myDriverId) return;
    const id = navigator.geolocation.watchPosition((pos) => {
      base44.entities.Driver.update(myDriverId, {
        current_lat: pos.coords.latitude,
        current_lng: pos.coords.longitude,
      }).catch(() => {});
    });
    return () => navigator.geolocation.clearWatch(id);
  }, [myDriverId]);

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: 8000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 100),
    refetchInterval: 4000,
  });

  const myDriver = drivers.find(d => d.id === myDriverId);
  const activeOrder = orders.find(o => o.driver_id === myDriverId && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
  const offeredOrder = orders.find(o => o.driver_id === myDriverId && o.status === "ofrecido");
  const availableOrders = orders.filter(o => o.status === "pendiente" && !o.driver_id);

  // Play alert when a new offer arrives
  useEffect(() => {
    if (offeredOrder && offeredOrder.id !== prevOfferedId.current) {
      playAlert();
      prevOfferedId.current = offeredOrder.id;
    }
    if (!offeredOrder) prevOfferedId.current = null;
  }, [offeredOrder]);

  const updateOrder = useMutation({
    mutationFn: ({ id, data }) => base44.entities.RideOrder.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });
  const updateDriver = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Driver.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const handleAccept = () => {
    updateOrder.mutate({ id: offeredOrder.id, data: { status: "aceptado" } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };
  const handleReject = () => {
    updateOrder.mutate({ id: offeredOrder.id, data: { status: "pendiente", driver_id: null, driver_name: null } });
  };
  const handleStatusChange = (newStatus) => {
    updateOrder.mutate({ id: activeOrder.id, data: { status: newStatus } });
    if (newStatus === "completado") {
      updateDriver.mutate({ id: myDriverId, data: { status: "disponible", queue_entered_at: new Date().toISOString() } });
    }
  };
  const handleEnterBase = () => {
    updateDriver.mutate({
      id: myDriverId,
      data: { current_base: selectedBase, status: "disponible", queue_entered_at: new Date().toISOString() },
    });
  };
  const handleTakeOrder = (order) => {
    updateOrder.mutate({ id: order.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  // ── Login ──
  if (!myDriver) {
    return (
      <LoginScreen
        drivers={drivers}
        onSelect={(id) => { setMyDriverId(id); localStorage.setItem("my_driver_id", id); }}
      />
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col max-w-md mx-auto relative overflow-hidden">
      {/* Header */}
      <div className="bg-gray-950 text-white px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
            <Car className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">{myDriver.name}</p>
            <p className="text-xs text-gray-400 font-mono">{myDriver.vehicle_plate}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {myDriver.current_base && myDriver.status === "disponible" && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
              📍 {myDriver.current_base}
            </Badge>
          )}
          {myDriver.status === "en_viaje" && (
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">En Viaje</Badge>
          )}
          <button
            className="text-xs text-gray-500 underline"
            onClick={() => { localStorage.removeItem("my_driver_id"); setMyDriverId(""); }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* Body */}
      {activeOrder ? (
        <ActiveRideScreen order={activeOrder} onStatusChange={handleStatusChange} />
      ) : !activeOrder && availableOrders.length > 1 && myDriver.status === "disponible" ? (
        <AvailableOrders orders={availableOrders} onTake={handleTakeOrder} />
      ) : (
        <IdleScreen
          driver={myDriver}
          selectedBase={selectedBase}
          onBaseChange={setSelectedBase}
          onEnter={handleEnterBase}
        />
      )}

      {/* Incoming alert overlay */}
      {offeredOrder && !activeOrder && (
        <IncomingAlert order={offeredOrder} onAccept={handleAccept} onReject={handleReject} />
      )}
    </div>
  );
}