import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
// Tiempo real — sin polling
import { Button } from "@/components/ui/button";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeDrivers } from "@/hooks/useRealtimeDrivers";
import { useWakeLock } from "@/hooks/useWakeLock";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Phone, CheckCircle2, XCircle, Navigation, Car, Clock, LogIn, Bell, List, ArrowRightLeft, MessageCircle, PowerOff, Wifi, DollarSign, Timer, HelpCircle, AlertCircle, BarChart2, Zap } from "lucide-react";
import { haversineMetros } from "@/hooks/useTarifaConfig";
import { withRetry } from "@/lib/retryFetch";
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
import RideMap from "@/components/map/RideMap";
import { BASES, reassignAfterReject } from "@/lib/dispatchLogic";
import InstallBanner from "@/components/driver/InstallBanner";
import DriverMessages from "@/components/driver/DriverMessages";
import DriverMessageModal from "@/components/driver/DriverMessageModal";
import { useDriverMessageAlert } from "@/hooks/useDriverMessageAlert";
import DriverSetupGuide from "@/components/driver/DriverSetupGuide";
import DriverStats from "@/components/driver/DriverStats";
import DailyStats from "@/components/driver/DailyStats";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import BatteryOptimizationGuide from "@/components/driver/BatteryOptimizationGuide";
import OcasionalMeter from "@/components/driver/OcasionalMeter";

const debugArray = (arr, name) => {
  if (!Array.isArray(arr)) {
    console.error(`[CRITICAL ERROR] ${name} is NOT an array! Type: ${typeof arr}. Value:`, arr);
    return [];
  }
  return arr;
};

// ── Audio & Notifications ─────────────────────────────────────────────────────

let isKeepingAlive = false;
let audioCtx = null;
let alarmAudioElement = null;
let silentLoopElement = null;
let keepAliveInterval = null;

function getAudioCtx() {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function unlockAudio() {
  // Intentar reanudar siempre, no solo la primera vez
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();

    if (!isKeepingAlive) {
      isKeepingAlive = true;
      
      // 1. Oscilador inaudible infinito (hace que WebAudio nunca duerma)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      // 2. Audio HTML5 silencioso continuo
      if (!silentLoopElement) {
        silentLoopElement = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
        silentLoopElement.loop = true;
      }
      
      silentLoopElement.play().then(() => {
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: '🟢 Esperando Viajes',
            artist: 'Remises Concepción',
            album: 'Sistema de Despacho Activo'
          });
          navigator.mediaSession.playbackState = 'playing';
        }
      }).catch(() => {});

      // 3. Ping agresivo cada 3 segundos
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAliveInterval = setInterval(() => {
        if (ctx.state === "suspended") ctx.resume();
        if (silentLoopElement.paused) silentLoopElement.play().catch(() => {});
      }, 3000);
    }
    
    // Preparar alarma
    if (!alarmAudioElement) {
      alarmAudioElement = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      alarmAudioElement.loop = true;
    }
    alarmAudioElement.play().then(() => alarmAudioElement.pause()).catch(() => {});
  } catch (_) {}
}

function playAlert() {
  // Si estamos en la app Nativa, el sonido lo maneja Android de forma nativa
  if (Capacitor.isNativePlatform()) return;

  try { navigator.vibrate?.([500, 200, 500, 200, 1000, 300, 500]); } catch (_) {}
  
  // Alarma HTML5 (suena más fuerte y sortea bloqueos de background mejor)
  try {
    if (alarmAudioElement) alarmAudioElement.play().catch(() => {});
  } catch (_) {}

  // Alarma WebAudio (fallback)
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
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

function stopAlert() {
  if (Capacitor.isNativePlatform()) return; // Android lo para nativamente
  try {
    if (alarmAudioElement) {
      alarmAudioElement.pause();
      alarmAudioElement.currentTime = 0;
    }
  } catch (_) {}
}

// Request notification permission and send system notification
async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch (e) {
    console.warn("Notification permission error", e);
  }
}

function sendSystemNotification(order) {
  // Delegamos al SW para que la notificación funcione en segundo plano
  // Si no hay SW activo, fallback a Notification API directa
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) return; // SW lo maneja
  } catch(e) {}
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

const getDeviceId = () => {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem("device_id", id);
  }
  return id;
};

const getSessionToken = () => {
  let token = localStorage.getItem("session_token");
  if (!token) {
    token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem("session_token", token);
  }
  localStorage.setItem("session_login_time", Date.now().toString());
  return token;
};

const STATUS_CONFIG = {
  ofrecido:  { label: "Nuevo Viaje",    bg: "bg-amber-500"  },
  aceptado:  { label: "Aceptado",       bg: "bg-blue-500"   },
  en_camino: { label: "En Camino",      bg: "bg-purple-500" },
  en_viaje:  { label: "En Viaje",       bg: "bg-cyan-500"   },
  completado:{ label: "Completado",     bg: "bg-green-500"  },
};

