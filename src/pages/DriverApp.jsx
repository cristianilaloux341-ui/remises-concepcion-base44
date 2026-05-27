import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Phone, CheckCircle2, XCircle, Navigation, Car, Clock, LogIn, Bell, List, Users, ArrowRightLeft, MessageCircle, PowerOff, Wifi } from "lucide-react";
import RideMap from "@/components/map/RideMap";
import { BASES, reassignAfterReject } from "@/lib/dispatchLogic";
import InstallBanner from "@/components/driver/InstallBanner";
import DriverMessages from "@/components/driver/DriverMessages";

// ── Audio & Notifications ─────────────────────────────────────────────────────

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
    ctx.resume();
  } catch (_) {}
}

function playAlert() {
  try { navigator.vibrate?.([400, 200, 400, 200, 800]); } catch (_) {}
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    resume.then(() => {
      [0, 400, 800].forEach(delay => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "sine"; o.frequency.value = 880;
        g.gain.setValueAtTime(0, ctx.currentTime + delay / 1000);
        g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + delay / 1000 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay / 1000 + 0.4);
        o.start(ctx.currentTime + delay / 1000);
        o.stop(ctx.currentTime + delay / 1000 + 0.4);
      });
    });
  } catch (_) {}
}

// Request notification permission and send system notification
async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
}

