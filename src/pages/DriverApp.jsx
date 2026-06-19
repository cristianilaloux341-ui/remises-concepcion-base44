import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
// Tiempo real — sin polling
import { Button } from "@/components/ui/button";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeDrivers } from "@/hooks/useRealtimeDrivers";
import { useWakeLock } from "@/hooks/useWakeLock";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Phone, CheckCircle2, XCircle, Navigation, Car, Clock, LogIn, Bell, List, Users, ArrowRightLeft, MessageCircle, PowerOff, Wifi, DollarSign, Timer, HelpCircle } from "lucide-react";
import { haversineMetros } from "@/hooks/useTarifaConfig";
import RideMap from "@/components/map/RideMap";
import { BASES, reassignAfterReject } from "@/lib/dispatchLogic";
import InstallBanner from "@/components/driver/InstallBanner";
import DriverMessages from "@/components/driver/DriverMessages";
import DriverMessageModal from "@/components/driver/DriverMessageModal";
import { useDriverMessageAlert } from "@/hooks/useDriverMessageAlert";
import DriverSetupGuide from "@/components/driver/DriverSetupGuide";

// ── Audio & Notifications ─────────────────────────────────────────────────────

let audioUnlocked = false;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  try {
    const ctx = getAudioCtx();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
    ctx.resume();
  } catch (_) {}
}