// ── Login screen ──────────────────────────────────────────────────────────────
function LoginScreen({ drivers, driversError, onSelect, savedDriverId, onClearSaved = () => {} }) {
  // step: 'phone' | 'create_pin' | 'enter_pin' | 'forgot_sent'
  const [step, setStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [foundDriver, setFoundDriver] = useState(null);
  const [error, setError] = useState("");
  const [remember, setRemember] = useState(true);
  const [showChangeUser, setShowChangeUser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gpsStatus, setGpsStatus] = useState(null);

  const safeDriversList = Array.isArray(drivers) ? drivers : [];
  const savedDriver = savedDriverId && Array.isArray(safeDriversList) ? debugArray(safeDriversList, 'safeDriversList').find(d => d.id === savedDriverId) : null;

  const requestGps = () => {
    if (!navigator.geolocation) { setGpsStatus("denied"); return; }
    navigator.geolocation.getCurrentPosition(
      () => setGpsStatus("ok"),
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handlePhoneSubmit = async () => {
    await requestNotificationPermission();
    const normalized = phone.replace(/\s|-|\(|\)/g, "");
    if (!normalized) { setError("Ingresá tu número de celular"); return; }
    const found = debugArray(safeDriversList, 'safeDriversList').find(d => {
      const dp = (d.phone || "").replace(/\s|-|\(|\)/g, "");
      // Exigir al menos 6 dígitos para búsquedas parciales y verificar ambos lados para evitar que un teléfono corto como "3" coincida con "3442640443"
      const isPartialMatch = normalized.length >= 6 && dp.length >= 6 && (dp.endsWith(normalized) || normalized.endsWith(dp));
      return dp === normalized || isPartialMatch;
    });
    if (!found) {
      setError("No se encontró ningún chofer con ese número. Verificá con el operador.");
      return;
    }
    setFoundDriver(found);
    setError("");
    // Si no tiene PIN → crear uno; si tiene → ingresar
    if (!found.pin) {
      setStep("create_pin");
    } else {
      setStep("enter_pin");
    }
  };

  const handleCreatePin = async () => {
    await requestNotificationPermission();
    if (pin.length < 4) { setError("El PIN debe tener al menos 4 dígitos"); return; }
    if (!/^\d+$/.test(pin)) { setError("El PIN solo puede contener números"); return; }
    if (pin !== pinConfirm) { setError("Los PINs no coinciden"); return; }
    
    setLoading(true);
    try {
      const sessionToken = getSessionToken();
      await base44.entities.Driver.update(foundDriver.id, { pin, current_session_token: sessionToken });
      unlockAudio();
      const isOp = typeof sessionStorage !== "undefined" && sessionStorage.getItem("local_operator") !== null;
      if (remember) {
        if (!isOp) localStorage.setItem("remembered_driver_id", foundDriver.id);
        sessionStorage.setItem("remembered_driver_id", foundDriver.id);
      } else {
        localStorage.removeItem("remembered_driver_id");
        sessionStorage.removeItem("remembered_driver_id");
      }
      onSelect(foundDriver.id, !isOp && !localStorage.getItem(`setup_done_${foundDriver.id}`));
    } catch (_) {
      setError("Error al guardar el PIN. Intentá de nuevo.");
    }
    setLoading(false);
  };

  const handlePinLogin = async () => {
    await requestNotificationPermission();
    if (!pin) { setError("Ingresá tu PIN"); return; }
    if (pin !== foundDriver.pin) { setError("PIN incorrecto"); return; }
    
    setLoading(true);
    try {
      const sessionToken = getSessionToken();
      await base44.entities.Driver.update(foundDriver.id, { current_session_token: sessionToken });
      unlockAudio();
      const isOp = typeof sessionStorage !== "undefined" && sessionStorage.getItem("local_operator") !== null;
      if (remember) {
        if (!isOp) localStorage.setItem("remembered_driver_id", foundDriver.id);
        sessionStorage.setItem("remembered_driver_id", foundDriver.id);
      } else {
        localStorage.removeItem("remembered_driver_id");
        sessionStorage.removeItem("remembered_driver_id");
      }
      onSelect(foundDriver.id, !isOp && !localStorage.getItem(`setup_done_${foundDriver.id}`));
    } catch (_) {
      setError("Error al conectar. Intentá de nuevo.");
    }
    setLoading(false);
  };

  const handleForgotPin = async () => {
    // Genera un PIN temporal de 4 dígitos y lo envía como mensaje interno
    const tempPin = String(Math.floor(1000 + Math.random() * 9000));
    setLoading(true);
    try {
      await base44.entities.Driver.update(foundDriver.id, { pin: tempPin });
      await base44.entities.Message.create({
        from_type: "operador",
        from_name: "Sistema",
        to_driver_id: foundDriver.id,
        driver_id: foundDriver.id,
        content: `🔑 Tu nuevo PIN de acceso es: ${tempPin}\nCambialo la próxima vez que ingreses desde Ajustes.`,
        read: false,
      });
      setStep("forgot_sent");
      setError("");
    } catch (_) {
      setError("Error al enviar el PIN. Intentá de nuevo.");
    }
    setLoading(false);
  };

  const headerLogo = (
    <div className="text-center space-y-2">
      <img
        src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg"
        alt="Remises Concepción"
        className="w-24 h-24 rounded-3xl mx-auto object-cover shadow-xl"
      />
      <h1 className="text-3xl font-bold text-white">Remises Concepción</h1>
      <p className="text-gray-400">App del Chófer</p>
    </div>
  );

  // Pantalla acceso rápido (chofer recordado)
  if (savedDriver && !showChangeUser) {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="w-full max-w-sm space-y-6">
          {headerLogo}
          <div className="bg-gray-900 rounded-2xl p-5 space-y-4 border border-gray-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Último chofer</p>
            <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-sm">{(savedDriver.name || "C").charAt(0)}</span>
              </div>
              <div>
                <p className="font-semibold text-white">{savedDriver.name || "Chofer"}</p>
                <p className="text-xs text-gray-400 font-mono">{savedDriver.vehicle_plate}</p>
              </div>
            </div>
            {error && <p className="text-red-400 text-xs text-center pb-2">{error}</p>}
            <button
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-base py-3.5 rounded-xl transition-all disabled:opacity-50"
              onClick={async () => { 
                setLoading(true);
                try {
                  const sessionToken = getSessionToken();
                  await base44.entities.Driver.update(savedDriver.id, { current_session_token: sessionToken });
                  unlockAudio(); 
                  onSelect(savedDriver.id, false); 
                } catch (e) {
                  setError("Error de red.");
                }
                setLoading(false);
              }}
            >
              <LogIn className="inline w-4 h-4 mr-2" />
              Entrar como {(savedDriver.name || "Chofer").split(" ")[0]}
            </button>
            <button
              className="w-full text-gray-500 text-sm underline py-1"
              onClick={() => { onClearSaved(); setShowChangeUser(true); }}
            >
              Cambiar de usuario
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla PIN enviado
  if (step === "forgot_sent") {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="w-full max-w-sm space-y-6">
          {headerLogo}
          <div className="bg-gray-900 rounded-2xl p-5 space-y-4 border border-gray-800 text-center">
            <div className="w-16 h-16 rounded-full bg-green-900/40 flex items-center justify-center mx-auto">
              <MessageCircle className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-white font-semibold">PIN enviado por mensaje</p>
            <p className="text-gray-400 text-sm">Se envió un PIN temporal al chat de la app. Ingresá a la app y revisá tus mensajes del operador.</p>
            <button
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl"
              onClick={() => { setStep("enter_pin"); setPin(""); setError(""); }}
            >
              Ingresar PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla ingresar PIN
  if (step === "enter_pin") {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="w-full max-w-sm space-y-6">
          {headerLogo}
          <div className="bg-gray-900 rounded-2xl p-5 space-y-4 border border-gray-800">
            <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xs">{foundDriver?.name?.charAt(0)}</span>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{foundDriver?.name}</p>
                <p className="text-xs text-gray-500">{foundDriver?.vehicle_plate}</p>
              </div>
            </div>
            <p className="text-sm font-semibold text-gray-300">Ingresá tu PIN</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handlePinLogin()}
              placeholder="••••"
              className="w-full bg-gray-800 border border-gray-700 text-white text-2xl rounded-xl px-4 py-3 outline-none focus:border-blue-500 tracking-[0.5em] text-center"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <div
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${remember ? "bg-blue-600 border-blue-600" : "border-gray-600 bg-transparent"}`}
                onClick={() => setRemember(r => !r)}
              >
                {remember && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
              </div>
              <span className="text-sm text-gray-400">Recordar en este dispositivo</span>
            </label>
            <button
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-base py-3.5 rounded-xl transition-all"
              onClick={handlePinLogin}
            >
              <LogIn className="inline w-4 h-4 mr-2" /> Ingresar
            </button>
            <button
              disabled={loading}
              className="w-full text-gray-500 text-sm underline py-1 disabled:opacity-50"
              onClick={handleForgotPin}
            >
              {loading ? "Enviando..." : "Olvidé mi PIN — enviar nuevo por mensaje"}
            </button>
            <button
              className="w-full text-gray-600 text-xs underline py-1"
              onClick={() => { setStep("phone"); setPhone(""); setPin(""); setFoundDriver(null); setError(""); }}
            >
              ← Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla crear PIN (primer acceso)
  if (step === "create_pin") {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="w-full max-w-sm space-y-6">
          {headerLogo}
          <div className="bg-gray-900 rounded-2xl p-5 space-y-4 border border-gray-800">
            <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-xl">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xs">{foundDriver?.name?.charAt(0)}</span>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">{foundDriver?.name}</p>
                <p className="text-xs text-gray-500">Primer acceso — creá tu PIN</p>
              </div>
            </div>
            <p className="text-sm text-gray-400">Elegí un PIN numérico de 4 a 6 dígitos para proteger tu cuenta.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
              placeholder="PIN (4-6 dígitos)"
              className="w-full bg-gray-800 border border-gray-700 text-white text-2xl rounded-xl px-4 py-3 outline-none focus:border-blue-500 tracking-[0.5em] text-center"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinConfirm}
              onChange={e => { setPinConfirm(e.target.value.replace(/\D/g, "")); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handleCreatePin()}
              placeholder="Repetí el PIN"
              className="w-full bg-gray-800 border border-gray-700 text-white text-2xl rounded-xl px-4 py-3 outline-none focus:border-blue-500 tracking-[0.5em] text-center"
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-base py-3.5 rounded-xl transition-all disabled:opacity-50"
              onClick={handleCreatePin}
            >
              {loading ? "Guardando..." : "Crear PIN e Ingresar"}
            </button>
            <button
              className="w-full text-gray-600 text-xs underline py-1"
              onClick={() => { setStep("phone"); setPhone(""); setPin(""); setPinConfirm(""); setFoundDriver(null); setError(""); }}
            >
              ← Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla ingreso por teléfono (default)
  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm space-y-6">
        {headerLogo}

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

        {/* Ingreso por número de celular */}
        <div className="bg-gray-900 rounded-2xl p-5 space-y-4 border border-gray-800">
          <p className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Phone className="w-4 h-4" /> Ingresá tu número de celular
          </p>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={e => { setPhone(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && handlePhoneSubmit()}
            placeholder="Ej: 3442 123456"
            className="w-full bg-gray-800 border border-gray-700 text-white text-lg rounded-xl px-4 py-3 outline-none focus:border-blue-500 placeholder-gray-600 tracking-wider"
          />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-base py-3.5 rounded-xl transition-all"
            onClick={handlePhoneSubmit}
          >
            <LogIn className="inline w-4 h-4 mr-2" />
            Continuar
          </button>
          
          <button
            className="w-full text-xs text-gray-500 underline py-2 mt-2"
            onClick={() => {
              if ('caches' in window) caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
              navigator.serviceWorker?.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
              window.location.reload(true);
            }}
          >
            ¿Problemas para entrar? Toca aquí para actualizar
          </button>

          {safeDriversList.length === 0 && !driversError && (
            <div className="text-center">
              <p className="text-xs text-gray-600">No hay chóferes registrados. Pedile al operador que te agregue.</p>
              {/* DEBUG INFO */}
              <p className="text-[10px] text-gray-500 mt-2 break-all">AppID: {base44.appId || "N/A"}</p>
            </div>
          )}
          {driversError && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-3 text-center">
              <p className="text-red-400 text-xs font-bold mb-1">¡Error en la conexión!</p>
              <p className="text-red-300 text-[10px] break-words font-mono mb-2">{driversError}</p>
              <button 
                onClick={() => window.location.reload()} 
                className="bg-red-600 text-white text-xs px-4 py-1.5 rounded-lg font-bold"
              >
                Reintentar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Incoming ride alert ───────────────────────────────────────────────────────
function IncomingAlert({ order, onAccept, onReject }) {
  const [isValid, setIsValid] = useState(null); // null = checking
  const [timeLeft, setTimeLeft] = useState(null);
  const [totalTime, setTotalTime] = useState(null);

  useEffect(() => {
    let mounted = true;
    let timer;
    base44.entities.TarifaConfig.list().then(configs => {
      if (!mounted) return;
      const timeoutSecs = configs[0]?.tiempo_maximo_respuesta_segundos ?? 60;
      setTotalTime(timeoutSecs);
      
      const updateTimer = () => {
        const elapsed = Math.floor((Date.now() - new Date(order.updated_date || Date.now()).getTime()) / 1000);
        const remaining = Math.max(0, timeoutSecs - elapsed);
        setTimeLeft(remaining);
        if (remaining <= 0) clearInterval(timer);
      };
      
      updateTimer();
      timer = setInterval(updateTimer, 1000);
    }).catch(() => {
      if (mounted) {
        setTotalTime(60);
        setTimeLeft(60);
      }
    });
    return () => { 
      mounted = false; 
      if (timer) clearInterval(timer);
    };
  }, [order.updated_date]);

  useEffect(() => {
    let mounted = true;
    base44.entities.RideOrder.get(order.id).then(fresh => {
      if (mounted) {
        if (fresh && fresh.status === 'ofrecido') {
          setIsValid(true);
        } else {
          setIsValid(false);
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      }
    }).catch(() => {
      if (mounted) setIsValid(true);
    });
    return () => { mounted = false; };
  }, [order.id]);

  if (isValid === false) return null;
  if (isValid === null) return <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center"><div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-end justify-center p-4 pb-8 animate-in fade-in slide-in-from-bottom-8 duration-300" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-amber-500 px-5 py-4 flex items-center gap-3 animate-pulse">
          <img 
            src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" 
            alt="RC" 
            className="w-10 h-10 rounded-xl object-cover border border-white/30 shadow-sm"
          />
          <div>
            <p className="font-bold text-white text-lg leading-tight">¡Nuevo Viaje!</p>
            <p className="text-amber-100 text-xs">Respondé antes de que se reasigne</p>
          </div>
          {timeLeft !== null && totalTime !== null && (
            <div className="bg-amber-600/20 px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5"><Timer className="w-3.5 h-3.5"/> Tiempo para responder</span>
              <span className={`font-bold font-mono ${timeLeft <= 10 ? 'text-red-500 animate-pulse' : 'text-amber-700'}`}>00:{String(timeLeft).padStart(2, '0')}</span>
            </div>
          )}
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
              <span className="text-2xl font-bold text-green-600">${Number(order.fare).toLocaleString()}</span>
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

// ── Broadcast alert (sin zona / primero en aceptar gana) ─────────────────────
function BroadcastAlert({ order, onAccept, onReject }) {
  const [isValid, setIsValid] = useState(null);

  useEffect(() => {
    let mounted = true;
    base44.entities.RideOrder.get(order.id).then(fresh => {
      if (mounted) {
        if (fresh && fresh.status === 'pendiente' && !fresh.driver_id) {
          setIsValid(true);
        } else {
          setIsValid(false);
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      }
    }).catch(() => {
      if (mounted) setIsValid(true);
    });
    return () => { mounted = false; };
  }, [order.id]);

  const cleanNotes = (order.notes || "").replace(/^\[BROADCAST\]\s*/, "").trim();

  if (isValid === false) return null;
  if (isValid === null) return <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm"></div>;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-end justify-center p-4 pb-8 animate-in fade-in slide-in-from-bottom-8 duration-300" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-orange-500 px-5 py-4 flex items-center gap-3 animate-pulse">
          <img 
            src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" 
            alt="RC" 
            className="w-10 h-10 rounded-xl object-cover border border-white/30 shadow-sm"
          />
          <div>
            <p className="font-bold text-white text-base leading-tight">📢 Viaje a todos los móviles</p>
            <p className="text-orange-100 text-xs font-semibold">⚡ El primero en aceptar lo lleva</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {order.zone && (
            <div className="bg-orange-50 rounded-xl px-3 py-2 text-xs text-orange-700 font-medium">
              Zona solicitada: {order.zone}
            </div>
          )}
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
              <span className="text-2xl font-bold text-green-600">${Number(order.fare).toLocaleString()}</span>
            </div>
          )}
          {cleanNotes && (
            <p className="text-sm text-gray-500 italic px-1">"{cleanNotes}"</p>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button size="lg" className="rounded-2xl h-14 bg-green-500 hover:bg-green-600 text-base font-bold gap-2 shadow-lg shadow-green-500/30" onClick={onAccept}>
              <CheckCircle2 className="w-5 h-5" /> Tomar
            </Button>
            <Button size="lg" variant="outline" className="rounded-2xl h-14 border-gray-200 text-gray-500 hover:bg-gray-50 text-base font-bold gap-2" onClick={onReject}>
              <XCircle className="w-5 h-5" /> Ignorar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Active ride screen ────────────────────────────────────────────────────────
function ActiveRideScreen({ order, driver, onStatusChange, onCancelRide }) {
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
      gpsWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
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
      }, () => {}, { enableHighAccuracy: true, maximumAge: 0 });
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
    <div className="flex-1 overflow-y-auto bg-gray-950">
      {/* Panel superior: info + acciones */}
      <div className="px-4 pt-4 pb-6 space-y-3">
        {/* Header estado */}
        <div className="flex items-center justify-between">
          <p className="font-bold text-white text-base">Viaje en Curso</p>
          <span className={`${cfg?.bg} text-white text-xs font-bold px-3 py-1 rounded-full`}>{cfg?.label}</span>
        </div>

        {/* Taxímetro en tiempo real — solo en_viaje */}
        {order.status === "en_viaje" && (
          <div className={`rounded-2xl p-4 flex items-center justify-between ${enEspera ? "bg-amber-500/20 border border-amber-500/30" : "bg-green-500/20 border border-green-500/30"}`}>
            <div className="flex items-center gap-2">
              {enEspera ? <Timer className="w-5 h-5 text-amber-400" /> : <Navigation className="w-5 h-5 text-green-400" />}
              <div>
                <p className="text-xs font-semibold text-gray-400">{enEspera ? "EN ESPERA" : "EN MOVIMIENTO"}</p>
                {metrosRecorridos > 0 && (
                  <p className="text-xs text-gray-500">{(metrosRecorridos / 1000).toFixed(2)} km</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Tarifa actual</p>
              <p className="text-2xl font-black text-green-400">${importeActual.toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Direcciones */}
        <div className="bg-gray-900 rounded-2xl p-3 space-y-2 border border-gray-800">
          <div className="flex items-start gap-3">
            <div className="w-4 h-4 rounded-full bg-green-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">RECOGIDA</p>
              <p className="font-semibold text-sm text-white">{order.pickup_address}</p>
            </div>
          </div>
          {order.dropoff_address && (
            <>
              <div className="ml-2 w-px h-3 bg-gray-700" />
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500">DESTINO</p>
                  <p className="font-semibold text-sm text-white">{order.dropoff_address}</p>
                </div>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 text-gray-500 text-xs pt-1 border-t border-gray-800">
            <Phone className="w-3 h-3" />
            <span>{order.client_name}</span>
            {(order.importe_estimado > 0) && (
              <span className="ml-auto font-semibold text-gray-400">${Math.round(order.importe_estimado).toLocaleString()} est.</span>
            )}
          </div>
        </div>

        {/* Botón navegación */}
        <button
          className="w-full h-11 rounded-2xl gap-2 border border-blue-500/40 text-blue-400 bg-blue-500/10 font-semibold text-sm flex items-center justify-center active:scale-95 transition-all"
          onClick={handleNavigate}
        >
          <Navigation className="w-4 h-4" />
          Navegar con Google Maps
        </button>

        {/* Botones de acción */}
        {order.status === "aceptado" && (
          <div className="space-y-2">
            <button className="w-full h-14 rounded-2xl gap-2 bg-purple-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg" onClick={() => onStatusChange("en_camino")}>
              <Navigation className="w-5 h-5" /> Saliendo a Buscar
            </button>
            <button className="w-full h-11 rounded-2xl gap-2 border border-red-500/40 text-red-400 bg-red-500/10 font-semibold text-sm flex items-center justify-center active:scale-95 transition-all" onClick={onCancelRide}>
              <XCircle className="w-4 h-4" /> Anular — volver a mi base
            </button>
          </div>
        )}
        {order.status === "en_camino" && (
          <button className="w-full h-14 rounded-2xl gap-2 bg-cyan-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg" onClick={() => onStatusChange("en_viaje")}>
            <Car className="w-5 h-5" /> Pasajero a Bordo
          </button>
        )}
        {order.status === "en_viaje" && (
          <button className="w-full h-14 rounded-2xl gap-2 bg-green-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg" onClick={handleCompletar}>
            <CheckCircle2 className="w-5 h-5" /> Terminar Viaje · ${importeActual.toLocaleString()}
          </button>
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
            {order.fare && <span className="font-bold text-green-600 text-lg">${Number(order.fare).toLocaleString()}</span>}
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
function IdleScreen({ driver, drivers, selectedBase, onBaseChange, onEnter, onChangeBase, onGoOffService, driverId, libreBlockedSegs = 0 }) {
  const [changingBase, setChangingBase] = useState(false);
  const [newBase, setNewBase] = useState("");

  const isInBase = driver.current_base && driver.status === "disponible";

  // Queue for current base
  const baseQueue = debugArray(drivers, 'drivers_in_IdleScreen')
    .filter(d => d.current_base === driver.current_base && d.status === "disponible")
    .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at));
  const myPosition = debugArray(baseQueue, 'baseQueue').findIndex(d => d.id === driver.id) + 1;

  if (changingBase) {
    return (
      <div className="flex-1 flex flex-col px-4 py-6 overflow-y-auto">
        <div className="text-center mb-4">
          <p className="text-xl font-bold text-gray-800">Cambiar de Base</p>
          <p className="text-gray-500 text-sm mt-1">Estás en: <span className="font-semibold text-gray-700">{driver.current_base}</span></p>
        </div>
        <div className="space-y-2 flex-1">
          {BASES.filter(b => b !== driver.current_base).map(b => (
            <button
              key={b}
              className={`w-full text-left px-4 py-4 rounded-2xl font-semibold text-base border-2 transition-all ${newBase === b ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-800 active:bg-gray-100"}`}
              onClick={() => setNewBase(b)}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-2 shrink-0">
          <Button
            className="w-full h-14 rounded-2xl text-base font-bold"
            disabled={!newBase}
            onClick={() => { onChangeBase(newBase); setChangingBase(false); setNewBase(""); }}
          >
            Moverme a {newBase || "una base"}
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
      <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
        {/* Panel superior: info + acciones */}
        <div className="shrink-0 px-4 pt-4 pb-3 space-y-3">
          {/* Estado y posición */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center relative">
                <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping absolute top-1.5 right-1.5" />
                <Clock className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="font-bold text-white text-base">En Posición</p>
                <p className="text-xs text-gray-400">📍 {driver.current_base}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-white">{myPosition}°</p>
              <p className="text-xs text-gray-500">de {baseQueue.length} en cola</p>
            </div>
          </div>

          {/* Cola compacta */}
          <div className="flex gap-1.5 flex-wrap">
            {baseQueue.map((d, i) => {
              const showModel = d.vehicle_model && d.vehicle_model.length < 10;
              return (
                <span
                  key={d.id}
                  className={`text-xs px-2.5 py-1 rounded-xl font-semibold ${d.id === driver.id ? "bg-green-500 text-white" : "bg-gray-800 text-gray-400"}`}
                >
                  {i + 1}.{showModel ? ` #${d.vehicle_model}` : ""} {(d.name || "Chofer").split(" ")[0]}
                </span>
              );
            })}
          </div>

          {/* Botones */}
          <div className="flex gap-2">
            <button
              className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl font-semibold text-sm transition-all ${libreBlockedSegs > 0 ? "bg-gray-800 text-gray-600 cursor-not-allowed" : "bg-gray-800 text-gray-300 active:scale-95"}`}
              onClick={() => !libreBlockedSegs && setChangingBase(true)}
              disabled={libreBlockedSegs > 0}
            >
              <ArrowRightLeft className="w-4 h-4" /> Cambiar Base
            </button>
            {libreBlockedSegs > 0 ? (
              <div className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-orange-500/20 border border-orange-500/30 text-orange-400 text-sm font-bold h-12">
                <Timer className="w-4 h-4" />
                {Math.floor(libreBlockedSegs / 60)}:{String(libreBlockedSegs % 60).padStart(2, "0")}
              </div>
            ) : (
              <button
                className="flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-400 font-semibold text-sm active:scale-95 transition-all"
                onClick={onGoOffService}
              >
                <PowerOff className="w-4 h-4" /> Salir
              </button>
            )}
          </div>

          <DailyStats driverId={driverId} />
        </div>

        {/* Mapa interactivo — ver compañeros y mi ubicación */}
        <div className="mx-4 mb-4 h-56 rounded-2xl overflow-hidden border border-gray-800 shadow-md">
          <RideMap 
            orders={[]} 
            drivers={drivers} 
            autoFit={false}
            centerOn={driver.current_lat && driver.current_lng ? [driver.current_lat, driver.current_lng] : null} 
            zoom={16} 
            className="h-full w-full" 
          />
        </div>
      </div>
    );
  }


  return (
    <div className="flex-1 flex flex-col px-4 py-6 overflow-y-auto">
      <div className="text-center mb-5">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
          <Car className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-xl font-bold text-gray-800">¿En qué base estás?</p>
        <p className="text-gray-500 text-sm mt-1">Tocá tu base para quedar en posición</p>
      </div>
      <div className="space-y-2 flex-1">
        {BASES.map(b => (
          <button
            key={b}
            className={`w-full text-left px-4 py-4 rounded-2xl font-semibold text-base border-2 transition-all ${selectedBase === b ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-gray-200 text-gray-800 active:bg-gray-100"}`}
            onClick={() => onBaseChange(b)}
          >
            {b}
          </button>
        ))}
      </div>
      <div className="mt-4 shrink-0">
        <Button
          className="w-full h-14 rounded-2xl text-base font-bold"
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
  
  // Desactivación condicional: Si es nativo, o si es un operador (para no pisar tabs), bloqueamos el SW web
  const isOperator = typeof sessionStorage !== "undefined" && sessionStorage.getItem("local_operator") !== null;
  if (Capacitor.isNativePlatform() || isOperator) {
    try {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.unregister())).catch(() => {});
    } catch(e) {}
    return null;
  }
  
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    // Forzar activación inmediata del nuevo SW si hay una actualización pendiente
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // Nuevo SW instalado — forzar skip waiting pero NO recargar automáticamente
          // para evitar que la app se resetee mientras el chofer está ingresando
          newWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
    return reg;
  } catch (_) { return null; }
}

function notifySW(message) {
  try {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage(message);
  } catch(e) {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DriverApp() {
  const queryClient = useQueryClient();
  const isOperator = typeof sessionStorage !== "undefined" && sessionStorage.getItem("local_operator") !== null;
  const [myDriverId, setMyDriverId] = useState(() => {
    if (isOperator) return sessionStorage.getItem("my_driver_id") || "";
    return sessionStorage.getItem("my_driver_id") || localStorage.getItem("my_driver_id") || "";
  });
  const [savedDriverId, setSavedDriverId] = useState(() => {
    if (isOperator) return sessionStorage.getItem("remembered_driver_id") || "";
    return sessionStorage.getItem("remembered_driver_id") || localStorage.getItem("remembered_driver_id") || "";
  });
  const [selectedBase, setSelectedBase] = useState("");
  const [showMessages, setShowMessages] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showBatteryGuide, setShowBatteryGuide] = useState(false);
  const [showOcasional, setShowOcasional] = useState(false);
  const [dismissedBroadcasts, setDismissedBroadcasts] = useState([]);
  const [loadTimeout, setLoadTimeout] = useState(false);
  // Bloqueo post-viaje: segundos restantes para poder ponerse libre
  const [libreBlockedSegs, setLibreBlockedSegs] = useState(0);
  // Base del viaje que acaba de completar (para volver ahí si anula)
  const lastRideBaseRef = useRef(null);
  const prevOfferedId = useRef(null);
  const offeredOrderRef = useRef(null);
  const prevBroadcastId = useRef(null);

  // Register SW and request notification permission on load
  useEffect(() => {
    registerSW();

    // Si la app fue abierta desde un tap de "Aceptar" en pantalla bloqueada
    const urlParams = new URLSearchParams(window.location.search);
    const autoAcceptOrderId = urlParams.get("accept");
    if (autoAcceptOrderId && myDriverId) {
      setLocalOverride({ status: "en_viaje" });
      updateOrder.mutate({ id: autoAcceptOrderId, data: { status: "aceptado" } });
      updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
      window.history.replaceState({}, "", "/driver-app");
    }
    const autoRejectOrderId = urlParams.get("reject");
    if (autoRejectOrderId && myDriverId) {
      Promise.all([
        base44.entities.RideOrder.get(autoRejectOrderId),
        base44.entities.Driver.list()
      ]).then(([order, allDrivers]) => {
         const currentOrder = { ...order, offered_driver_ids: [...(order.offered_driver_ids || []), myDriverId] };
         reassignAfterReject(currentOrder, allDrivers, []).catch(()=>{});
      });
      window.history.replaceState({}, "", "/driver-app");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep-alive: envía un ping al SW cada 25s para mantenerlo activo
  // y recibe PONG para confirmar que el SW sigue vivo. También actualiza presencia online.
  useEffect(() => {
    if (!myDriverId) return;
    const updatePresence = () => {
      base44.entities.Driver.update(myDriverId, { last_active: new Date().toISOString() }).catch(() => {});
    };
    updatePresence();
    const interval = setInterval(() => {
      notifySW({ type: "SW_PING" });
      updatePresence();
    }, 25000);
    return () => clearInterval(interval);
  }, [myDriverId]);

  // BroadcastChannel: el SW nos despierta cuando detecta que la app está dormida
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const bc = new BroadcastChannel("radiocab_wake");
    bc.onmessage = (e) => {
      if (e.data?.type === "WAKE_UP" && e.data.driverId === myDriverId) {
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
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

  // Escuchar mensajes del SW
  useEffect(() => {
    try {
      if (!("serviceWorker" in navigator)) return;
    } catch(e) { return; }
    const handler = (event) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === "SW_ACCEPT_ORDER" || (msg.type === "NOTIFICATION_ACTION" && msg.action === "accept")) {
        const orderId = msg.orderId || msg.payload?.orderId;
        if (orderId && myDriverId) {
          notifySW({ type: "ACK_ACCEPT_ORDER", orderId }); // Send ACK immediately so SW doesn't spawn a new tab
          setLocalOverride({ status: "en_viaje" });
          updateOrder.mutate({ id: orderId, data: { status: "aceptado" } });
          updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      }

      if (msg.type === "SW_REJECT_ORDER" || (msg.type === "NOTIFICATION_ACTION" && msg.action === "reject")) {
        const orderId = msg.orderId || msg.payload?.orderId;
        if (orderId && myDriverId) {
          notifySW({ type: "ACK_REJECT_ORDER", orderId }); // Send ACK
          setLocalOverride({ status: "disponible" });
          updateDriver.mutate({ id: myDriverId, data: { status: "disponible" } });
          Promise.all([
            base44.entities.RideOrder.get(orderId),
            base44.entities.Driver.list()
          ]).then(([order, allDrivers]) => {
             const currentOrder = { ...order, offered_driver_ids: [...(order.offered_driver_ids || []), myDriverId] };
             reassignAfterReject(currentOrder, allDrivers, []).catch(()=>{});
          });
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      }

      // SW ping — respondemos para mantener el canal vivo
      if (msg.type === "SW_PING" || msg.type === "SW_ALIVE") {
        notifySW({ type: "KEEP_ALIVE" });
      }

      // SW nos pide reconectar (app estaba dormida)
      if (msg.type === "RECONNECT") {
        // Reconectar forzando una recarga del estado
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [myDriverId]);

  // Re-alertar cuando la pantalla vuelve a estar activa y REFORZAR audio
  useEffect(() => {
    const ref = offeredOrderRef;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        unlockAudio(); // Reforzar el lock de audio al ver la app
        if (ref.current) {
          base44.entities.RideOrder.get(ref.current.id).then(fresh => {
             if (fresh && fresh.status === 'ofrecido') {
                 playAlert();
             } else {
                 window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
             }
          }).catch(() => {
             playAlert();
          });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS — nativo en segundo plano (Capacitor) o Web (HTML5)
  const gpsIdRef = useRef(null);
  useEffect(() => {
    if (!myDriverId) return;

    const startNativeBackgroundTracking = async () => {
      try {
        const watcherId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "La app está activa buscando viajes.",
            backgroundTitle: "Remises Concepción Activo",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10
          },
          function callback(location, error) {
            if (error) {
              console.error("GPS Nativo Error:", error);
              return;
            }
            if (location) {
              withRetry(() => base44.entities.Driver.update(myDriverId, {
                current_lat: location.latitude,
                current_lng: location.longitude,
              })).catch(() => {});
            }
          }
        );
        gpsIdRef.current = watcherId;
      } catch(e) {
        console.error("Error iniciando GPS nativo", e);
      }
    };

    const startWebWatch = () => {
      if (!navigator.geolocation) return;
      if (gpsIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsIdRef.current);
      }
      gpsIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          withRetry(() => base44.entities.Driver.update(myDriverId, {
            current_lat: pos.coords.latitude,
            current_lng: pos.coords.longitude,
          })).catch(() => {});
        },
        (err) => {
          console.warn("GPS error:", err.code, err.message);
          setTimeout(startWebWatch, 5000);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    };

    if (Capacitor.isNativePlatform()) {
      startNativeBackgroundTracking();
    } else {
      startWebWatch();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && !Capacitor.isNativePlatform()) {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              base44.entities.Driver.update(myDriverId, {
                current_lat: pos.coords.latitude,
                current_lng: pos.coords.longitude,
              }).catch(() => {});
            },
            () => {},
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
          );
        }
        startWebWatch();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (Capacitor.isNativePlatform()) {
        if (gpsIdRef.current) {
           BackgroundGeolocation.removeWatcher({ id: gpsIdRef.current }).catch(()=>{});
        }
      } else {
        if (gpsIdRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsIdRef.current);
      }
    };
  }, [myDriverId]);

  // ── Tiempo real: suscripciones en lugar de polling ────────────────────────
  const { drivers, isLoading: driversLoading, error: driversError } = useRealtimeDrivers();
  const { orders } = useRealtimeOrders({ limit: 50 });

  // Sincronización agresiva de la UI cuando el teléfono se desbloquea / la app vuelve a primer plano
  useEffect(() => {
    const handleSync = () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    };
    window.addEventListener("radiocab_reconnect", handleSync);
    
    const onVis = () => {
      if (document.visibilityState === "visible") {
        handleSync();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    
    return () => {
      window.removeEventListener("radiocab_reconnect", handleSync);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [queryClient]);

  // Timeout de seguridad: si después de 8s sigue cargando, mostrar reintento
  useEffect(() => {
    if (!driversLoading) { setLoadTimeout(false); return; }
    const t = setTimeout(() => setLoadTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [driversLoading]);

  // Wake Lock — mantiene la pantalla activa mientras el chofer está en servicio
  useWakeLock(!!myDriverId);

  // Push subscription — registra este dispositivo para recibir notificaciones push reales
  usePushSubscription(myDriverId || null);

  // Alertas de mensajes entrantes (operador → este chofer)
  const { pendingMessages, dismissMessage } = useDriverMessageAlert(myDriverId || null);

  // Estado local optimista — se sobreescribe con datos reales cuando llegan
  const [localOverride, setLocalOverride] = useState(null);
  const clearOverrideTimerRef = useRef(null);

  const safeDrivers = Array.isArray(drivers) ? drivers : [];
  const safeOrders = Array.isArray(orders) ? orders : [];
  const myDriverRaw = debugArray(safeDrivers, 'safeDrivers').find(d => d.id === myDriverId);

  // Verificación de sesión única desactivada para permitir multi-dispositivo

  // Limpiar el override cuando los datos reales del servidor ya coinciden
  // Usamos un pequeño delay para evitar flash si la suscripción llega antes de lo esperado
  useEffect(() => {
    if (!localOverride || !myDriverRaw) return;
    const statusMatch = !('status' in localOverride) || myDriverRaw.status === localOverride.status;
    const baseMatch = !('current_base' in localOverride) || myDriverRaw.current_base === localOverride.current_base;
    if (statusMatch && baseMatch) {
      clearOverrideTimerRef.current = setTimeout(() => setLocalOverride(null), 500);
    }
    return () => clearTimeout(clearOverrideTimerRef.current);
  }, [myDriverRaw?.status, myDriverRaw?.current_base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge: datos del servidor + override local (el override gana hasta que el servidor confirme)
  const myDriver = myDriverRaw
    ? { ...myDriverRaw, ...(localOverride ?? {}) }
    : null;

  const activeOrder = debugArray(safeOrders, 'safeOrders').find(o => o.driver_id === myDriverId && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
  const offeredOrder = debugArray(safeOrders, 'safeOrders').find(o => o.driver_id === myDriverId && o.status === "ofrecido");
  // Broadcast: pedido pendiente (sin chofer asignado) que este chofer no rechazó — solo si está libre y en base
  const broadcastOrder = myDriver?.status === "disponible" && myDriver?.current_base && !activeOrder && !offeredOrder
    ? debugArray(safeOrders, 'safeOrders').find(o =>
        o.status === "pendiente" &&
        !o.driver_id &&
        (!Array.isArray(dismissedBroadcasts) ? false : !dismissedBroadcasts.includes(o.id))
      )
    : null;

  // Inform SW which driver is active + mostrar notificación persistente "En Servicio"
  useEffect(() => {
    notifySW({
      type: "SET_DRIVER",
      driverId: myDriverId || null,
      driverName: myDriver?.name || null,
    });
  }, [myDriverId, myDriver?.name]);

  // Iniciar/Detener el Foreground Service nativo según el estado del chofer
  // [REMOVIDO] - Causaba crashes nativos en Android 14 (SecurityException) al iniciar sin ForegroundServiceType.
  // El plugin @capacitor-community/background-geolocation ya se encarga de mantener un servicio en primer plano válido.

  // Mostrar guía de batería la primera vez que el chofer entra en servicio
  useEffect(() => {
    if (!myDriverId || !myDriverRaw) return;
    const alreadyDone = localStorage.getItem("battery_opt_done");
    const shownBefore = localStorage.getItem(`battery_guide_shown_${myDriverId}`);
    if (!alreadyDone && !shownBefore) {
      // Mostrar tras 3s de haber cargado la app para no interrumpir el flujo
      const t = setTimeout(() => {
        localStorage.setItem(`battery_guide_shown_${myDriverId}`, "1");
        setShowBatteryGuide(true);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [myDriverId, myDriverRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  // Configurar canal de notificaciones nativas de alta prioridad
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.requestPermissions().then((status) => {
        if (status.display === 'granted') {
          // Usamos un ID nuevo para forzar a Android a recrear el canal con máxima prioridad
          const channelConfig = {
            id: 'ride-alerts-urgent',
            name: 'Alertas de Viaje (Urgente)',
            description: 'Despierta la pantalla para viajes nuevos',
            importance: 5, // 5 = MAX (Heads-up / Burbuja)
            visibility: 1, // 1 = PUBLIC
            vibration: true,
            sound: 'default'
          };
          
          LocalNotifications.createChannel(channelConfig);
          PushNotifications.createChannel(channelConfig).catch(() => {}); // Aseguramos el mismo canal para FCM

          // Registramos los botones nativos sin emojis y con foreground: true
          LocalNotifications.registerActionTypes({
            types: [
              {
                id: 'RIDE_OFFER_ACTIONS',
                actions: [
                  { id: 'accept', title: 'ACEPTAR', foreground: true },
                  { id: 'reject', title: 'RECHAZAR', foreground: true, destructive: true }
                ]
              }
            ]
          });
        }
      });
      
      // Escuchar taps en notificaciones nativas
      LocalNotifications.addListener('localNotificationActionPerformed', (notificationAction) => {
        const orderId = notificationAction.notification.extra?.orderId;
        const actionId = notificationAction.actionId;
        if (orderId) {
          if (actionId === 'accept') {
            window.location.href = `/driver-app?accept=${orderId}`;
          } else if (actionId === 'reject') {
            window.location.href = `/driver-app?reject=${orderId}`;
          } else {
            window.location.href = `/driver-app`;
          }
        }
      });

      // Escuchar taps en notificaciones de Firebase (FCM)
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        const data = notification.notification.data || notification.notification.data?.payload || {};
        if (data.orderId || data.action === "open_messages") {
          // No hacemos un reload duro de la página web que recarga la UI desde cero.
          // En vez de eso, Capacitor ya trae la app al frente y nosotros forzamos la reconexión de datos.
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      });

      // Escuchar FCM (foreground/background)
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log("[FCM] Push recibido:", notification);
        const data = notification.data || notification.notification?.data || {};
        
        if (data.orderId) {
            base44.entities.RideOrder.get(data.orderId).then(fresh => {
                if (fresh && (fresh.status === 'ofrecido' || fresh.status === 'pendiente')) {
                    playAlert();
                }
                window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
            }).catch(() => {
                playAlert();
                window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
            });
        } else {
            // Si es un mensaje de chat u otra cosa sin orderId, NO disparamos la alarma de viaje.
            if (data.type === 'message' || data.action === 'open_messages' || data.type === 'NEW_MESSAGE') {
                try { navigator.vibrate?.([200, 100, 200]); } catch (_) {}
            }
            window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      });
    }
  }, []);

  const myDriverIdRef = useRef(myDriverId);
  useEffect(() => { myDriverIdRef.current = myDriverId; }, [myDriverId]);
  
  const myDriverRef = useRef(myDriver);
  useEffect(() => { myDriverRef.current = myDriver; }, [myDriver]);

  const dismissedBroadcastsRef = useRef(dismissedBroadcasts);
  useEffect(() => { dismissedBroadcastsRef.current = dismissedBroadcasts; }, [dismissedBroadcasts]);

  const alertIntervalRef = useRef(null);
  const broadcastIntervalRef = useRef(null);

  const evaluateAlerts = useCallback((incomingOrders) => {
    const dId = myDriverIdRef.current;
    const driver = myDriverRef.current;
    const dismissed = dismissedBroadcastsRef.current;
    if (!dId) return;

    const safeOrds = Array.isArray(incomingOrders) ? incomingOrders : [];
    const activeOrder = safeOrds.find(o => o.driver_id === dId && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
    const offered = safeOrds.find(o => o.driver_id === dId && o.status === "ofrecido");
    const broadcast = driver?.status === "disponible" && driver?.current_base && !activeOrder && !offered
      ? safeOrds.find(o => o.status === "pendiente" && !o.driver_id && (!dismissed || !dismissed.includes(o.id)))
      : null;

    offeredOrderRef.current = offered || null;

    // 1. Evaluate Offered
    if (offered) {
      if (offered.id !== prevOfferedId.current) {
        console.log("[Alert-Background] Verificando si el viaje ofrecido es real...");
        prevOfferedId.current = offered.id;
        base44.entities.RideOrder.get(offered.id).then(fresh => {
           if (fresh && fresh.status === 'ofrecido') {
              playAlert();
              if (Capacitor.isNativePlatform()) {
                console.log("[Alert-Background] Viaje ofrecido real.");
              } else {
                sendSystemNotification(offered);
                notifySW({ type: "SHOW_NOTIFICATION", order: offered });
              }
              clearInterval(alertIntervalRef.current);
              alertIntervalRef.current = setInterval(() => { playAlert(); }, 4000);
           } else {
              prevOfferedId.current = null;
              window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
           }
        }).catch(() => {
           playAlert();
           clearInterval(alertIntervalRef.current);
           alertIntervalRef.current = setInterval(() => { playAlert(); }, 4000);
        });
      }
    } else {
      if (prevOfferedId.current) {
        prevOfferedId.current = null;
        clearInterval(alertIntervalRef.current);
        stopAlert();
        if (Capacitor.isNativePlatform()) {
          LocalNotifications.cancel({ notifications: [{ id: 88888 }] });
        }
        if (!Capacitor.isNativePlatform()) notifySW({ type: "OFFER_CLEARED" });
      }
    }

    // 2. Evaluate Broadcast
    if (broadcast && !offered) {
      if (broadcast.id !== prevBroadcastId.current) {
        console.log("[Alert-Background] Verificando viaje broadcast...");
        prevBroadcastId.current = broadcast.id;
        base44.entities.RideOrder.get(broadcast.id).then(fresh => {
           if (fresh && fresh.status === 'pendiente' && !fresh.driver_id) {
              playAlert();
              if (!Capacitor.isNativePlatform()) {
                sendSystemNotification(broadcast);
              }
              clearInterval(broadcastIntervalRef.current);
              broadcastIntervalRef.current = setInterval(() => { playAlert(); }, 4000);
           } else {
              prevBroadcastId.current = null;
              window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
           }
        }).catch(() => {
           playAlert();
           clearInterval(broadcastIntervalRef.current);
           broadcastIntervalRef.current = setInterval(() => { playAlert(); }, 4000);
        });
      }
    } else {
      if (prevBroadcastId.current) {
        prevBroadcastId.current = null;
        clearInterval(broadcastIntervalRef.current);
        stopAlert();
        if (Capacitor.isNativePlatform()) {
          LocalNotifications.cancel({ notifications: [{ id: 77777 }] });
        }
      }
    }
  }, []);

  useEffect(() => {
    const handler = (e) => evaluateAlerts(e.detail);
    window.addEventListener('radiocab_force_alert_check', handler);
    return () => window.removeEventListener('radiocab_force_alert_check', handler);
  }, [evaluateAlerts]);

  useEffect(() => {
    evaluateAlerts(safeOrders);
  }, [safeOrders, myDriver?.status, myDriver?.current_base, dismissedBroadcasts, evaluateAlerts]);

  // Retries agresivos: reintenta hasta 15 veces, con backoff para sobrevivir a la reconexión de red al despertar
  const updateOrder = useMutation({
    mutationFn: ({ id, data }) => base44.entities.RideOrder.update(id, data),
    retry: 15,
    retryDelay: (attempt) => Math.min(1000 * 1.5 ** attempt, 10000),
  });
  const updateDriver = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Driver.update(id, data),
    retry: 15,
    retryDelay: (attempt) => Math.min(1000 * 1.5 ** attempt, 10000),
  });

  const handleAccept = () => {
    setLocalOverride({ status: "en_viaje" });
    updateOrder.mutate({ id: offeredOrder.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
    // Notificamos al backend para limpiar notificaciones
    base44.functions.invoke("sendPushNotification", {
      action: "native_accept",
      orderId: offeredOrder.id,
      driverId: myDriverId,
      driverName: myDriver?.name || "",
      base: myDriver?.current_base || ""
    }).catch(console.error);
  };
  const handleReject = async () => {
    const currentOrder = { ...offeredOrder, offered_driver_ids: [...(offeredOrder.offered_driver_ids || []), myDriverId] };
    
    // Regresamos al chofer a "disponible" ya que rechazó el viaje
    setLocalOverride({ status: "disponible" });
    updateDriver.mutate({ id: myDriverId, data: { status: "disponible" } });

    await reassignAfterReject(currentOrder, drivers, []);
    
    base44.entities.AuditLog.create({
      action: "rechazar_viaje",
      user_type: "chofer",
      user_name: myDriver?.name || "Chofer",
      details: `Rechazó el viaje de ${offeredOrder?.client_name || "Desconocido"}`
    }).catch(() => {});
  };
  // Cargar config de minutos de bloqueo post-viaje
  const tarifaMinutosRef = useRef(0);
  useEffect(() => {
    base44.entities.TarifaConfig.list().then(configs => {
      if (configs[0]) tarifaMinutosRef.current = configs[0].minutos_libre_post_viaje ?? 0;
    }).catch(() => {});
  }, []);

  // Countdown del bloqueo post-viaje
  useEffect(() => {
    if (libreBlockedSegs <= 0) return;
    const t = setInterval(() => {
      setLibreBlockedSegs(s => {
        if (s <= 1) { clearInterval(t); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [libreBlockedSegs > 0]);

  const handleStatusChange = (newStatus) => {
    updateOrder.mutate({ id: activeOrder.id, data: { status: newStatus } });
    if (newStatus === "completado") {
      // Guardar la base del viaje para poder volver si se anula
      lastRideBaseRef.current = activeOrder.assigned_base || myDriver?.current_base || null;
      const secs = (tarifaMinutosRef.current || 0) * 60;
      if (secs > 0) setLibreBlockedSegs(secs);
      setLocalOverride({ status: "disponible", current_base: null });
      updateDriver.mutate({ id: myDriverId, data: { status: "disponible", queue_entered_at: new Date().toISOString() } });
    }
  };
  const handleEnterBase = () => {
    const ts = new Date().toISOString();
    setLocalOverride({ current_base: selectedBase, status: "disponible", queue_entered_at: ts });
    updateDriver.mutate({
      id: myDriverId,
      data: { current_base: selectedBase, status: "disponible", queue_entered_at: ts },
    });
  };
  const handleChangeBase = (newBase) => {
    const ts = new Date().toISOString();
    setLocalOverride({ current_base: newBase, status: "disponible", queue_entered_at: ts });
    updateDriver.mutate({
      id: myDriverId,
      data: { current_base: newBase, status: "disponible", queue_entered_at: ts },
    });
  };
  const handleTakeOrder = (order) => {
    setLocalOverride({ status: "en_viaje" });
    updateOrder.mutate({ id: order.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  const handleGoOffService = () => {
    if (libreBlockedSegs > 0) return; // bloqueado
    setLocalOverride({ status: "no_disponible", current_base: null });
    updateDriver.mutate({ id: myDriverId, data: { status: "no_disponible", current_base: null } });
  };

  // Anular viaje aceptado: vuelve al principio de la base asignada
  const handleCancelRide = async () => {
    if (!activeOrder) return;
    const base = activeOrder.assigned_base || myDriver?.current_base || null;
    await updateOrder.mutateAsync({ id: activeOrder.id, data: { status: "cancelado", driver_id: null, driver_name: null } });
    
    base44.entities.AuditLog.create({
      action: "cancelar_viaje",
      user_type: "chofer",
      user_name: myDriver?.name || "Chofer",
      details: `Anuló el viaje de ${activeOrder.client_name}`
    }).catch(() => {});

    const ts = new Date(0).toISOString(); // timestamp en el pasado → queda primero en la cola
    setLocalOverride({ status: "disponible", current_base: base, queue_entered_at: ts });
    updateDriver.mutate({ id: myDriverId, data: { status: "disponible", current_base: base, queue_entered_at: ts } });
    setLibreBlockedSegs(0); // al anular no aplica bloqueo
  };

  const handleGoOnService = () => {
    setLocalOverride({ status: "disponible", current_base: null });
    updateDriver.mutate({ id: myDriverId, data: { status: "disponible", current_base: null, queue_entered_at: null } });
  };

  const handleBroadcastAccept = (order) => {
    setLocalOverride({ status: "en_viaje" });
    updateOrder.mutate({ id: order.id, data: { status: "aceptado", driver_id: myDriverId, driver_name: myDriver?.name, assigned_base: myDriver?.current_base } });
    updateDriver.mutate({ id: myDriverId, data: { status: "en_viaje" } });
    // Notificamos al backend para limpiar notificaciones
    base44.functions.invoke("sendPushNotification", {
      action: "native_accept",
      orderId: order.id,
      driverId: myDriverId,
      driverName: myDriver?.name || "",
      base: myDriver?.current_base || ""
    }).catch(console.error);
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

  // Show login if no driver selected
  if (!myDriverId) {
    // Mientras cargamos los choferes, mostrar un spinner liviano
    if (driversLoading) {
      return (
        <div className="h-[100dvh] bg-gray-950 flex items-center justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-400 text-sm">Cargando...</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-[100dvh] bg-gray-950" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
        <InstallBanner />
        <div className="flex-1 overflow-y-auto">
          <LoginScreen
            drivers={safeDrivers}
            driversError={driversError}
            savedDriverId={savedDriverId}
            onSelect={(id, isFirstTime) => {
              setMyDriverId(id);
              sessionStorage.setItem("my_driver_id", id);
              if (!isOperator) {
                localStorage.setItem("my_driver_id", id);
              }
              if (isFirstTime) {
                setShowSetupGuide(true);
                if (!isOperator) localStorage.setItem(`setup_done_${id}`, "1");
              }
            }}
            onClearSaved={() => {
              localStorage.removeItem("remembered_driver_id");
              localStorage.removeItem("my_driver_id");
              sessionStorage.removeItem("remembered_driver_id");
              sessionStorage.removeItem("my_driver_id");
              setSavedDriverId("");
              setMyDriverId("");
            }}
          />
        </div>
      </div>
    );
  }

  // Spinner mientras carga — cuando termina de cargar y no encontró al chofer, volver al login
  if (driversLoading || !myDriverRaw) {
    const driverWasDeleted = !driversLoading && safeDrivers.length > 0 && !myDriverRaw;
    const isTemporarilyEmpty = !driversLoading && safeDrivers.length === 0;

    return (
      <div className="h-[100dvh] bg-gray-950 flex items-center justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="text-center space-y-4 px-6">
          {(!loadTimeout && !driverWasDeleted) ? (
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center mx-auto">
              <span className="text-red-400 text-xl">⚠</span>
            </div>
          )}
          <p className="text-gray-400 text-sm">
            {driverWasDeleted ? "Perfil no encontrado o eliminado" : (loadTimeout || isTemporarilyEmpty) ? "Sin conexión — reconectando..." : "Conectando..."}
          </p>
          {(loadTimeout || isTemporarilyEmpty) && !driverWasDeleted && (
            <button
              className="w-full bg-blue-600 text-white text-sm font-bold py-3 rounded-xl"
              onClick={() => { setLoadTimeout(false); window.dispatchEvent(new CustomEvent('force-driver-refresh')); }}
            >
              Forzar Reconexión
            </button>
          )}
          <button
            className="text-xs text-gray-600 underline block mx-auto"
            onClick={() => { 
              localStorage.removeItem("my_driver_id"); 
              sessionStorage.removeItem("my_driver_id"); 
              localStorage.removeItem("remembered_driver_id");
              sessionStorage.removeItem("remembered_driver_id");
              setMyDriverId(""); 
            }}
          >
            {driverWasDeleted ? "Volver al inicio" : "Cancelar e ir al login"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-gray-950 flex flex-col max-w-md mx-auto relative overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }} onTouchStart={unlockAudio} onClick={unlockAudio}>
      <InstallBanner />

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <img
            src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg"
            alt="RC"
            className="w-9 h-9 rounded-xl object-cover"
          />
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
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-2 rounded-xl bg-red-600 hover:bg-red-700 text-white animate-pulse"
            onClick={() => {
              base44.entities.PanicAlert.create({
                driver_id: myDriverId,
                driver_name: myDriver.name,
                vehicle_plate: myDriver.vehicle_plate,
                current_lat: myDriver.current_lat,
                current_lng: myDriver.current_lng,
              });
              navigator.vibrate?.([500, 200, 500, 200, 500]);
            }}
            title="Activar alerta de pánico"
          >
            <AlertCircle className="w-4 h-4" />
          </button>
          <button
            className="p-2 rounded-xl bg-green-600/20 text-green-400"
            onClick={() => setShowStats(true)}
            title="Mis estadísticas"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          {myDriver.status !== "en_viaje" && (
            <button
              className="p-2 rounded-xl bg-yellow-500/20 text-yellow-400"
              onClick={() => setShowOcasional(true)}
              title="Viaje ocasional"
            >
              <Zap className="w-4 h-4" />
            </button>
          )}
          <button
            className="p-2 rounded-xl bg-blue-600/20 text-blue-400"
            onClick={() => {
              setShowMessages(true);
              // Parar alertas sonoras al abrir el chat
              debugArray(pendingMessages, 'pendingMessages').forEach(m => dismissMessage(m.id));
            }}
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
            ) : libreBlockedSegs > 0 ? (
              <div className="flex items-center gap-1 px-2 py-1 rounded-xl bg-orange-900/30 text-orange-400 text-xs font-bold">
                <Timer className="w-3.5 h-3.5" />
                {Math.floor(libreBlockedSegs / 60)}:{String(libreBlockedSegs % 60).padStart(2, "0")}
              </div>
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
            onClick={() => {
              localStorage.removeItem("my_driver_id");
              localStorage.removeItem("remembered_driver_id"); // Borramos para que no quede atrapado en el usuario equivocado
              sessionStorage.removeItem("my_driver_id");
              sessionStorage.removeItem("remembered_driver_id");
              setMyDriverId("");
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* Body */}
      {activeOrder ? (
        <ActiveRideScreen order={activeOrder} driver={myDriver} onStatusChange={handleStatusChange} onCancelRide={handleCancelRide} />
      ) : myDriver.status === "no_disponible" ? (
        <OffServiceScreen onGoOnService={handleGoOnService} />
      ) : (
        <IdleScreen
          driver={myDriver}
          drivers={safeDrivers}
          selectedBase={selectedBase}
          onBaseChange={setSelectedBase}
          onEnter={handleEnterBase}
          onChangeBase={handleChangeBase}
          onGoOffService={handleGoOffService}
          driverId={myDriverId}
          libreBlockedSegs={libreBlockedSegs}
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

      {showStats && myDriver && (
        <DriverStats driverId={myDriverId} driverName={myDriver.name} onClose={() => setShowStats(false)} />
      )}

      {/* Bloqueante: se muestra de a uno, el más antiguo primero */}
      {pendingMessages.length > 0 && !showMessages && (
        <DriverMessageModal
          message={pendingMessages[0]}
          onDismiss={() => dismissMessage(pendingMessages[0].id)}
        />
      )}

      {/* Guía de optimización de batería (Android) */}
      {showBatteryGuide && (
        <BatteryOptimizationGuide
          onClose={() => setShowBatteryGuide(false)}
          onDone={() => setShowBatteryGuide(false)}
        />
      )}

      {/* Taxímetro ocasional */}
      {showOcasional && (
        <OcasionalMeter onClose={() => setShowOcasional(false)} />
      )}
    </div>
  );
}