function sendSystemNotification(order) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification("🚖 ¡Nuevo Viaje!", {
      body: `${order.pickup_address}${order.dropoff_address ? " → " + order.dropoff_address : ""}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [400, 200, 400, 200, 800],
      requireInteraction: true,
      tag: "ride-offer-" + order.id,
    });
    setTimeout(() => n.close(), 30000);
  } catch (_) {}
}

// ── Navigation helper ─────────────────────────────────────────────────────────
function openMapsNavigation(address, driverLat, driverLng) {
  const dest = encodeURIComponent(address);
  let url;
  if (driverLat && driverLng) {
    url = `https://www.google.com/maps/dir/${driverLat},${driverLng}/${dest}`;
  } else {
    url = `https://www.google.com/maps/search/?api=1&query=${dest}`;
  }
  window.open(url, "_blank");
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
                onClick={() => { unlockAudio(); onSelect(d.id); }}
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
        <div className="bg-amber-500 px-5 py-4 flex items-center gap-3 animate-pulse">
          <Bell className="w-6 h-6 text-white" />
          <div>
            <p className="font-bold text-white text-lg leading-tight">¡Nuevo Viaje!</p>
            <p className="text-amber-100 text-xs">Respondé antes de que se reasigne</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
              <Phone className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <p className="font-semibold">{order.client_name}</p>
            </div>
          </div>

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
function ActiveRideScreen({ order, driver, onStatusChange }) {
  const cfg = STATUS_CONFIG[order.status];

  const handleNavigate = () => {
    const address = order.status === "en_viaje" ? order.dropoff_address : order.pickup_address;
    if (address) openMapsNavigation(address, driver?.current_lat, driver?.current_lng);
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 min-h-0">
        <RideMap orders={[order]} drivers={[]} className="h-full" />
      </div>

      <div className="bg-white rounded-t-3xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-bold text-lg">Viaje en Curso</p>
          <Badge className={`${cfg?.bg} text-white border-0 px-3`}>{cfg?.label}</Badge>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-green-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400">RECOGIDA</p>
              <p className="font-semibold text-sm">{order.pickup_address}</p>
            </div>
          </div>
          {order.dropoff_address && (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400">DESTINO</p>
                <p className="font-semibold text-sm">{order.dropoff_address}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Phone className="w-4 h-4" />
            <span>{order.client_name}</span>
          </div>
        </div>

        {/* Navigate button */}
        <Button
          variant="outline"
          className="w-full h-11 rounded-2xl gap-2 border-blue-200 text-blue-600 hover:bg-blue-50 font-semibold"
          onClick={handleNavigate}
        >
          <Navigation className="w-4 h-4" />
          Navegar con Google Maps
        </Button>

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

// ── Off service screen ────────────────────────────────────────────────────────
function OffServiceScreen({ onGoOnService }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-6">
      <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center">
        <PowerOff className="w-10 h-10 text-red-400" />
      </div>
      <div className="text-center">
        <p className="text-xl font-bold text-gray-800">Fuera de Servicio</p>
        <p className="text-gray-500 text-sm mt-1">No recibirás viajes mientras estés fuera de servicio</p>
      </div>
      <Button
        className="h-14 px-8 rounded-2xl text-base font-bold bg-green-500 hover:bg-green-600 gap-2 shadow-lg shadow-green-500/20"
        onClick={onGoOnService}
      >
        <Wifi className="w-5 h-5" /> Entrar en Servicio
      </Button>
    </div>
  );
}

// ── Idle / waiting screen ─────────────────────────────────────────────────────
function IdleScreen({ driver, drivers, selectedBase, onBaseChange, onEnter, onChangeBase, onGoOffService }) {
  const [changingBase, setChangingBase] = useState(false);
  const [newBase, setNewBase] = useState("");

  const isInBase = driver.current_base && driver.status === "disponible";

  // Queue for current base
  const baseQueue = drivers
    .filter(d => d.current_base === driver.current_base && d.status === "disponible")
    .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at));
  const myPosition = baseQueue.findIndex(d => d.id === driver.id) + 1;

  if (changingBase) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-6">
        <div className="text-center">
          <p className="text-xl font-bold text-gray-800">Cambiar de Base</p>
          <p className="text-gray-500 text-sm mt-1">Estás en: <span className="font-semibold text-gray-700">{driver.current_base}</span></p>
        </div>
        <div className="w-full max-w-xs space-y-3">
          <Select value={newBase} onValueChange={setNewBase}>
            <SelectTrigger className="h-12 rounded-2xl text-base border-2">
              <SelectValue placeholder="Seleccionar nueva base..." />
            </SelectTrigger>
            <SelectContent>
              {BASES.filter(b => b !== driver.current_base).map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            className="w-full h-12 rounded-2xl text-base font-bold"
            disabled={!newBase}
            onClick={() => { onChangeBase(newBase); setChangingBase(false); setNewBase(""); }}
          >
            Moverme a {newBase || "esta base"}
          </Button>
          <Button
            variant="outline"
            className="w-full h-12 rounded-2xl text-base"
            onClick={() => setChangingBase(false)}
          >
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  if (isInBase) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-5">
        <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center relative">
          <div className="w-6 h-6 rounded-full bg-green-500 animate-ping absolute" />
          <Clock className="w-10 h-10 text-green-600 relative" />
        </div>
        <div className="text-center">
          <p className="text-xl font-bold text-gray-800">En Posición</p>
          <p className="text-gray-500 mt-1">Base: <span className="font-semibold text-gray-700">{driver.current_base}</span></p>
          <p className="text-gray-400 text-sm mt-1">Esperando asignación de viaje...</p>
        </div>

        {/* Queue info */}
        <div className="w-full max-w-xs bg-white rounded-2xl border border-gray-200 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-600 flex items-center gap-1.5">
              <Users className="w-4 h-4" /> Cola de la Base
            </span>
            <Badge className="bg-blue-100 text-blue-700 border-0">
              {myPosition}° de {baseQueue.length}
            </Badge>
          </div>
          <div className="space-y-1.5">
            {baseQueue.map((d, i) => (
              <div
                key={d.id}
                className={`flex items-center gap-2 text-sm px-3 py-2 rounded-xl ${d.id === driver.id ? "bg-green-50 border border-green-200 font-semibold text-green-800" : "text-gray-500"}`}
              >
                <span className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                <span className="truncate">{d.name}</span>
                {d.id === driver.id && <span className="ml-auto text-xs text-green-600">← vos</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="gap-2 rounded-2xl border-gray-300"
            onClick={() => setChangingBase(true)}
          >
            <ArrowRightLeft className="w-4 h-4" /> Cambiar Base
          </Button>
          <Button
            variant="outline"
            className="gap-2 rounded-2xl border-red-200 text-red-500 hover:bg-red-50"
            onClick={onGoOffService}
          >
            <PowerOff className="w-4 h-4" /> Salir de Servicio
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-6">
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
    </div>
  );
}

// ── Register Service Worker ───────────────────────────────────────────────────
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return reg;
  } catch (_) { return null; }
}

function notifySW(message) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage(message);
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DriverApp() {
  const queryClient = useQueryClient();
  const [myDriverId, setMyDriverId] = useState(() => localStorage.getItem("my_driver_id") || "");
  const [selectedBase, setSelectedBase] = useState("");
  const [showMessages, setShowMessages] = useState(false);
  const prevOfferedId = useRef(null);

  // Register SW and request notification permission on load
  useEffect(() => {
    registerSW();
    requestNotificationPermission();
  }, []);

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
    refetchInterval: 5000,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 100),
    refetchInterval: 800,
  });

  const myDriver = drivers.find(d => d.id === myDriverId);
  const activeOrder = orders.find(o => o.driver_id === myDriverId && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
  const offeredOrder = orders.find(o => o.driver_id === myDriverId && o.status === "ofrecido");
  const availableOrders = orders.filter(o => o.status === "pendiente" && !o.driver_id);

  // Inform SW which driver is active
  useEffect(() => {
    notifySW({ type: "SET_DRIVER", driverId: myDriverId || null });
  }, [myDriverId]);

  // Alert on new offer (audio + SW notification) — repeat every 4s
  useEffect(() => {
    if (offeredOrder) {
      if (offeredOrder.id !== prevOfferedId.current) {
        prevOfferedId.current = offeredOrder.id;
        playAlert();
        sendSystemNotification(offeredOrder);
        notifySW({ type: "SHOW_NOTIFICATION", order: offeredOrder });
      }
      const interval = setInterval(() => {
        playAlert();
        notifySW({ type: "SHOW_NOTIFICATION", order: offeredOrder });
      }, 4000);
      return () => clearInterval(interval);
    } else {
      prevOfferedId.current = null;
      notifySW({ type: "OFFER_CLEARED" });
    }
  }, [offeredOrder?.id]);

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
  const handleReject = async () => {
    const currentOrder = { ...offeredOrder, offered_driver_ids: [...(offeredOrder.offered_driver_ids || []), myDriverId] };
    await reassignAfterReject(currentOrder, drivers, []);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
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
  const handleChangeBase = (newBase) => {
    updateDriver.mutate({
      id: myDriverId,
      data: { current_base: newBase, status: "disponible", queue_entered_at: new Date().toISOString() },
    });
  };
  const handleTakeOrder = (order) => {
    updateOrder.mutate({ id: order.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  const handleGoOffService = () => {
    updateDriver.mutate({ id: myDriverId, data: { status: "no_disponible", current_base: null } });
  };

  const handleGoOnService = () => {
    // Re-enter idle so driver picks a base
    updateDriver.mutate({ id: myDriverId, data: { status: "disponible", current_base: null, queue_entered_at: null } });
  };

  // Count unread messages for badge
  const unreadCount = (() => {
    // We don't fetch messages here; badge is shown in DriverMessages component
    return 0;
  })();

  if (!myDriver) {
    return (
      <LoginScreen
        drivers={drivers}
        onSelect={(id) => { setMyDriverId(id); localStorage.setItem("my_driver_id", id); }}
      />
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col max-w-md mx-auto relative overflow-hidden" onTouchStart={unlockAudio} onClick={unlockAudio}>
      <InstallBanner />

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
        <div className="flex items-center gap-2">
          {myDriver.current_base && myDriver.status === "disponible" && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
              📍 {myDriver.current_base}
            </Badge>
          )}
          {myDriver.status === "en_viaje" && (
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">En Viaje</Badge>
          )}
          {myDriver.status === "no_disponible" && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">Fuera de Servicio</Badge>
          )}
          <button
            className="p-2 rounded-xl bg-blue-600/20 text-blue-400"
            onClick={() => setShowMessages(true)}
          >
            <MessageCircle className="w-4 h-4" />
          </button>
          {myDriver.status !== "en_viaje" && (
            myDriver.status === "no_disponible" ? (
              <button
                className="p-2 rounded-xl bg-green-600/20 text-green-400"
                onClick={handleGoOnService}
                title="Entrar en servicio"
              >
                <Wifi className="w-4 h-4" />
              </button>
            ) : (
              <button
                className="p-2 rounded-xl bg-red-600/20 text-red-400"
                onClick={handleGoOffService}
                title="Salir de servicio"
              >
                <PowerOff className="w-4 h-4" />
              </button>
            )
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
        <ActiveRideScreen order={activeOrder} driver={myDriver} onStatusChange={handleStatusChange} />
      ) : myDriver.status === "no_disponible" ? (
        <OffServiceScreen onGoOnService={handleGoOnService} />
      ) : availableOrders.length > 0 && myDriver.status === "disponible" && !myDriver.current_base ? (
        <AvailableOrders orders={availableOrders} onTake={handleTakeOrder} />
      ) : (
        <IdleScreen
          driver={myDriver}
          drivers={drivers}
          selectedBase={selectedBase}
          onBaseChange={setSelectedBase}
          onEnter={handleEnterBase}
          onChangeBase={handleChangeBase}
          onGoOffService={handleGoOffService}
        />
      )}

      {offeredOrder && (
        <IncomingAlert order={offeredOrder} onAccept={handleAccept} onReject={handleReject} />
      )}

      {showMessages && myDriver && (
        <DriverMessages driver={myDriver} onClose={() => setShowMessages(false)} />
      )}
    </div>
  );
}