function playAlert() {
  try { navigator.vibrate?.([500, 200, 500, 200, 1000, 300, 500]); } catch (_) {}
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      // 3 beeps ascendentes
      [[0, 660], [350, 880], [700, 1100]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "triangle";
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.6, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.start(t);
        o.stop(t + 0.5);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
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
  // Delegamos al SW para que la notificación funcione en segundo plano
  // Si no hay SW activo, fallback a Notification API directa
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) return; // SW lo maneja
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification("🚖 ¡Nuevo Viaje! — " + (order.client_name || ""), {
      body: `${order.pickup_address}${order.dropoff_address ? " → " + order.dropoff_address : ""}${order.fare ? "  $" + order.fare : ""}`,
      icon: "/icon-192.png",
      badge: "/icon-72.png",
      vibrate: [500, 200, 500, 200, 1000],
      requireInteraction: true,
      tag: "ride-offer",
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
  const [gpsStatus, setGpsStatus] = useState(null); // null | 'ok' | 'denied'

  const requestGps = () => {
    if (!navigator.geolocation) { setGpsStatus("denied"); return; }
    navigator.geolocation.getCurrentPosition(
      () => setGpsStatus("ok"),
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

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

        {/* Permiso GPS */}
        <div className={`rounded-2xl p-4 border flex items-center gap-3 ${gpsStatus === "ok" ? "bg-green-900/30 border-green-700" : gpsStatus === "denied" ? "bg-red-900/30 border-red-700" : "bg-gray-800 border-gray-700"}`}>
          <MapPin className={`w-5 h-5 shrink-0 ${gpsStatus === "ok" ? "text-green-400" : gpsStatus === "denied" ? "text-red-400" : "text-gray-400"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">Ubicación GPS</p>
            <p className="text-xs text-gray-400">
              {gpsStatus === "ok" ? "✓ Permiso concedido" : gpsStatus === "denied" ? "✗ Permiso denegado — habilitalo en Ajustes" : "Necesario para recibir viajes"}
            </p>
          </div>
          {gpsStatus !== "ok" && (
            <button
              className="shrink-0 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl"
              onClick={requestGps}
            >
              Permitir
            </button>
          )}
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
                onClick={() => { unlockAudio(); onSelect(d.id, !localStorage.getItem(`setup_done_${d.id}`)); }}
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

// ── Broadcast alert (cross-zone offer) ───────────────────────────────────────
function BroadcastAlert({ order, onAccept, onReject }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center p-4 pb-8 animate-in fade-in slide-in-from-bottom-8 duration-300">
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-blue-600 px-5 py-4 flex items-center gap-3">
          <Bell className="w-6 h-6 text-white animate-pulse" />
          <div>
            <p className="font-bold text-white text-base leading-tight">📢 Viaje disponible en {order.zone}</p>
            <p className="text-blue-100 text-xs">Sin móvil en esa zona · Podés tomarlo vos</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
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
            <Button size="lg" className="rounded-2xl h-14 bg-green-500 hover:bg-green-600 text-base font-bold gap-2 shadow-lg shadow-green-500/30" onClick={onAccept}>
              <CheckCircle2 className="w-5 h-5" /> Aceptar
            </Button>
            <Button size="lg" variant="outline" className="rounded-2xl h-14 border-red-200 text-red-500 hover:bg-red-50 text-base font-bold gap-2" onClick={onReject}>
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

  // ── Taxímetro en tiempo real (solo cuando status === "en_viaje") ────────────
  const [importeActual, setImporteActual] = useState(order.importe_real_actual || order.importe_estimado || 0);
  const [metrosRecorridos, setMetrosRecorridos] = useState(0);
  const [enEspera, setEnEspera] = useState(false);

  // refs para evitar stale closures dentro de intervals/watchers
  const metrosRef = useRef(0);
  const importeRef = useRef(importeActual);
  const contadorParadoRef = useRef(0);
  const lastPosRef = useRef(null);
  const gpsWatchRef = useRef(null);
  const timerRef = useRef(null);

  // Sync importeActual ref
  useEffect(() => { importeRef.current = importeActual; }, [importeActual]);

  const distanciaTeórica = order.distancia_teorica_metros || 0;
  const tarifaRef = useRef({
    bajada_bandera: 500,
    precio_por_metro: 2,
    precio_por_minuto_espera: 50,
    tolerancia_espera_segundos: 120,
  });

  // Load tarifa config once
  useEffect(() => {
    base44.entities.TarifaConfig.list().then(configs => {
      if (configs[0]) {
        tarifaRef.current = {
          bajada_bandera: configs[0].bajada_bandera ?? 500,
          precio_por_metro: configs[0].precio_por_metro ?? 2,
          precio_por_minuto_espera: configs[0].precio_por_minuto_espera ?? 50,
          tolerancia_espera_segundos: configs[0].tolerancia_espera_segundos ?? 120,
        };
      }
    }).catch(() => {});
  }, []);

  // Guardar importe en DB (debounced)
  const saveTimeoutRef = useRef(null);
  const saveImporte = (nuevoImporte, segundosEspera) => {
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      base44.entities.RideOrder.update(order.id, {
        importe_real_actual: Math.round(nuevoImporte),
        segundos_espera_acumulados: segundosEspera,
      }).catch(() => {});
    }, 3000); // guarda cada 3s como máximo
  };

  // Activar GPS + Timer cuando pasa a "en_viaje"
  useEffect(() => {
    if (order.status !== "en_viaje") return;

    // Inicializar con el importe actual de la orden
    const importeInicial = order.importe_real_actual || order.importe_estimado || 0;
    setImporteActual(importeInicial);
    importeRef.current = importeInicial;
    metrosRef.current = 0;
    contadorParadoRef.current = 0;
    let segundosEspera = order.segundos_espera_acumulados || 0;

    // GPS tracker
    if (navigator.geolocation) {
      gpsWatchRef.current = navigator.geolocation.watchPosition((pos) => {
        const { latitude, longitude, speed } = pos.coords;
        const speedKmh = (speed || 0) * 3.6;

        if (lastPosRef.current) {
          const metros = haversineMetros(
            lastPosRef.current.lat, lastPosRef.current.lng,
            latitude, longitude
          );
          if (metros > 0.5 && metros < 500) { // filtrar saltos de GPS
            metrosRef.current += metros;
            setMetrosRecorridos(Math.round(metrosRef.current));

            // Cobro por exceso de distancia
            const excedente = metrosRef.current - distanciaTeórica;
            if (excedente > 0) {
              const base = order.importe_estimado || importeInicial;
              const nuevo = base + excedente * tarifaRef.current.precio_por_metro;
              setImporteActual(Math.round(nuevo));
              importeRef.current = Math.round(nuevo);
            }
          }
        }

        lastPosRef.current = { lat: latitude, lng: longitude };

        // Control de espera por velocidad
        if (speedKmh < 5) {
          setEnEspera(true);
        } else {
          contadorParadoRef.current = 0;
          setEnEspera(false);
        }
      }, () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
    }

    // Timer cada 1 segundo — cobra espera
    timerRef.current = setInterval(() => {
      const speedLow = lastPosRef.current !== null; // si tenemos GPS
      if (enEspera || contadorParadoRef.current > 0) {
        contadorParadoRef.current += 1;
        if (contadorParadoRef.current > tarifaRef.current.tolerancia_espera_segundos) {
          segundosEspera += 1;
          const costoPorSegundo = tarifaRef.current.precio_por_minuto_espera / 60;
          const nuevo = importeRef.current + costoPorSegundo;
          importeRef.current = nuevo;
          setImporteActual(Math.round(nuevo));
          saveImporte(nuevo, segundosEspera);
        }
      }
    }, 1000);

    return () => {
      if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current);
      clearInterval(timerRef.current);
      clearTimeout(saveTimeoutRef.current);
    };
  }, [order.status, order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pantalla de cobro final cuando está completado
  const [showCobro, setShowCobro] = useState(order.status === "completado");
  useEffect(() => {
    if (order.status === "completado") setShowCobro(true);
  }, [order.status]);

  const handleNavigate = () => {
    const address = order.status === "en_viaje" ? order.dropoff_address : order.pickup_address;
    if (address) openMapsNavigation(address, driver?.current_lat, driver?.current_lng);
  };

  const handleCompletar = () => {
    // Guardar importe final antes de completar
    clearTimeout(saveTimeoutRef.current);
    base44.entities.RideOrder.update(order.id, {
      importe_real_actual: Math.round(importeRef.current),
    }).catch(() => {});
    onStatusChange("completado");
  };

  // Pantalla de cobro final
  if (showCobro) {
    const importeFinal = order.importe_real_actual || importeActual;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50 space-y-6">
        <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center">
          <DollarSign className="w-12 h-12 text-green-600" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-gray-500 text-sm font-medium uppercase tracking-wide">COBRAR AL PASAJERO</p>
          <p className="text-6xl font-black text-green-600">${Math.round(importeFinal).toLocaleString()}</p>
          {order.importe_estimado && importeFinal !== order.importe_estimado && (
            <p className="text-xs text-gray-400">
              Estimado: ${Math.round(order.importe_estimado).toLocaleString()} · Ajuste: ${Math.round(importeFinal - order.importe_estimado).toLocaleString()}
            </p>
          )}
          {order.segundos_espera_acumulados > 0 && (
            <p className="text-xs text-amber-600">
              ⏱ {order.segundos_espera_acumulados}s de espera cobrados
            </p>
          )}
          {distanciaTeórica > 0 && (
            <p className="text-xs text-gray-400">
              {(distanciaTeórica / 1000).toFixed(1)} km estimados
              {metrosRecorridos > 0 ? ` · ${(metrosRecorridos / 1000).toFixed(1)} km reales` : ""}
            </p>
          )}
        </div>
        <div className="w-full max-w-xs bg-white rounded-2xl border border-gray-200 p-4 space-y-2 text-sm">
          <div className="flex justify-between text-gray-500">
            <span>Recogida</span>
            <span className="font-medium text-gray-700 text-right max-w-[60%]">{order.pickup_address}</span>
          </div>
          {order.dropoff_address && (
            <div className="flex justify-between text-gray-500">
              <span>Destino</span>
              <span className="font-medium text-gray-700 text-right max-w-[60%]">{order.dropoff_address}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-500">
            <span>Pasajero</span>
            <span className="font-medium text-gray-700">{order.client_name}</span>
          </div>
        </div>
        <p className="text-sm text-gray-400">Viaje completado ✓</p>
      </div>
    );
  }

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

        {/* Taxímetro en tiempo real — solo en_viaje */}
        {order.status === "en_viaje" && (
          <div className={`rounded-2xl p-4 flex items-center justify-between ${enEspera ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
            <div className="flex items-center gap-2">
              {enEspera ? <Timer className="w-5 h-5 text-amber-500" /> : <Navigation className="w-5 h-5 text-green-600" />}
              <div>
                <p className="text-xs font-semibold text-gray-500">{enEspera ? "EN ESPERA" : "EN MOVIMIENTO"}</p>
                {metrosRecorridos > 0 && (
                  <p className="text-xs text-gray-400">{(metrosRecorridos / 1000).toFixed(2)} km recorridos</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">Tarifa actual</p>
              <p className="text-2xl font-black text-green-600">${importeActual.toLocaleString()}</p>
            </div>
          </div>
        )}

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
            {(order.importe_estimado > 0) && (
              <span className="ml-auto font-semibold text-gray-700">${Math.round(order.importe_estimado).toLocaleString()} est.</span>
            )}
          </div>
        </div>

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
          <Button className="w-full h-14 rounded-2xl gap-2 bg-green-500 hover:bg-green-600 text-base font-bold shadow-lg shadow-green-500/20" onClick={handleCompletar}>
            <CheckCircle2 className="w-5 h-5" /> Terminar Viaje · ${importeActual.toLocaleString()}
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
      <div className="flex-1 flex flex-col min-h-0">
        {/* Mapa ocupa el espacio disponible */}
        <div className="flex-1 min-h-0">
          <RideMap orders={[]} drivers={[driver]} className="h-full" />
        </div>

        {/* Panel inferior fijo */}
        <div className="bg-white rounded-t-3xl shadow-2xl px-5 pt-4 pb-5 space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center relative">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-ping absolute" />
                <Clock className="w-5 h-5 text-green-600 relative" />
              </div>
              <div>
                <p className="font-bold text-gray-800">En Posición</p>
                <p className="text-sm text-gray-500">📍 {driver.current_base}</p>
              </div>
            </div>
            <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">
              {myPosition}° de {baseQueue.length}
            </Badge>
          </div>

          {/* Cola compacta */}
          <div className="flex gap-1.5 flex-wrap">
            {baseQueue.map((d, i) => (
              <span
                key={d.id}
                className={`text-xs px-2.5 py-1 rounded-xl font-medium ${d.id === driver.id ? "bg-green-500 text-white" : "bg-gray-100 text-gray-500"}`}
              >
                {i + 1}. {d.name.split(" ")[0]}
              </span>
            ))}
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 gap-2 rounded-2xl border-gray-300 h-11"
              onClick={() => setChangingBase(true)}
            >
              <ArrowRightLeft className="w-4 h-4" /> Cambiar Base
            </Button>
            <Button
              variant="outline"
              className="flex-1 gap-2 rounded-2xl border-red-200 text-red-500 hover:bg-red-50 h-11"
              onClick={onGoOffService}
            >
              <PowerOff className="w-4 h-4" /> Salir
            </Button>
          </div>
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
  const [myDriverId, setMyDriverId] = useState(() => localStorage.getItem("my_driver_id") || "");
  const [selectedBase, setSelectedBase] = useState("");
  const [showMessages, setShowMessages] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [dismissedBroadcasts, setDismissedBroadcasts] = useState([]);
  const prevOfferedId = useRef(null);
  const offeredOrderRef = useRef(null);
  const prevBroadcastId = useRef(null);

  // Register SW and request notification permission on load
  useEffect(() => {
    registerSW();
    requestNotificationPermission();
  }, []);

  // Keep-alive: ping al SW cada 20s para que no lo maten en background
  useEffect(() => {
    if (!myDriverId) return;
    const interval = setInterval(() => {
      notifySW({ type: "KEEP_ALIVE" });
    }, 20000);
    return () => clearInterval(interval);
  }, [myDriverId]);

  // BroadcastChannel: el SW nos despierta cuando detecta que la app está dormida
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("radiocab_wake");
    bc.onmessage = (e) => {
      if (e.data?.type === "WAKE_UP" && e.data.driverId === myDriverId) {
        // La app se reactiva — las suscripciones en tiempo real se reconectan solas
        console.log("[RadioCab] SW wake-up recibido");
      }
    };
    return () => bc.close();
  }, [myDriverId]);

  // Load dismissed broadcasts from localStorage per driver
  useEffect(() => {
    if (!myDriverId) { setDismissedBroadcasts([]); return; }
    const dismissed = JSON.parse(localStorage.getItem(`dismissed_bc_${myDriverId}`) || "[]");
    setDismissedBroadcasts(dismissed);
  }, [myDriverId]);

  // Escuchar mensajes del SW (ej: usuario tocó "Aceptar" en la notificación)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event) => {
      if (event.data?.type === "SW_ACCEPT_ORDER") {
        // El SW nos pide aceptar la orden porque el usuario tocó el botón en la notif
        const orderId = event.data.orderId;
        if (orderId && myDriverId) {
          base44.entities.RideOrder.update(orderId, { status: "aceptado" }).catch(() => {});
          base44.entities.Driver.update(myDriverId, { status: "en_viaje" }).catch(() => {});
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [myDriverId]);

  // Re-alertar cuando la pantalla vuelve a estar activa (venía de background)
  // offeredOrderRef se usa para evitar stale closure sin necesidad de re-registrar el listener
  useEffect(() => {
    const ref = offeredOrderRef;
    const onVisible = () => {
      if (document.visibilityState === "visible" && ref.current) {
        playAlert();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS — con reintentos automáticos si falla
  const gpsIdRef = useRef(null);
  useEffect(() => {
    if (!myDriverId) return;
    if (!navigator.geolocation) return;

    const startWatch = () => {
      if (gpsIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsIdRef.current);
      }
      gpsIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          base44.entities.Driver.update(myDriverId, {
            current_lat: pos.coords.latitude,
            current_lng: pos.coords.longitude,
          }).catch(() => {});
        },
        (err) => {
          // Si el GPS falla, reintentar en 5s
          console.warn("GPS error:", err.code, err.message);
          setTimeout(startWatch, 5000);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000,
        }
      );
    };

    startWatch();

    // Re-iniciar GPS cuando la página vuelve a primer plano (background → foreground)
    const onVisible = () => {
      if (document.visibilityState === "visible") startWatch();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (gpsIdRef.current !== null) navigator.geolocation.clearWatch(gpsIdRef.current);
    };
  }, [myDriverId]);

  // ── Tiempo real: suscripciones en lugar de polling ────────────────────────
  const { drivers } = useRealtimeDrivers();
  const { orders } = useRealtimeOrders({ limit: 50 });

  // Wake Lock — mantiene la pantalla activa mientras el chofer está en servicio
  useWakeLock(!!myDriverId);

  // Alertas de mensajes entrantes (operador → este chofer)
  const { pendingMessages, dismissMessage } = useDriverMessageAlert(myDriverId || null);

  // Estado local optimista — se sobreescribe con datos reales cuando llegan
  const [localOverride, setLocalOverride] = useState(null);

  const myDriverRaw = drivers.find(d => d.id === myDriverId);
  // Cuando llegan datos reales de la suscripción, limpiar override si ya coinciden
  useEffect(() => {
    if (!localOverride || !myDriverRaw) return;
    if (myDriverRaw.status === localOverride.status && myDriverRaw.current_base === localOverride.current_base) {
      setLocalOverride(null);
    }
  }, [myDriverRaw?.status, myDriverRaw?.current_base]);

  const myDriver = myDriverRaw
    ? { ...myDriverRaw, ...(localOverride || {}) }
    : null;

  const activeOrder = orders.find(o => o.driver_id === myDriverId && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
  const offeredOrder = orders.find(o => o.driver_id === myDriverId && o.status === "ofrecido");
  // Broadcast: pedido pendiente que este chofer no rechazó (solo si está libre y en base)
  const broadcastOrder = myDriver?.status === "disponible" && myDriver?.current_base && !activeOrder && !offeredOrder
    ? orders.find(o => o.status === "pendiente" && !o.driver_id && o.zone && !dismissedBroadcasts.includes(o.id))
    : null;

  // Inform SW which driver is active
  useEffect(() => {
    notifySW({ type: "SET_DRIVER", driverId: myDriverId || null });
  }, [myDriverId]);

  // Alert on new offer (audio + SW notification) — repeat every 4s
  useEffect(() => {
    offeredOrderRef.current = offeredOrder || null;
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

  // Alerta de audio al recibir un broadcast nuevo
  useEffect(() => {
    if (broadcastOrder && broadcastOrder.id !== prevBroadcastId.current) {
      prevBroadcastId.current = broadcastOrder.id;
      playAlert();
    }
    if (!broadcastOrder) prevBroadcastId.current = null;
  }, [broadcastOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateOrder = useMutation({
    mutationFn: ({ id, data }) => base44.entities.RideOrder.update(id, data),
  });
  const updateDriver = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Driver.update(id, data),
  });

  const handleAccept = () => {
    setLocalOverride({ status: "en_viaje" });
    updateOrder.mutate({ id: offeredOrder.id, data: { status: "aceptado" } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };
  const handleReject = async () => {
    // La suscripción en tiempo real propagará el cambio automáticamente a todos los dispositivos
    const currentOrder = { ...offeredOrder, offered_driver_ids: [...(offeredOrder.offered_driver_ids || []), myDriverId] };
    await reassignAfterReject(currentOrder, drivers, []);
    // No necesita invalidateQueries — la suscripción actualiza instantáneamente
  };
  const handleStatusChange = (newStatus) => {
    updateOrder.mutate({ id: activeOrder.id, data: { status: newStatus } });
    if (newStatus === "completado") {
      setLocalOverride({ status: "disponible", current_base: null });
      updateDriver.mutate({ id: myDriverId, data: { status: "disponible", queue_entered_at: new Date().toISOString() } });
    }
  };
  const handleEnterBase = () => {
    setLocalOverride({ current_base: selectedBase, status: "disponible" });
    updateDriver.mutate({
      id: myDriverId,
      data: { current_base: selectedBase, status: "disponible", queue_entered_at: new Date().toISOString() },
    });
  };
  const handleChangeBase = (newBase) => {
    setLocalOverride({ current_base: newBase, status: "disponible" });
    updateDriver.mutate({
      id: myDriverId,
      data: { current_base: newBase, status: "disponible", queue_entered_at: new Date().toISOString() },
    });
  };
  const handleTakeOrder = (order) => {
    setLocalOverride({ status: "en_viaje" });
    updateOrder.mutate({ id: order.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  const handleGoOffService = () => {
    setLocalOverride({ status: "no_disponible", current_base: null });
    updateDriver.mutate({ id: myDriverId, data: { status: "no_disponible", current_base: null } });
  };

  const handleGoOnService = () => {
    setLocalOverride({ status: "disponible", current_base: null });
    updateDriver.mutate({ id: myDriverId, data: { status: "disponible", current_base: null, queue_entered_at: null } });
  };

  const handleBroadcastAccept = (order) => {
    setLocalOverride({ status: "en_viaje" });
    updateOrder.mutate({ id: order.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  const handleBroadcastReject = (order) => {
    const updated = [...dismissedBroadcasts, order.id];
    setDismissedBroadcasts(updated);
    localStorage.setItem(`dismissed_bc_${myDriverId}`, JSON.stringify(updated));
  };

  // Count unread messages for badge
  const unreadCount = (() => {
    // We don't fetch messages here; badge is shown in DriverMessages component
    return 0;
  })();

  // Timeout de carga: si después de 8s no hay datos, volver al login
  const [loadTimeout, setLoadTimeout] = useState(false);
  useEffect(() => {
    if (!myDriverId || myDriverRaw) { setLoadTimeout(false); return; }
    const t = setTimeout(() => setLoadTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [myDriverId, myDriverRaw]);

  // Show login if no driver selected, driver not found after load, or timeout
  if (!myDriverId || (!myDriverRaw && (drivers.length > 0 || loadTimeout))) {
    return (
      <LoginScreen
        drivers={drivers}
        onSelect={(id, isFirstTime) => {
          setMyDriverId(id);
          localStorage.setItem("my_driver_id", id);
          setLoadTimeout(false);
          if (isFirstTime) {
            setShowSetupGuide(true);
            localStorage.setItem(`setup_done_${id}`, "1");
          }
        }}
      />
    );
  }

  // Loading state — mostrar spinner mientras llegan los datos (máx 8s)
  if (!myDriverRaw) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Conectando...</p>
          <button
            className="text-xs text-gray-600 underline"
            onClick={() => { localStorage.removeItem("my_driver_id"); setMyDriverId(""); }}
          >
            Volver al inicio
          </button>
        </div>
      </div>
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
          <button
            className="p-2 rounded-xl bg-gray-700/50 text-gray-400"
            onClick={() => setShowSetupGuide(true)}
            title="Ayuda de configuración"
          >
            <HelpCircle className="w-4 h-4" />
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
      {broadcastOrder && !offeredOrder && (
        <BroadcastAlert
          order={broadcastOrder}
          onAccept={() => handleBroadcastAccept(broadcastOrder)}
          onReject={() => handleBroadcastReject(broadcastOrder)}
        />
      )}

      {showMessages && myDriver && (
        <DriverMessages driver={myDriver} onClose={() => setShowMessages(false)} />
      )}

      {showSetupGuide && (
        <DriverSetupGuide onClose={() => setShowSetupGuide(false)} />
      )}

      {/* Bloqueante: se muestra de a uno, el más antiguo primero */}
      {pendingMessages.length > 0 && !showMessages && (
        <DriverMessageModal
          message={pendingMessages[0]}
          onDismiss={() => dismissMessage(pendingMessages[0].id)}
        />
      )}
    </div>
  );
}