import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
// Tiempo real — sin polling
import { Button } from "@/components/ui/button";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { useRealtimeDrivers } from "@/hooks/useRealtimeDrivers";
import { useWakeLock } from "@/hooks/useWakeLock";
import { Badge } from "@/components/ui/badge";
import { MapPin, Phone, CheckCircle2, XCircle, Car, Clock, List, ArrowRightLeft, MessageCircle, PowerOff, Wifi, WifiOff, DollarSign, Timer, AlertCircle, BarChart2, Zap, Settings } from "lucide-react";
import { withRetry } from "@/lib/retryFetch";
import { createGpsStabilityFilter, GPS_LOCATION_EVENT } from "@/lib/gpsStability";
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import PullToRefresh from "@/components/ui/pull-to-refresh";
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

// Registrar el plugin nativo para evitar que Capacitor.Plugins.ForegroundService sea undefined y explote el .catch()
if (!Capacitor.Plugins.ForegroundService) {
  Capacitor.Plugins.ForegroundService = registerPlugin('ForegroundService');
}

import RideMap from "@/components/map/RideMap";
import { BASES, reassignAfterReject } from "@/lib/dispatchLogic";
import InstallBanner from "@/components/driver/InstallBanner";
import DriverMessages from "@/components/driver/DriverMessages";
import DriverMessageModal from "@/components/driver/DriverMessageModal";
import { useDriverMessageAlert } from "@/hooks/useDriverMessageAlert";
import DriverStats from "@/components/driver/DriverStats";
import DailyStats from "@/components/driver/DailyStats";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import BatteryOptimizationGuide from "@/components/driver/BatteryOptimizationGuide";
import OcasionalMeter from "@/components/driver/OcasionalMeter";
import ActiveRideScreen from "@/components/driver/ActiveRideScreen";
import { getDriverDisplay } from "@/lib/utils";

const debugArray = (arr, name) => {
  if (!Array.isArray(arr)) {
    console.error(`[CRITICAL ERROR] ${name} is NOT an array! Type: ${typeof arr}. Value:`, arr);
    return [];
  }
  return arr;
};

// ── Audio & Notifications ─────────────────────────────────────────────────────

function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  if (!isOffline) return null;
  return (
    <div className="bg-red-600 text-white text-center py-2 px-4 font-bold text-sm flex items-center justify-center gap-2 shrink-0 shadow-md z-[9999] relative">
      <WifiOff className="w-5 h-5 animate-pulse" /> Sin señal (Revisá tu 4G o WiFi)
    </div>
  );
}

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
  // En Android nativo, el OS ya maneja el audio en segundo plano. Esto solo causa cuelgues.
  if (Capacitor.isNativePlatform()) return;
  
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
  // En Android nativo, Java ya reproduce el sonido `raw`. No pisar el audio ni vibrar desde la web.
  if (Capacitor.isNativePlatform()) return;

  if (Date.now() < window._lastAlertStopTime + 1000) return;
  try { navigator.vibrate?.([500, 200, 500, 200, 1000, 300, 500]); } catch (_) {}
  
  // Alarma HTML5 (crear si no existe)
  try {
    if (!alarmAudioElement) {
      alarmAudioElement = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      alarmAudioElement.loop = true;
    }
    alarmAudioElement.play().catch(() => {});
  } catch (_) {}

  // Alarma WebAudio (más fuerte y estridente)
  try {
    const ctx = getAudioCtx();
    const doPlay = () => {
      if (Date.now() < window._lastAlertStopTime + 1000) return;
      [[0, 880], [350, 1100], [700, 1320], [1050, 880]].forEach(([delay, freq]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = "square"; // onda más fuerte
        o.frequency.value = freq;
        const t = ctx.currentTime + delay / 1000;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.05); // volumen máximo
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.start(t);
        o.stop(t + 0.5);
      });
    };
    if (ctx.state === "suspended") ctx.resume().then(doPlay);
    else doPlay();
  } catch (_) {}
}

window._lastAlertStopTime = 0;
function stopAlert() {
  window._lastAlertStopTime = Date.now();
  try { if (alarmAudioElement) { alarmAudioElement.pause(); alarmAudioElement.currentTime = 0; } } catch (_) {}
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  try { if (Notification.permission === "default") await Notification.requestPermission(); } catch (e) {}
}

function sendSystemNotification(order) {
  try { if ("serviceWorker" in navigator && navigator.serviceWorker.controller) return; } catch(e) {}
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification("🚖 ¡Nuevo Viaje! — " + (order.client_name || ""), {
      body: `${order.pickup_address}${order.dropoff_address ? " → " + order.dropoff_address : ""}${order.fare ? "  $" + order.fare : ""}`,
      icon: "/icon-192.png", badge: "/icon-72.png", vibrate: [500, 200, 500, 200, 1000], requireInteraction: true, tag: "ride-offer",
    });
    setTimeout(() => n.close(), 30000);
  } catch (_) {}
}

const getRealOrderId = (id) => id && typeof id === 'string' ? id.split('_att_')[0] : id;

const getDeviceId = () => {
  let id = localStorage.getItem("device_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36));
    localStorage.setItem("device_id", id);
  }
  return id;
};

const getSessionToken = () => {
  let token = localStorage.getItem("session_token");
  if (!token) {
    try {
      token = crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + crypto.getRandomValues(new Uint32Array(1))[0].toString(36));
    } catch (e) {
      token = Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
    }
    localStorage.setItem("session_token", token);
  }
  localStorage.setItem("session_login_time", Date.now().toString());
  return token;
};



import { LoginScreen } from "@/components/driver/LoginScreen";

// ── Incoming ride alert ───────────────────────────────────────────────────────
function IncomingAlert({ order, onAccept, onReject, isAccepting }) {
  const [isValid, setIsValid] = useState(true); // Optimistic UI: Mostrar de inmediato
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
        // Usar la misma autoridad temporal que acceptRide. updated_date puede cambiar
        // por otros procesos y no representa el inicio real de esta oferta.
        let remaining;
        if (order.offerExpiresAt != null) {
          remaining = Math.max(0, Math.ceil((Number(order.offerExpiresAt) - Date.now()) / 1000));
        } else {
          const offerStartedAt = order.assigned_at || order.updated_date;
          const startedMs = offerStartedAt ? new Date(offerStartedAt).getTime() : Date.now();
          const elapsed = Math.floor((Date.now() - startedMs) / 1000);
          remaining = Math.max(0, timeoutSecs - elapsed);
        }
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
  }, [order.id, order.assignment_attempt, order.assigned_at, order.offerExpiresAt]);

  if (isValid === false) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-end justify-center p-4 pb-8 animate-in fade-in slide-in-from-bottom-8 duration-300" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-amber-500 px-5 py-4 flex items-center gap-3 animate-pulse">
          <img 
            src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" 
            alt="RC" 
            className="w-10 h-10 rounded-xl object-cover border border-white/30 shadow-sm"
          />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-lg leading-tight">¡Nuevo Viaje!</p>
            <p className="text-amber-100 text-xs">Respondé antes de que se reasigne</p>
          </div>
          {timeLeft !== null && (
            <div className={`shrink-0 min-w-[76px] rounded-xl px-3 py-2 text-center shadow ${timeLeft <= 10 ? 'bg-red-600' : 'bg-white'}`}>
              <p className={`text-[10px] font-bold uppercase leading-none mb-1 ${timeLeft <= 10 ? 'text-white' : 'text-amber-700'}`}>Quedan</p>
              <p className={`text-2xl font-black font-mono leading-none ${timeLeft <= 10 ? 'text-white animate-pulse' : 'text-gray-950'}`}>{Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</p>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
              <Phone className="w-6 h-6 text-gray-500" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-lg dark:text-white truncate">{order.client_name}</p>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-slate-800 rounded-3xl p-5 space-y-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-start gap-4">
              <div className="w-6 h-6 rounded-full bg-green-500 mt-0.5 shrink-0 shadow-sm" />
              <div className="min-w-0">
                <p className="text-sm text-gray-400 font-bold uppercase tracking-wider">RECOGIDA</p>
                <p className="font-bold text-xl dark:text-white break-words leading-tight">{order.pickup_address}</p>
              </div>
            </div>
            {order.dropoff_address && (
              <>
                <div className="ml-3 w-0.5 h-6 bg-gray-300 dark:bg-gray-600" />
                <div className="flex items-start gap-4">
                  <MapPin className="w-6 h-6 text-red-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-400 font-bold uppercase tracking-wider">DESTINO</p>
                    <p className="font-bold text-xl dark:text-white break-words leading-tight">{order.dropoff_address}</p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center justify-between px-2 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
            <span className="text-gray-600 dark:text-gray-300 font-bold text-base">Medio de pago</span>
            <span className="text-lg font-black text-slate-700 dark:text-slate-200">
              {order.payment_method === "Transferencia" ? "🏦 Transferencia" : "💵 Efectivo"}
            </span>
          </div>

          {order.fare && (
            <div className="flex items-center justify-between px-2 bg-green-50 dark:bg-green-900/20 p-4 rounded-2xl">
              <span className="text-gray-600 dark:text-gray-300 font-bold text-lg">Tarifa aprox.</span>
              <span className="text-3xl font-black text-green-600 dark:text-green-400">${Number(order.fare).toLocaleString()}</span>
            </div>
          )}

          {order.notes && (
            <p className="text-base text-gray-600 dark:text-gray-300 italic px-2 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-2xl border border-yellow-200 dark:border-yellow-700/30">
              "{order.notes}"
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 pt-2">
            <Button
              size="lg"
              className="w-full rounded-2xl h-16 md:h-20 bg-green-500 hover:bg-green-600 text-xl font-black gap-3 shadow-xl shadow-green-500/30"
              onClick={onAccept}
              disabled={isAccepting}
            >
              <CheckCircle2 className="w-7 h-7" /> {isAccepting ? "Aceptando..." : "Aceptar Viaje"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full rounded-2xl h-14 md:h-16 border-2 border-red-200 dark:border-red-900/50 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-lg font-bold gap-3"
              onClick={onReject}
              disabled={isAccepting}
            >
              <XCircle className="w-6 h-6" /> Rechazar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Broadcast alert (sin zona / primero en aceptar gana) ─────────────────────
function BroadcastAlert({ order, onAccept, onReject, isAccepting }) {
  const [isValid, setIsValid] = useState(true);
  useEffect(() => {
    let mounted = true;
    base44.entities.RideOrder.get(order.id).then(fresh => {
      if (mounted) {
        if (fresh && (fresh.status !== 'pendiente' || fresh.driver_id)) { 
          setIsValid(false); 
          window.dispatchEvent(new CustomEvent("radiocab_reconnect")); 
        }
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [order.id]);
  const cleanNotes = (order.notes || "").replace(/^\[BROADCAST\]\s*/, "").trim();
  if (isValid === false) return null;
  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-end justify-center p-4 pb-8 animate-in fade-in slide-in-from-bottom-8 duration-300" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl overflow-hidden shadow-2xl">
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
        <div className="p-6 space-y-6">
          {order.zone && (
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-2xl px-4 py-3 text-base text-orange-700 dark:text-orange-400 font-bold border border-orange-200 dark:border-orange-900/50">
              📍 ZONA: {order.zone}
            </div>
          )}
          <div className="bg-gray-50 dark:bg-slate-800 rounded-3xl p-5 space-y-4 border border-gray-200 dark:border-slate-700">
            <div className="flex items-start gap-4">
              <div className="w-6 h-6 rounded-full bg-green-500 mt-0.5 shrink-0 shadow-sm" />
              <div className="min-w-0">
                <p className="text-sm text-gray-400 font-bold uppercase tracking-wider">RECOGIDA</p>
                <p className="font-bold text-xl dark:text-white break-words leading-tight">{order.pickup_address}</p>
              </div>
            </div>
            {order.dropoff_address && (
              <>
                <div className="ml-3 w-0.5 h-6 bg-gray-300 dark:bg-gray-600" />
                <div className="flex items-start gap-4">
                  <MapPin className="w-6 h-6 text-red-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-400 font-bold uppercase tracking-wider">DESTINO</p>
                    <p className="font-bold text-xl dark:text-white break-words leading-tight">{order.dropoff_address}</p>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center justify-between px-2 bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
            <span className="text-gray-600 dark:text-gray-300 font-bold text-base">Medio de pago</span>
            <span className="text-lg font-black text-slate-700 dark:text-slate-200">
              {order.payment_method === "Transferencia" ? "🏦 Transferencia" : "💵 Efectivo"}
            </span>
          </div>

          {order.fare && (
            <div className="flex items-center justify-between px-2 bg-green-50 dark:bg-green-900/20 p-4 rounded-2xl">
              <span className="text-gray-600 dark:text-gray-300 font-bold text-lg">Tarifa aprox.</span>
              <span className="text-3xl font-black text-green-600 dark:text-green-400">${Number(order.fare).toLocaleString()}</span>
            </div>
          )}
          {cleanNotes && (
            <p className="text-base text-gray-600 dark:text-gray-300 italic px-2 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-2xl border border-yellow-200 dark:border-yellow-700/30">
              "{cleanNotes}"
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 pt-2">
            <Button size="lg" className="w-full rounded-2xl h-16 md:h-20 bg-green-500 hover:bg-green-600 text-xl font-black gap-3 shadow-xl shadow-green-500/30" onClick={onAccept} disabled={isAccepting}>
              <CheckCircle2 className="w-7 h-7" /> {isAccepting ? "Aceptando..." : "Tomar Viaje Rápido"}
            </Button>
            <Button size="lg" variant="outline" className="w-full rounded-2xl h-14 md:h-16 border-2 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 text-lg font-bold gap-3" onClick={onReject} disabled={isAccepting}>
              <XCircle className="w-6 h-6" /> Ignorar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}



// ── Available orders list ─────────────────────────────────────────────────────
function AvailableOrders({ orders, onTake }) {
  if (orders.length === 0) return null;
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
      <p className="text-base font-bold text-gray-500 pt-3">
        <List className="inline w-5 h-5 mr-1" />
        {orders.length} viaje(s) en espera — tocá para tomar
      </p>
      {orders.map(order => (
        <div key={order.id} className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-gray-200 dark:border-slate-700 p-5 space-y-4 shadow-md">
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-base">
              <div className="w-5 h-5 rounded-full bg-green-500 mt-0.5 shrink-0 shadow-sm" />
              <span className="font-bold text-lg dark:text-white leading-tight">{order.pickup_address}</span>
            </div>
            {order.dropoff_address && (
              <div className="flex items-start gap-3 text-base text-gray-500 dark:text-gray-400">
                <MapPin className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                <span className="leading-tight">{order.dropoff_address}</span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-800">
            <span className="text-sm text-gray-500 font-bold">{order.client_name}</span>
            {order.fare && <span className="font-black text-green-600 dark:text-green-400 text-2xl">${Number(order.fare).toLocaleString()}</span>}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-gray-400 font-semibold">{order.payment_method === "Transferencia" ? "🏦 Transferencia" : "💵 Efectivo"}</span>
          </div>
          {order.notes && (
            <p className="text-xs text-amber-600 dark:text-amber-500 italic truncate border-t border-gray-100 dark:border-slate-800 pt-1">
              "{order.notes.replace(/^\[BROADCAST\]\s*/, "").trim()}"
            </p>
          )}
          <Button className="w-full rounded-2xl h-14 font-bold text-lg" onClick={() => onTake(order)}>
            Tomar este Viaje
          </Button>
        </div>
      ))}
    </div>
  );
}

function ReceiptScreen({ order, importeFinal, onClose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-slate-900 space-y-6 overflow-y-auto">
      <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center shrink-0">
        <DollarSign className="w-12 h-12 text-green-600" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-gray-500 dark:text-gray-400 text-sm font-medium uppercase tracking-wide">COBRAR AL PASAJERO</p>
        <p className="text-6xl font-black text-green-600">${Math.round(importeFinal).toLocaleString()}</p>
        {order.importe_estimado && importeFinal !== order.importe_estimado && (
          <p className="text-xs text-gray-400">Estimado: ${Math.round(order.importe_estimado).toLocaleString()} · Ajuste: ${Math.round(importeFinal - order.importe_estimado).toLocaleString()}</p>
        )}
        {order.segundos_espera_acumulados > 0 && <p className="text-xs text-amber-600">⏱ {order.segundos_espera_acumulados}s cobrados</p>}
      </div>
      <Button className="w-full max-w-xs h-14 rounded-2xl text-base font-bold bg-green-500 hover:bg-green-600 shadow-lg" onClick={onClose}>
        Entendido ✓
      </Button>
    </div>
  );
}

function OffServiceScreen({ onGoOnService }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-6">
      <div className="w-24 h-24 rounded-full bg-red-100 flex items-center justify-center"><PowerOff className="w-10 h-10 text-red-400" /></div>
      <div className="text-center">
        <p className="text-xl font-bold text-gray-800">Fuera de Servicio</p>
        <p className="text-gray-500 text-sm mt-1">No recibirás viajes mientras estés fuera de servicio</p>
      </div>
      <Button className="h-14 px-8 rounded-2xl text-base font-bold bg-green-500 hover:bg-green-600 gap-2 shadow-lg shadow-green-500/20" onClick={onGoOnService}><Wifi className="w-5 h-5" /> Entrar en Servicio</Button>
    </div>
  );
}

// ── Idle / waiting screen ─────────────────────────────────────────────────────
function IdleScreen({ driver, drivers, selectedBase, onBaseChange, onEnter, onChangeBase, onGoOffService, driverId, libreBlockedSegs = 0, onPanic }) {
  const [changingBase, setChangingBase] = useState(false);
  const [newBase, setNewBase] = useState("");

  const isInBase = driver.current_base && driver.status === "disponible";

  // Queue for current base
  const baseQueue = debugArray(drivers, 'drivers_in_IdleScreen')
    .filter(d => d.current_base === driver.current_base && d.status === "disponible")
    .sort((a, b) => {
      const timeA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : Infinity;
      const timeB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : Infinity;
      const tA = isNaN(timeA) ? Infinity : timeA;
      const tB = isNaN(timeB) ? Infinity : timeB;
      if (tA !== tB) return tA - tB;
      return (a.id || "").localeCompare(b.id || "");
    });
  const myPosition = debugArray(baseQueue, 'baseQueue').findIndex(d => d.id === driver.id) + 1;

  if (changingBase) {
    return (
      <div className="flex-1 flex flex-col min-h-0 px-4 pt-6 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
        <div className="text-center mb-4 shrink-0">
          <p className="text-xl font-bold text-gray-800 dark:text-white">Cambiar de Base</p>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Estás en: <span className="font-semibold text-gray-700 dark:text-gray-300">{driver.current_base}</span></p>
        </div>
        <div className="space-y-2 flex-1">
          {BASES.filter(b => b !== driver.current_base).map(b => {
            const count = drivers.filter(d => d.current_base === b && d.status === "disponible").length;
            return (
              <button
                key={b}
                className={`w-full text-left px-4 py-4 rounded-2xl font-semibold text-base border-2 transition-all flex justify-between items-center ${newBase === b ? "bg-blue-600 border-blue-600 text-white" : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 text-gray-800 dark:text-white active:bg-gray-100 dark:active:bg-slate-800"}`}
                onClick={() => setNewBase(b)}
              >
                <span>{b}</span>
                <div className="flex items-center gap-2">
                  {count > 0 && <span className="flex w-2 h-2 rounded-full bg-green-500"></span>}
                  <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${newBase === b ? "bg-white/20 text-white" : count > 0 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {count} en espera
                  </span>
                </div>
              </button>
            );
          })}
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
      <div className="flex-1 flex flex-col min-h-0 bg-gray-950 overflow-y-auto">
        <div className="shrink-0 px-4 pt-6 pb-6 space-y-5">
          {/* Estado y posición ampliado */}
          <div className="flex items-center justify-between bg-gray-900 rounded-3xl p-5 border border-gray-800 shadow-lg">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-14 h-14 rounded-2xl bg-green-500/20 border border-green-500/30 flex items-center justify-center relative shrink-0">
                <div className="w-3 h-3 rounded-full bg-green-400 animate-ping absolute top-1.5 right-1.5" />
                <Clock className="w-7 h-7 text-green-400" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-white text-xl md:text-2xl truncate">En Posición</p>
                <p className="text-base md:text-lg text-gray-400 truncate">📍 {driver.current_base}</p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-3">
              <p className="text-4xl md:text-5xl font-black text-white">{myPosition}°</p>
              <p className="text-sm md:text-base text-gray-500">en cola</p>
            </div>
          </div>

          {/* Botones Grandes */}
          <div className="flex flex-col gap-3">
            <button
              className={`w-full flex items-center justify-center gap-3 h-16 rounded-2xl font-bold text-lg md:text-xl transition-all shadow-md ${libreBlockedSegs > 0 ? "bg-gray-800 text-gray-600 cursor-not-allowed" : "bg-gray-800 hover:bg-gray-700 text-gray-200 active:scale-95"}`}
              onClick={() => !libreBlockedSegs && setChangingBase(true)}
              disabled={libreBlockedSegs > 0}
            >
              <ArrowRightLeft className="w-6 h-6" /> Moverse a otra Base
            </button>
            <button
              className="w-full flex items-center justify-center gap-3 h-16 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-lg md:text-xl active:scale-95 transition-all shadow-md animate-pulse"
              onClick={onPanic}
            >
              <AlertCircle className="w-6 h-6" /> Botón de Pánico
            </button>
            {libreBlockedSegs > 0 ? (
              <div className="w-full flex items-center justify-center gap-3 rounded-2xl bg-orange-500/20 border border-orange-500/30 text-orange-400 text-lg font-bold h-16 shadow-md">
                <Timer className="w-6 h-6" />
                Bloqueado: {Math.floor(libreBlockedSegs / 60)}:{String(libreBlockedSegs % 60).padStart(2, "0")}
              </div>
            ) : (
              <button
                className="w-full flex items-center justify-center gap-3 h-16 rounded-2xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-bold text-lg md:text-xl active:scale-95 transition-all shadow-md"
                onClick={onGoOffService}
              >
                <PowerOff className="w-6 h-6" /> Salir de Servicio
              </button>
            )}
          </div>

          {/* Cola compacta pero más legible */}
          <div className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
            <p className="text-sm text-gray-400 font-semibold mb-3">Compañeros en la cola:</p>
            <div className="flex gap-2 flex-wrap">
              {baseQueue.map((d, i) => {
                return (
                  <span
                    key={d.id}
                    className={`text-sm md:text-base px-3 py-1.5 rounded-xl font-semibold border ${d.id === driver.id ? "bg-green-500 text-white border-green-500" : "bg-gray-800 text-gray-300 border-gray-700"}`}
                  >
                    {i + 1}. {getDriverDisplay(d.vehicle_model || d.vehicle_plate, d.name)}
                  </span>
                );
              })}
            </div>
          </div>

          <DailyStats driverId={driverId} />
        </div>

        {/* Mapa interactivo */}
        <div className="mx-4 mb-6 h-64 md:h-72 rounded-3xl overflow-hidden border-2 border-gray-800 shadow-xl shrink-0">
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
    <div className="flex-1 flex flex-col min-h-0 px-4 pt-6 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
      <div className="text-center mb-5 shrink-0">
        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-3">
          <Car className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-xl font-bold text-gray-800 dark:text-white">Elegí tu base</p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Tocá tu base para quedar en posición</p>
      </div>
      <div className="space-y-2 flex-1">
        {BASES.map(b => {
          const count = drivers.filter(d => d.current_base === b && d.status === "disponible").length;
          return (
            <button
              key={b}
              className={`w-full text-left px-4 py-4 rounded-2xl font-semibold text-base border-2 transition-all flex justify-between items-center ${selectedBase === b ? "bg-blue-600 border-blue-600 text-white" : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 text-gray-800 dark:text-white active:bg-gray-100 dark:active:bg-slate-800"}`}
              onClick={() => {
                onBaseChange(b);
                onEnter(b);
              }}
            >
              <span>{b}</span>
              <div className="flex items-center gap-2">
                {count > 0 && <span className="flex w-2 h-2 rounded-full bg-green-500"></span>}
                <span className={`text-xs px-3 py-1.5 rounded-full font-bold ${selectedBase === b ? "bg-white/20 text-white" : count > 0 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {count} en espera
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  const isOperator = typeof sessionStorage !== "undefined" && sessionStorage.getItem("local_operator") !== null;
  if (Capacitor.isNativePlatform() || isOperator) {
    try { navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.unregister())).catch(() => {}); } catch(e) {}
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
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
  const [showStats, setShowStats] = useState(false);
  const [showBatteryGuide, setShowBatteryGuide] = useState(false);
  const [showOcasional, setShowOcasional] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dismissedBroadcasts, setDismissedBroadcasts] = useState([]);
  const [isAccepting, setIsAccepting] = useState(false);
  // Guardia sincrónica: React state no alcanza para dos eventos que entran en el mismo tick
  // (pantalla + notificación/SW). La clave incluye viaje e intento.
  const acceptInFlightRef = useRef(null);
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [cancelledOrder, setCancelledOrder] = useState(null);

  const overlays = useRef({ showMessages, showStats, showOcasional, showBatteryGuide, showSettings });
  useEffect(() => {
    overlays.current = { showMessages, showStats, showOcasional, showBatteryGuide, showSettings };
  }, [showMessages, showStats, showOcasional, showBatteryGuide, showSettings]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = App.addListener('backButton', () => {
       const o = overlays.current;
       if (o.showBatteryGuide) setShowBatteryGuide(false);
       else if (o.showSettings) setShowSettings(false);
       else if (o.showStats) setShowStats(false);
       else if (o.showOcasional) setShowOcasional(false);
       else if (o.showMessages) setShowMessages(false);
       else {
         App.minimizeApp();
       }
    });
    return () => { listener.then(l => l.remove()); };
  }, []);
  const [loadTimeout, setLoadTimeout] = useState(false);
  // Bloqueo post-viaje: segundos restantes para poder ponerse libre
  const [libreBlockedSegs, setLibreBlockedSegs] = useState(0);
  // Base del viaje que acaba de completar (para volver ahí si anula)
  const lastRideBaseRef = useRef(null);
  const prevOfferedId = useRef(null);
  const offeredOrderRef = useRef(null);
  const prevBroadcastId = useRef(null);
  const ignoredOrdersRef = useRef(new Set());

  // Register SW and request notification permission on load
  useEffect(() => {
    registerSW();

    // Si la app fue abierta desde un tap de "Aceptar" en pantalla bloqueada
    const urlParams = new URLSearchParams(window.location.search);
    // Full-screen nativo: MainActivity abre con ?incoming=<viaje>. No aceptar
    // automáticamente; sólo forzar la carga inmediata de ESA oferta para mostrar plantilla.
    const incomingOrderId = getRealOrderId(urlParams.get("incoming"));
    if (incomingOrderId && myDriverId) {
      base44.entities.RideOrder.get(incomingOrderId).then(fresh => {
        if (fresh && fresh.status === "ofrecido" &&
            (fresh.driver_id === myDriverId || fresh.reserved_driver_id === myDriverId)) {
          queryClient.setQueriesData({ predicate: (q) => {
            const key = Array.isArray(q.queryKey) ? q.queryKey : [];
            return key.some(part => String(part).toLowerCase().includes("rideorder") || String(part).toLowerCase().includes("orders"));
          }}, (old) => {
            if (!Array.isArray(old)) return old;
            return [fresh, ...old.filter(o => o?.id !== fresh.id)];
          });
          window.dispatchEvent(new CustomEvent("radiocab_force_alert_check", { detail: [fresh] }));
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      }).catch(() => window.dispatchEvent(new CustomEvent("radiocab_reconnect")));
      window.history.replaceState({}, "", "/driver-app");
    }

    const autoAcceptOrderId = getRealOrderId(urlParams.get("accept"));
    const autoAcceptAttempt = parseInt(urlParams.get("attempt") || "1", 10);
    if (autoAcceptOrderId && myDriverId) {
      const acceptKey = `${autoAcceptOrderId}:${autoAcceptAttempt}`;
      // La apertura por URL/notificación comparte el mismo candado que los botones.
      // Evita dos acceptRide simultáneos para el mismo viaje/intento.
      if (acceptInFlightRef.current === acceptKey) {
        window.history.replaceState({}, "", "/driver-app");
        return;
      }
      acceptInFlightRef.current = acceptKey;
      stopAlert();
      if (Capacitor.isNativePlatform()) { 
        PushNotifications.removeAllDeliveredNotifications().catch(()=>{}); 
        Capacitor.Plugins.ForegroundService?.markRideResolved({ orderId: autoAcceptOrderId, assignmentAttempt: autoAcceptAttempt, resolutionType: "ACCEPTED" }).catch(()=>{});
        stopNativeRideAlert(autoAcceptOrderId, "autoAcceptFromURL");
      }
      const tryAutoAccept = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            return await base44.functions.invoke("acceptRide", {
              orderId: autoAcceptOrderId,
              driverId: myDriverId,
              assignmentAttempt: autoAcceptAttempt,
              sessionToken: getSessionToken()
            });
          } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      };

      tryAutoAccept().then(res => {
        if (res.data?.accepted) {
          setLocalOverride({ status: "en_viaje", optimisticOrderId: autoAcceptOrderId });
          // acceptRide es la única autoridad que confirma el viaje y ocupa al chofer.
          base44.functions.invoke("sendPushNotification", { action: "cancel_ride", orderId: autoAcceptOrderId, driverId: myDriverId }).catch(()=>{});
        } else {
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      }).catch(() => {
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      }).finally(() => {
        if (acceptInFlightRef.current === acceptKey) acceptInFlightRef.current = null;
      });
      window.history.replaceState({}, "", "/driver-app");
    }
    const autoRejectOrderId = getRealOrderId(urlParams.get("reject"));
    const autoRejectAttempt = parseInt(urlParams.get("attempt") || "1", 10);
    if (autoRejectOrderId && myDriverId) {
      stopAlert();
      ignoredOrdersRef.current.add(autoRejectOrderId);
      if (Capacitor.isNativePlatform()) { 
        PushNotifications.removeAllDeliveredNotifications().catch(()=>{}); 
        Capacitor.Plugins.ForegroundService?.markRideResolved({ orderId: autoRejectOrderId, assignmentAttempt: autoRejectAttempt, resolutionType: "REJECTED" }).catch(()=>{});
        stopNativeRideAlert(autoRejectOrderId, "autoRejectFromURL");
      }
      // El rechazo puede llegar tarde desde una notificación vieja.
      // Primero confirmar la liberación en servidor y recién después reasignar.
      base44.entities.Driver.updateMany(
        { id: myDriverId, $or: [{ reserved_order_id: autoRejectOrderId }, { active_order_id: autoRejectOrderId }, { active_ride_id: autoRejectOrderId }] },
        { $set: {
          status: "disponible",
          dispatch_status: "normal",
          queue_entered_at: new Date().toISOString(),
          active_order_id: null,
          active_ride_id: null,
          reserved_order_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          driver_reservation_key: null
        } }
      ).then(async () => {
        setLocalOverride(prev => ({ ...(prev || {}), status: "disponible", _ignoredOrderId: autoRejectOrderId }));
        const [order, allDrivers] = await Promise.all([
          base44.entities.RideOrder.get(autoRejectOrderId),
          base44.entities.Driver.list()
        ]);
        // assignRide ya registró esta oferta; no contarla dos veces al rechazar.
        const currentOrder = { ...order };
        await reassignAfterReject(currentOrder, allDrivers, []);
      }).catch((e) => {
        console.error("No se pudo confirmar el rechazo por URL", e);
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      });
      window.history.replaceState({}, "", "/driver-app");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Cancelaciones realtime sólo con la app visible. En background Android/FCM
  // se ocupa de despertar/notificar sin mantener otro WebSocket abierto.
  useEffect(() => {
    if (!myDriverId) return;
    let unsub = null;

    const connectCancellationListener = () => {
      unsub?.();
      unsub = null;
      if (document.visibilityState !== "visible") return;
      unsub = base44.entities.RideOrder.subscribe((e) => {
        if (e.type === "update" && e.data?.status === "cancelado") {
          const o = e.data;
          if (o.driver_id === myDriverId || o.reserved_driver_id === myDriverId) {
            if (!ignoredOrdersRef.current.has(o.id)) {
              ignoredOrdersRef.current.add(o.id);
              setLocalOverride({ status: "disponible", _ignoredOrderId: o.id });
              setCancelledOrder(o);
              try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch (_) {}
              window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
            }
          }
        }
      });
    };

    connectCancellationListener();
    document.addEventListener("visibilitychange", connectCancellationListener);
    return () => {
      document.removeEventListener("visibilitychange", connectCancellationListener);
      unsub?.();
    };
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
        const orderId = getRealOrderId(msg.orderId || msg.payload?.orderId);
        const messageAttempt = Number(msg.assignmentAttempt || msg.payload?.assignmentAttempt || 1);
        const acceptKey = `${orderId || ''}:${messageAttempt}`;
        if (orderId && myDriverId) {
          // Pantalla y notificación pueden entrar casi juntas: solo una ejecuta acceptRide.
          if (acceptInFlightRef.current === acceptKey) {
            notifySW({ type: "ACK_ACCEPT_ORDER", orderId });
            return;
          }
          acceptInFlightRef.current = acceptKey;
          stopAlert();
          if (Capacitor.isNativePlatform()) { 
             PushNotifications.removeAllDeliveredNotifications().catch(()=>{}); 
             Capacitor.Plugins.ForegroundService?.markRideResolved({ orderId, assignmentAttempt: messageAttempt, resolutionType: "ACCEPTED" }).catch(()=>{});
             stopNativeRideAlert(orderId, "swAcceptOrder");
          }
          notifySW({ type: "ACK_ACCEPT_ORDER", orderId }); // Send ACK immediately so SW doesn't spawn a new tab
          
          base44.functions.invoke("acceptRide", {
            orderId: orderId,
            driverId: myDriverId,
            assignmentAttempt: messageAttempt,
            sessionToken: getSessionToken()
          }).then((res) => {
            if (res.data?.accepted) {
              setLocalOverride({ status: "en_viaje", optimisticOrderId: orderId });
              base44.functions.invoke("sendPushNotification", { action: "cancel_ride", orderId, driverId: myDriverId }).catch(()=>{});
            } else {
              alert("El viaje ya expiró o fue tomado por otro móvil.");
              setLocalOverride({ status: "disponible", _ignoredOrderId: orderId });
            }
            window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
          }).catch(() => {
            alert("Error de conexión al intentar aceptar el viaje desde la notificación.");
            window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
          }).finally(() => {
            if (acceptInFlightRef.current === acceptKey) acceptInFlightRef.current = null;
          });
        }
      }

      if (msg.type === "SW_REJECT_ORDER" || (msg.type === "NOTIFICATION_ACTION" && msg.action === "reject")) {
        const orderId = getRealOrderId(msg.orderId || msg.payload?.orderId);
        const messageAttempt = Number(msg.assignmentAttempt || msg.payload?.assignmentAttempt || 1);
        if (orderId && myDriverId) {
          stopAlert();
          ignoredOrdersRef.current.add(orderId);
          if (Capacitor.isNativePlatform()) { 
            PushNotifications.removeAllDeliveredNotifications().catch(()=>{}); 
            Capacitor.Plugins.ForegroundService?.markRideResolved({ orderId, assignmentAttempt: messageAttempt, resolutionType: "REJECTED" }).catch(()=>{});
            stopNativeRideAlert(orderId, "swRejectOrder");
          }
          notifySW({ type: "ACK_REJECT_ORDER", orderId }); // Send ACK
          // Igual que el rechazo por URL: confirmar primero la liberación real
          // del móvil y sólo entonces buscar el siguiente candidato.
          base44.entities.Driver.updateMany(
            { id: myDriverId, $or: [{ reserved_order_id: orderId }, { active_order_id: orderId }, { active_ride_id: orderId }] },
            { $set: {
              status: "disponible",
              dispatch_status: "normal",
              queue_entered_at: new Date().toISOString(),
              active_order_id: null,
              active_ride_id: null,
              reserved_order_id: null,
              reservation_token: null,
              manual_reservation_token: null,
              driver_reservation_key: null
            } }
          ).then(async () => {
            setLocalOverride({ status: "disponible", _ignoredOrderId: orderId });
            const [order, allDrivers] = await Promise.all([
              base44.entities.RideOrder.get(orderId),
              base44.entities.Driver.list()
            ]);
            // assignRide ya registró esta oferta; no contarla dos veces al rechazar.
            const currentOrder = { ...order };
            await reassignAfterReject(currentOrder, allDrivers, []);
          }).catch((e) => {
            console.error("No se pudo confirmar el rechazo desde notificación", e);
            window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
          });
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
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
                 // Sigue ofrecido: en Web reactivamos alarma, en Nativo dejamos que siga sonando.
                 playAlert();
             } else {
                 // Ya no está ofrecido, limpiar de verdad (Escudo de limpieza)
                 stopAlert();
                 if (Capacitor.isNativePlatform()) {
                    Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: 'onVisibilityChange_clear_invalid' }).catch(()=>{});
                    LocalNotifications.cancel({ notifications: [{ id: 88888 }, { id: 77777 }] }).catch(()=>{});
                 }
                 window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
             }
          }).catch(() => {
             playAlert(); // Si falla la red, asumimos que sigue sonando
          });
        } else {
          // No hay orden ofrecida localmente, limpiar por si quedó alguna alerta fantasma sonando
          stopAlert();
          if (Capacitor.isNativePlatform()) {
             Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: 'onVisibilityChange_clear_empty' }).catch(()=>{});
             LocalNotifications.cancel({ notifications: [{ id: 88888 }, { id: 77777 }] }).catch(()=>{});
          }
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tiempo real: suscripciones en lugar de polling ────────────────────────
  const { drivers, isLoading: driversLoading, error: driversError } = useRealtimeDrivers();
  // Se aumenta el límite y se ordena por updated_date para evitar que el viaje activo desaparezca (causa de que el taxímetro se corte)
  const { orders } = useRealtimeOrders({ limit: 150, sort: "-updated_date" });

  // Sincronizar la UI al recibir push/realtime y también al volver al primer plano.
  // Un viaje nuevo debe aparecer sin cerrar/reabrir la app.
  useEffect(() => {
    const handleSync = () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      // Compatibilidad con las query keys reales de los hooks realtime.
      queryClient.invalidateQueries({ predicate: (q) => {
        const key = Array.isArray(q.queryKey) ? q.queryKey : [];
        return key.some(part => String(part).toLowerCase().includes("rideorder") || String(part).toLowerCase().includes("driver"));
      }});
    };
    window.addEventListener("radiocab_reconnect", handleSync);
    window.addEventListener("online", handleSync); // Refrescar al recuperar internet
    
    const onVis = () => {
      if (document.visibilityState === "visible") {
        handleSync();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    
    return () => {
      window.removeEventListener("radiocab_reconnect", handleSync);
      window.removeEventListener("online", handleSync);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [queryClient]);

  // Timeout de seguridad: si después de 8s sigue cargando, mostrar reintento
  useEffect(() => {
    if (!driversLoading) { setLoadTimeout(false); return; }
    const t = setTimeout(() => setLoadTimeout(true), 8000);
    return () => clearTimeout(t);
  }, [driversLoading]);

  // Push subscription — registra este dispositivo para recibir notificaciones push reales
  usePushSubscription(myDriverId || null);

  // Alertas de mensajes entrantes (operador → este chofer)
  const { pendingMessages, dismissMessage } = useDriverMessageAlert(myDriverId || null);

  // Estado local optimista — se sobreescribe con datos reales cuando llegan
  const [localOverride, setLocalOverride] = useState(null);
  const localOverrideRef = useRef(localOverride);
  useEffect(() => { localOverrideRef.current = localOverride; }, [localOverride]);
  const clearOverrideTimerRef = useRef(null);
  const checkedGhostRef = useRef(null);

  const safeDrivers = Array.isArray(drivers) ? drivers : [];
  const safeOrders = Array.isArray(orders) ? orders : [];
  const myDriverRaw = debugArray(safeDrivers, 'safeDrivers').find(d => d.id === myDriverId);

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

  // GPS nativo SOLO cuando hace falta para un viaje/taxímetro.
  // En espera FCM mantiene la recepción de viajes sin tener el GPS encendido.
  const preciseGpsTracking = myDriver?.status === "en_viaje" || showOcasional;
  const gpsTrackingEnabled = !!myDriverId && !!myDriver && preciseGpsTracking;
  const gpsIdRef = useRef(null);

  // La pantalla solo se mantiene despierta mientras se usa el taxímetro.
  useWakeLock(gpsTrackingEnabled && preciseGpsTracking);

  useEffect(() => {
    if (!gpsTrackingEnabled) return;

    const filter = createGpsStabilityFilter();
    let stopped = false;
    let webRetryTimer = null;
    let lastPublishedAt = 0;
    let distanceSincePublish = 0;

    const handleLocation = (location, error = null) => {
      if (stopped) return;
      if (error) {
        console.warn("GPS descartado:", error);
        return;
      }

      const result = filter.process(location);
      if (!result.accepted) return;

      window.dispatchEvent(new CustomEvent(GPS_LOCATION_EVENT, { detail: result.point }));
      if (result.moving) distanceSincePublish += result.rawDistance || 0;

      const now = Date.now();
      const shouldPublish = lastPublishedAt === 0
        || now - lastPublishedAt >= 15_000
        || distanceSincePublish >= 30;

      if (shouldPublish) {
        lastPublishedAt = now;
        distanceSincePublish = 0;
        
        const dataToUpdate = {
          current_lat: result.point.latitude,
          current_lng: result.point.longitude,
        };
        
        // Si está reportando posición como "disponible" pero quedó con un estado pendiente colgado en el backend,
        // lo limpiamos aprovechando el latido de GPS.
        if (myDriverRef.current?.status === "disponible" && (myDriverRef.current?.dispatch_status === "automatic_pending" || myDriverRef.current?.reserved_order_id)) {
          if (!offeredOrderRef.current) {
            dataToUpdate.dispatch_status = "normal";
            dataToUpdate.reserved_order_id = null;
            dataToUpdate.active_ride_id = null;
            dataToUpdate.reservation_token = null;
            dataToUpdate.driver_reservation_key = null;
          }
        }

        withRetry(() => base44.entities.Driver.update(myDriverId, dataToUpdate)).catch(() => {});
      }
    };

    const startWebWatch = () => {
      if (stopped || !navigator.geolocation || gpsIdRef.current !== null) return;
      gpsIdRef.current = navigator.geolocation.watchPosition(
        handleLocation,
        (err) => {
          console.warn("GPS web:", err.code, err.message);
          if (gpsIdRef.current !== null) {
            navigator.geolocation.clearWatch(gpsIdRef.current);
            gpsIdRef.current = null;
          }
          clearTimeout(webRetryTimer);
          webRetryTimer = setTimeout(startWebWatch, 5000);
        },
        { enableHighAccuracy: preciseGpsTracking, timeout: 15000, maximumAge: 5000 }
      );
    };

    if (Capacitor.isNativePlatform()) {
      BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: preciseGpsTracking
            ? "Taxímetro activo durante el viaje."
            : "Ubicación activa mientras está en servicio.",
          backgroundTitle: "Remises Concepción",
          requestPermissions: true,
          stale: false,
          distanceFilter: preciseGpsTracking ? 3 : 20
        },
        handleLocation
      ).then(id => {
        if (stopped) {
          BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
        } else {
          gpsIdRef.current = id;
        }
      }).catch(e => console.error("Error iniciando GPS nativo", e));
    } else {
      startWebWatch();
    }

    return () => {
      stopped = true;
      clearTimeout(webRetryTimer);
      const id = gpsIdRef.current;
      gpsIdRef.current = null;
      filter.reset();

      if (Capacitor.isNativePlatform()) {
        if (id) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      } else if (id !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(id);
      }
    };
  }, [myDriverId, gpsTrackingEnabled, preciseGpsTracking]);

  // Servicio en primer plano nativo (Android)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      if (myDriverId && myDriver?.status !== "no_disponible") {
         // DESACTIVADO: Evita crasheos instantáneos al abrir en Android 14+
         // Capacitor.Plugins.ForegroundService?.startService().catch(console.error);
      } else {
         Capacitor.Plugins.ForegroundService?.stopService().catch(console.error);
      }
    }
  }, [myDriverId, myDriver?.status]);

  const ignoredOrderId = localOverride?._ignoredOrderId || null;
  const optimisticOrderId = localOverride?.optimisticOrderId || null;

  let activeOrder = debugArray(safeOrders, 'safeOrders').find(o => 
    (o.driver_id === myDriverId || o.reserved_driver_id === myDriverId) && 
    ["aceptado", "en_camino", "en_viaje"].includes(o.status) &&
    o.id !== ignoredOrderId &&
    !ignoredOrdersRef.current.has(o.id)
  );

  if (!activeOrder && optimisticOrderId) {
    const optOrder = debugArray(safeOrders, 'safeOrders').find(o => o.id === optimisticOrderId);
    if (optOrder) {
      activeOrder = { ...optOrder, status: "aceptado", driver_id: myDriverId };
    }
  }

  const isLocallyBusy = 
    (localOverride && ["en_viaje", "aceptado", "en_camino"].includes(localOverride.status)) || 
    ["en_viaje", "aceptado", "en_camino"].includes(myDriverRaw?.status) || 
    !!activeOrder;
  
  // SIEMPRE mostrar la burbuja de oferta directa, incluso si hay viajes colgados localmente
  const offeredOrder = debugArray(safeOrders, 'safeOrders').find(o => 
    (o.driver_id === myDriverId || o.reserved_driver_id === myDriverId) && 
    o.status === "ofrecido" && 
    o.id !== ignoredOrderId &&
    !ignoredOrdersRef.current.has(o.id)
  );
  
  // Broadcast desactivado
  const broadcastOrder = null;

  // Inform SW which driver is active + mostrar notificación persistente "En Servicio"
  useEffect(() => {
    notifySW({
      type: "SET_DRIVER",
      driverId: myDriverId || null,
      driverName: myDriver?.name || null,
    });
  }, [myDriverId, myDriver?.name]);

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
        const orderId = getRealOrderId(notificationAction.notification.extra?.orderId);
        const attempt = notificationAction.notification.extra?.assignmentAttempt || 1;
        const actionId = notificationAction.actionId;
        if (orderId) {
          if (actionId === 'accept') {
            window.location.href = `/driver-app?accept=${orderId}&attempt=${attempt}`;
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
        if (getRealOrderId(data.orderId) || data.action === "open_messages") {
          window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        }
      });

      // Escuchar FCM (foreground/background)
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log("[FCM] Push recibido:", notification);
        const data = notification.data || notification.notification?.data || {};
        
        // Fire-and-forget ACK nativo
        if (data.orderId && data.type === "ofrecido" && myDriverIdRef.current) {
          try {
            base44.entities.AuditLog.create({
              action: "push_ack_recibido",
              user_type: "sistema",
              user_name: myDriverRef.current?.name || "Chofer",
              details: `El teléfono del chofer confirmó la recepción del push de asignación en Android.`,
              metadata: { orderId: getRealOrderId(data.orderId), driverId: myDriverIdRef.current }
            }).catch(() => {});
          } catch(e) {}
        }

        if (data.type === "cancelar") {
            const canceledOrderId = getRealOrderId(data.orderId);
            if (canceledOrderId) {
              ignoredOrdersRef.current.add(canceledOrderId);
              setLocalOverride({ status: "disponible", _ignoredOrderId: canceledOrderId });
              try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch (_) {}
            }
            window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
            return;
        }
        
        if (data.orderId) {
            // El sonido y la burbuja nativa los maneja Java. La pantalla React debe
            // refrescar inmediatamente la orden dirigida: no depender de reiniciar la app.
            window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
            const pushedOrderId = getRealOrderId(data.orderId);
            if (pushedOrderId && myDriverIdRef.current) {
              base44.entities.RideOrder.get(pushedOrderId).then(fresh => {
                if (fresh && fresh.status === "ofrecido" &&
                    (fresh.driver_id === myDriverIdRef.current || fresh.reserved_driver_id === myDriverIdRef.current)) {
                  // Inyectar la orden fresca en las caches que alimentan la UI y forzar evaluación.
                  queryClient.setQueriesData({ predicate: (q) => {
                    const key = Array.isArray(q.queryKey) ? q.queryKey : [];
                    return key.some(part => String(part).toLowerCase().includes("rideorder") || String(part).toLowerCase().includes("orders"));
                  }}, (old) => {
                    if (!Array.isArray(old)) return old;
                    const without = old.filter(o => o?.id !== fresh.id);
                    return [fresh, ...without];
                  });
                  window.dispatchEvent(new CustomEvent("radiocab_force_alert_check", { detail: [fresh] }));
                  window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
                }
              }).catch(() => {});
            }
            // FIX: Notificar a la app para matar el sonido si ya tomamos el viaje
            window.dispatchEvent(new CustomEvent("radiocab_check_late_push", { detail: { orderId: data.orderId } }));
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
    const activeOrder = safeOrds.find(o => (o.driver_id === dId || o.reserved_driver_id === dId) && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
    
    const isLocallyBusy = 
      (driver && ["en_viaje", "aceptado", "en_camino"].includes(driver.status)) || 
      !!activeOrder;

    const ignoredOrderId = driver?._ignoredOrderId || null;

    // Una oferta dirigida solo puede sonar si el móvil sigue realmente libre.
    // El backend ya evita doble reserva; este segundo escudo impide que un evento realtime/push
    // atrasado muestre un segundo pasaje mientras el chofer ya está trabajando otro.
    const offered = !isLocallyBusy
      ? safeOrds.find(o => (o.driver_id === dId || o.reserved_driver_id === dId) && o.status === "ofrecido" && !ignoredOrdersRef.current.has(o.id) && o.id !== ignoredOrderId)
      : null;
    const broadcast = (!isLocallyBusy && driver?.status === "disponible" && driver?.current_base && !offered)
      ? safeOrds.find(o => o.status === "pendiente" && !o.driver_id && o.notes?.includes("[BROADCAST]") && !ignoredOrdersRef.current.has(o.id) && o.id !== ignoredOrderId && (!dismissed || !dismissed.includes(o.id)))
      : null;

    offeredOrderRef.current = offered || null;

    // 1. Evaluate Offered
    if (offered) {
      if (offered.id !== prevOfferedId.current) {
        console.log("[Alert-Background] Viaje ofrecido detectado. Sonando inmediatamente.");
        prevOfferedId.current = offered.id;
        
        playAlert();
        clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = setInterval(() => { playAlert(); }, 4000);

        // Eliminamos LocalNotifications.schedule porque Firebase/Java ya crea la burbuja nativa
        // con los botones de aceptar/rechazar y el sonido `raw`.

        base44.entities.RideOrder.get(offered.id).then(fresh => {
           if (prevOfferedId.current !== offered.id) return; // Prevent race conditions if state changed
           if (fresh && fresh.status === 'ofrecido') {
              if (Capacitor.isNativePlatform()) {
                console.log("[Alert-Background] Viaje ofrecido real verificado.");
              } else {
                sendSystemNotification(offered);
                notifySW({ type: "SHOW_NOTIFICATION", order: offered });
              }
           } else {
              console.log("[Alert-Background] Falsa alarma, deteniendo.");
              prevOfferedId.current = null;
              stopAlert();
              clearInterval(alertIntervalRef.current);
              window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
           }
        }).catch(() => {
           console.log("[Alert-Background] Error de red, asumiendo real.");
        });
      }
    } else {
      // ESCUDO 1: Apagado Agresivo
      // SOLO si antes había un viaje y ahora desapareció de la vista
      // (Para no matar prematuramente el sonido nativo por un micro-delay de red al abrir la app)
      if (prevOfferedId.current !== null) {
        prevOfferedId.current = null;
        clearInterval(alertIntervalRef.current);
        stopAlert();
        if (Capacitor.isNativePlatform()) {
          LocalNotifications.cancel({ notifications: [{ id: 88888 }] }).catch(()=>{});
          Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: 'evaluateAlerts_aggressiveOff' }).catch(()=>{});
        }
        if (!Capacitor.isNativePlatform()) notifySW({ type: "OFFER_CLEARED" });
      }
    }

    // 2. Evaluate Broadcast (Eliminado por requerimiento de cliente)
    if (prevBroadcastId.current) {
      prevBroadcastId.current = null;
      clearInterval(broadcastIntervalRef.current);
      stopAlert();
      if (Capacitor.isNativePlatform()) {
        LocalNotifications.cancel({ notifications: [{ id: 77777 }] }).catch(()=>{});
      }
    }
  }, []);

  useEffect(() => {
    const handler = (e) => evaluateAlerts(e.detail);
    window.addEventListener('radiocab_force_alert_check', handler);

    const latePushHandler = (e) => {
      const pushedOrderId = getRealOrderId(e.detail.orderId);
      if (myDriverIdRef.current) {
         const isOccupied = myDriverRef.current?.status && myDriverRef.current.status !== "disponible";
         const isOptimistic = localOverrideRef.current?.status && localOverrideRef.current.status !== "disponible";
         
         if (ignoredOrdersRef.current.has(pushedOrderId) || isOccupied || isOptimistic) {
             if (Capacitor.isNativePlatform()) {
                setTimeout(() => Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: 'latePushHandler_400' }).catch(()=>{}), 400);
                setTimeout(() => Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: 'latePushHandler_1500' }).catch(()=>{}), 1500);
             }
             stopAlert();
         }
      }
    };
    window.addEventListener('radiocab_check_late_push', latePushHandler);

    return () => {
      window.removeEventListener('radiocab_force_alert_check', handler);
      window.removeEventListener('radiocab_check_late_push', latePushHandler);
    };
  }, [evaluateAlerts]);

  useEffect(() => {
    evaluateAlerts(safeOrders);
    
    // Si la app carga y estamos ocupados (viaje activo), matar cualquier alerta nativa que haya quedado sonando
    const activeOrderLocal = safeOrders.find(o => 
      (o.driver_id === myDriverId || o.reserved_driver_id === myDriverId) && 
      ["aceptado", "en_camino", "en_viaje"].includes(o.status)
    );
    if (activeOrderLocal && activeOrderLocal.id && Capacitor.isNativePlatform()) {
       Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: 'useEffect_appLoading_occupied' }).catch(()=>{});
    }

    // Auto-destrabar: Si el móvil quedó colgado con una reserva a un viaje muerto
    if (myDriver && (myDriver.dispatch_status === 'automatic_pending' || myDriver.reserved_order_id || myDriver.active_ride_id)) {
      const ghostOrderId = myDriver.reserved_order_id || myDriver.active_ride_id;
      
      // Evitar spam de API si ya lo chequeamos
      if (ghostOrderId && checkedGhostRef.current !== ghostOrderId) {
         checkedGhostRef.current = ghostOrderId;
         base44.entities.RideOrder.get(ghostOrderId).then(order => {
            if (!order || !["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(order.status)) {
               // CAS: solo destrabar si el móvil TODAVÍA apunta al viaje fantasma chequeado.
               base44.entities.Driver.updateMany(
                 { id: myDriverId, $or: [{ reserved_order_id: ghostOrderId }, { active_order_id: ghostOrderId }, { active_ride_id: ghostOrderId }] },
                 { $set: {
                   status: "disponible",
                   dispatch_status: "normal",
                   active_order_id: null,
                   reserved_order_id: null,
                   active_ride_id: null,
                   reservation_token: null,
                   manual_reservation_token: null,
                   driver_reservation_key: null
                 } }
               ).catch(()=>{});
            }
         }).catch(() => {
            // Un error de red NO demuestra que el viaje sea fantasma.
            // No liberar nada: se reintentará en la próxima reconciliación.
            checkedGhostRef.current = null;
         });
      } else if (!ghostOrderId) {
         // Si solo tenia dispatch_status = 'automatic_pending'
         const offeredLocal = safeOrders.find(o => 
           (o.driver_id === myDriverId || o.reserved_driver_id === myDriverId) && 
           o.status === "ofrecido"
         );
         if (!offeredLocal && !activeOrderLocal) {
            updateDriver.mutate({
              id: myDriverId,
              data: {
                status: "disponible",
                dispatch_status: "normal",
                reserved_order_id: null,
                active_ride_id: null,
                reservation_token: null,
                manual_reservation_token: null,
                driver_reservation_key: null
              }
            });
         }
      }
    } else {
      checkedGhostRef.current = null;
    }
  }, [safeOrders, myDriver?.status, myDriver?.current_base, myDriver?.dispatch_status, myDriver?.reserved_order_id, myDriver?.active_ride_id, dismissedBroadcasts, evaluateAlerts, myDriverId]);

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

  const stopNativeRideAlert = async (orderId, sourceReason = "unknown") => {
    if (!Capacitor.isNativePlatform() || !orderId) return;
    try { 
      // 1. Apagado inmediato (útil cuando se toca el botón de la web y el sonido ya estaba reproduciéndose)
      Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: sourceReason + '_immediate' }).catch(()=>{});
      
      // 2. Apagado diferido (para evitar race condition cuando la orden de apagar llega antes de que termine de inicializarse el MediaPlayer)
      setTimeout(() => Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: sourceReason + '_delayed400' }).catch(()=>{}), 400);
      setTimeout(() => Capacitor.Plugins.ForegroundService?.stopRideAlert({ orderId: 'all', reason: sourceReason + '_delayed1500' }).catch(()=>{}), 1500);
    }
    catch (error) { console.warn("No se pudo detener la alerta nativa", error); }
  };

  const handleAccept = async () => {
    const realId = getRealOrderId(offeredOrder?.id);
    const acceptKey = `${realId || ''}:${offeredOrder?.assignment_attempt || 1}`;
    if (!realId || acceptInFlightRef.current === acceptKey) return;
    acceptInFlightRef.current = acceptKey;
    await stopNativeRideAlert(realId, "handleAccept");
    stopAlert();
    clearInterval(alertIntervalRef.current);
    prevOfferedId.current = null;
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.cancel({ notifications: [{ id: 88888 }] }).catch(()=>{});
      PushNotifications.removeAllDeliveredNotifications().catch(()=>{});
      if(realId){
        Capacitor.Plugins.ForegroundService?.markRideResolved({
          orderId: realId,
          assignmentAttempt: offeredOrder.assignment_attempt || 1,
          resolutionType: "ACCEPTED"
        }).catch(()=>{});
      }
    }

    setIsAccepting(true);

    const tryAccept = async (retries = 5) => {
      for (let i = 0; i < retries; i++) {
        try {
          return await base44.functions.invoke("acceptRide", {
            orderId: offeredOrder.id,
            driverId: myDriverId,
            assignmentAttempt: offeredOrder.assignment_attempt || 1,
            sessionToken: getSessionToken()
          });
        } catch (err) {
          if (i === retries - 1) throw err;
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    };

    try {
      const res = await tryAccept(3);

      if (res.data.accepted) {
        // El backend acceptRide es el único que confirma y guarda la aceptación.
        // La pantalla solamente se adelanta visualmente; no vuelve a escribir los mismos estados.
        if (offeredOrder?.id) {
          setLocalOverride({ status: "en_viaje", optimisticOrderId: offeredOrder.id });
        } else {
          setLocalOverride({ status: "en_viaje" });
        }

        base44.functions.invoke("sendPushNotification", {
          action: "cancel_ride",
          orderId: offeredOrder.id,
          driverId: myDriverId
        }).catch(console.error);
      } else {
        base44.entities.AuditLog.create({
          action: 'error_aceptar',
          user_type: 'chofer',
          user_name: myDriver?.name || 'Chofer',
          details: `Rechazado por backend: ${res.data.reason || 'Desconocido'}`
        }).catch(() => {});
        
        const reason = res.data.reason || "";
        if (reason.includes("STALE") || reason.includes("EXPIRED") || reason.includes("LOST") || reason.includes("OTHER_DRIVER")) {
          alert("El viaje ya expiró o fue tomado por otro móvil.");
        } else if (reason.includes("ORDER_CANCELLED")) {
          alert("El cliente canceló el viaje.");
        } else {
          alert("No se pudo aceptar el viaje (" + reason + ").");
        }

        if (offeredOrder?.id) ignoredOrdersRef.current.add(offeredOrder.id);
        setLocalOverride({ status: "disponible", _ignoredOrderId: offeredOrder?.id });
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      }
    } catch (error) {
      alert("Sin conexión: no se pudo contactar al servidor. Revisá tu internet y reintentá.");
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } finally {
      if (acceptInFlightRef.current === acceptKey) acceptInFlightRef.current = null;
      setIsAccepting(false);
      stopAlert();
      clearInterval(alertIntervalRef.current);
    }
  };
  const handleReject = async () => {
    const realId = getRealOrderId(offeredOrder?.id);
    await stopNativeRideAlert(realId, "handleReject");
    stopAlert();
    clearInterval(alertIntervalRef.current);
    prevOfferedId.current = null;
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.cancel({ notifications: [{ id: 88888 }] }).catch(()=>{});
      PushNotifications.removeAllDeliveredNotifications().catch(()=>{});
      if(realId){
        Capacitor.Plugins.ForegroundService?.markRideResolved({
          orderId: realId,
          assignmentAttempt: offeredOrder.assignment_attempt || 1,
          resolutionType: "REJECTED"
        }).catch(()=>{});
      }
    }

    if (offeredOrder?.id) ignoredOrdersRef.current.add(offeredOrder.id);
    // assignRide ya registró esta oferta; no contarla dos veces al rechazar.
    const currentOrder = { ...offeredOrder };
    
    // Regresamos al chofer a disponible SOLO si todavía está vinculado
    // a la oferta que acaba de rechazar. Un rechazo atrasado no toca otro viaje.
    if (realId) {
      try {
        await base44.entities.Driver.updateMany(
          { id: myDriverId, reservation_token: offeredOrder?.reservation_token, $or: [{ reserved_order_id: realId }, { active_order_id: realId }, { active_ride_id: realId }] },
          { $set: {
            status: "disponible",
            dispatch_status: "normal",
            queue_entered_at: new Date().toISOString(),
            active_order_id: null,
            active_ride_id: null,
            reserved_order_id: null,
            reservation_token: null,
            manual_reservation_token: null,
            driver_reservation_key: null
          } }
        );
      } catch (e) {
        console.error("No se pudo liberar el chofer antes de reasignar", e);
        alert("No se pudo confirmar el rechazo con el servidor. Revisá la conexión y reintentá.");
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        return;
      }
    }
    setLocalOverride({ status: "disponible", _ignoredOrderId: offeredOrder?.id });

    // Apagar sonido nativo en Android
    base44.functions.invoke("sendPushNotification", {
      action: "cancel_ride",
      orderId: offeredOrder?.id,
      driverId: myDriverId
    }).catch(console.error);

    // MODO ARRANQUE SEGURO: RECHAZAR NO vuelve a largar el viaje automáticamente.
    // Lo deja pendiente y totalmente sin reserva para que el operador lo reactive manualmente.
    if (realId) {
      await base44.entities.RideOrder.update(realId, {
        status: "pendiente",
        driver_id: null,
        driver_name: null,
        reserved_driver_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        assigned_at: null,
        offerExpiresAt: null
      });
    }
    window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
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

  const handleFinishRide = async (finalFare) => {
    if (!activeOrder) return false;
    const currentOrderId = activeOrder.id;

    // La pantalla no libera al chofer hasta que el servidor confirme que limpió
    // tanto el viaje como active_ride_id. Si se corta Internet, se reintenta.
    let confirmed = false;
    let lastError = null;
    for (let attempt = 0; attempt < 5 && !confirmed; attempt++) {
      try {
        const res = await base44.functions.invoke("finishRide", {
          orderId: currentOrderId,
          driverId: myDriverId,
          importeFinal: finalFare,
          sessionToken: getSessionToken()
        });
        confirmed = res.data?.success === true || res.data?.idempotent === true;
        if (!confirmed) lastError = new Error(res.data?.reason || "finish_not_confirmed");
      } catch (error) {
        lastError = error;
      }
      if (!confirmed && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }

    if (!confirmed) {
      console.error("No se pudo confirmar la finalización", lastError);
      window.alert("No se pudo confirmar el fin del viaje. Revisá Internet y tocá Terminar Viaje nuevamente.");
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      return false;
    }

    ignoredOrdersRef.current.add(currentOrderId);
    setReceiptOrder({ ...activeOrder, importe_final: finalFare || activeOrder.importe_real_actual || activeOrder.importe_estimado });
    lastRideBaseRef.current = activeOrder.assigned_base || myDriver?.current_base || null;

    const secs = (tarifaMinutosRef.current || 0) * 60;
    if (secs > 0) setLibreBlockedSegs(secs);

    const queueEnteredAt = new Date().toISOString();
    setLocalOverride({ status: "disponible", current_base: null, _ignoredOrderId: currentOrderId });
    // La finalización ya fue confirmada por backend. Liberar únicamente si el
    // móvil todavía sigue vinculado a ESTE viaje; una respuesta tardía no pisa otro.
    await base44.entities.Driver.updateMany(
      { id: myDriverId, $or: [{ active_order_id: currentOrderId }, { active_ride_id: currentOrderId }, { reserved_order_id: currentOrderId }] },
      { $set: {
        status: "disponible",
        dispatch_status: "normal",
        active_order_id: null,
        active_ride_id: null,
        reserved_order_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        driver_reservation_key: null,
        queue_entered_at: queueEnteredAt
      } }
    );
    return true;
  };

  const handleStatusChange = (newStatus) => {
    updateOrder.mutate({ id: activeOrder.id, data: { status: newStatus } });
  };
  const handleEnterBase = async (base = selectedBase) => {
    if (!base) return;
    const ts = new Date().toISOString();
    try {
      await updateDriver.mutateAsync({
        id: myDriverId,
        data: {
          current_base: base,
          status: "disponible",
          dispatch_status: "normal",
          queue_entered_at: ts,
          active_order_id: null,
          active_ride_id: null,
          reserved_order_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          driver_reservation_key: null
        },
      });
      setSelectedBase(base);
      setLocalOverride({ current_base: base, status: "disponible", queue_entered_at: ts });
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } catch (error) {
      window.alert("No se pudo entrar en posición. Revisá Internet e intentá nuevamente.");
    }
  };
  const handleChangeBase = async (newBase) => {
    const ts = new Date().toISOString();
    try {
      await updateDriver.mutateAsync({
        id: myDriverId,
        data: { 
          current_base: newBase, 
          status: "disponible", 
          dispatch_status: "normal",
          queue_entered_at: ts,
          active_order_id: null,
          active_ride_id: null,
          reserved_order_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          driver_reservation_key: null
        },
      });
      setLocalOverride({ current_base: newBase, status: "disponible", queue_entered_at: ts });
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } catch (error) {
      window.alert("No se pudo cambiar de base. Revisá Internet e intentá nuevamente.");
    }
  };
  const handleTakeOrder = async (order) => {
    if (!order?.id) return;
    const realId = getRealOrderId(order.id);
    const acceptKey = `${realId || ''}:${order.assignment_attempt || 1}`;
    if (!realId || acceptInFlightRef.current === acceptKey) return;
    acceptInFlightRef.current = acceptKey;
    await stopNativeRideAlert(realId, "handleTakeOrder");
    setIsAccepting(true);
    try {
      const res = await base44.functions.invoke("acceptRide", {
        orderId: order.id,
        driverId: myDriverId,
        assignmentAttempt: order.assignment_attempt || 1,
        sessionToken: getSessionToken()
      });
      if (!res.data?.accepted) {
        alert("El viaje ya no está disponible.");
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
        return;
      }
      if (Capacitor.isNativePlatform() && realId) {
        Capacitor.Plugins.ForegroundService?.markRideResolved({
          orderId: realId,
          assignmentAttempt: order.assignment_attempt || 1,
          resolutionType: "ACCEPTED"
        }).catch(()=>{});
      }
      setLocalOverride({ status: "en_viaje", optimisticOrderId: order.id });
    } catch (error) {
      console.error("No se pudo aceptar el viaje", error);
      alert("Sin conexión: no se pudo contactar al servidor.");
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } finally {
      if (acceptInFlightRef.current === acceptKey) acceptInFlightRef.current = null;
      setIsAccepting(false);
    }
  };

  const handleGoOffService = async () => {
    if (libreBlockedSegs > 0) return; // bloqueado
    try {
      await updateDriver.mutateAsync({
        id: myDriverId,
        data: {
          status: "no_disponible",
          dispatch_status: "normal",
          current_base: null,
          active_order_id: null,
          active_ride_id: null,
          reserved_order_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          driver_reservation_key: null
        }
      });
      setLocalOverride({ status: "no_disponible", current_base: null });
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } catch (error) {
      window.alert("No se pudo salir de servicio. Revisá Internet e intentá nuevamente.");
    }
  };

  // Anular viaje aceptado: vuelve al principio de la base asignada y el viaje pasa al siguiente
  const handleCancelRide = async () => {
    if (!activeOrder) return;
    const base = activeOrder.assigned_base || myDriver?.current_base || null;
    
    // Lo marcamos pendiente y conservamos quiénes ya lo vieron SOLO como historial.
    // Ese historial no bloquea que el mismo móvil pueda recibirlo otra vez si vuelve a corresponderle.
    const updatedOfferedIds = [...new Set([...(activeOrder.offered_driver_ids || []), myDriverId])];
    await updateOrder.mutateAsync({ 
      id: activeOrder.id, 
      data: { 
        status: "pendiente", 
        driver_id: null, 
        reserved_driver_id: null,
        driver_name: null,
        reservation_token: null,
        manual_reservation_token: null,
        // Viaje ya aceptado y devuelto: comienza una ronda nueva.
        // Conservamos solo al chofer que lo devuelve; los anteriores pueden recibirlo otra vez.
        offered_driver_ids: [myDriverId]
      } 
    });
    
    base44.entities.AuditLog.create({
      action: "cancelar_viaje",
      user_type: "chofer",
      user_name: myDriver?.name || "Chofer",
      details: `Anuló el viaje de ${activeOrder.client_name} - Reasignando al siguiente`
    }).catch(() => {});

    // Si el chofer anula un viaje que ya tenía, vuelve disponible pero al FINAL
    // de su cola/base. Posición 1 queda reservada para cancelación del cliente/operador.
    const ts = new Date().toISOString();
    const releaseCancelledRide = await base44.entities.Driver.updateMany(
      {
        id: myDriverId,
        $or: [
          { active_order_id: activeOrder.id },
          { active_ride_id: activeOrder.id },
          { reserved_order_id: activeOrder.id }
        ]
      },
      { $set: {
        status: "disponible",
        dispatch_status: "normal",
        current_base: base,
        queue_entered_at: ts,
        active_order_id: null,
        active_ride_id: null,
        reserved_order_id: null,
        reservation_token: null,
        manual_reservation_token: null,
        driver_reservation_key: null
      } }
    );
    if ((releaseCancelledRide.updated ?? releaseCancelledRide.modifiedCount ?? 0) < 1) {
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      return;
    }
    setLocalOverride({ status: "disponible", current_base: base, queue_entered_at: ts });
    setLibreBlockedSegs(0); // al anular no aplica bloqueo

    // MODO SEGURO: un viaje YA ACEPTADO que el chofer cancela NO se reasigna
    // automáticamente. Queda pendiente para que el operador decida a quién reactivarlo.
    // Esto evita cadenas de reasignación/cancelación mientras estabilizamos el despacho.
    window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
  };

  const handleGoOnService = async () => {
    try {
      await updateDriver.mutateAsync({
        id: myDriverId,
        data: {
          status: "disponible",
          dispatch_status: "normal",
          current_base: null,
          queue_entered_at: null,
          active_order_id: null,
          active_ride_id: null,
          reserved_order_id: null,
          reservation_token: null,
          manual_reservation_token: null,
          driver_reservation_key: null,
          last_active: new Date().toISOString()
        }
      });
      setLocalOverride({ status: "disponible", current_base: null });
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } catch (error) {
      window.alert("No se pudo entrar en servicio. Revisá Internet e intentá nuevamente.");
    }
  };

  const handleBroadcastAccept = async (order) => {
    const realId = getRealOrderId(order?.id);
    const acceptKey = `${realId || ''}:${order?.assignment_attempt || 1}`;
    if (!realId || acceptInFlightRef.current === acceptKey) return;
    acceptInFlightRef.current = acceptKey;
    await stopNativeRideAlert(realId, "handleBroadcastAccept");
    stopAlert();
    clearInterval(broadcastIntervalRef.current);
    prevBroadcastId.current = null;
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.cancel({ notifications: [{ id: 77777 }] }).catch(()=>{});
      PushNotifications.removeAllDeliveredNotifications().catch(()=>{});
      if(realId){
        Capacitor.Plugins.ForegroundService?.markRideResolved({
          orderId: realId,
          assignmentAttempt: order.assignment_attempt || 1,
          resolutionType: "ACCEPTED"
        }).catch(()=>{});
      }
    }

    setIsAccepting(true);

    const tryBroadcastAccept = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          return await base44.functions.invoke("acceptRide", {
            orderId: order.id,
            driverId: myDriverId,
            assignmentAttempt: order.assignment_attempt || 1,
            sessionToken: getSessionToken()
          });
        } catch (err) {
          if (i === retries - 1) throw err;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    };

    try {
      const res = await tryBroadcastAccept(3);

      if (res.data.accepted) {
        // La aceptación ya quedó confirmada de forma atómica en acceptRide.
        if (order?.id) {
          setLocalOverride({ status: "en_viaje", optimisticOrderId: order.id });
        } else {
          setLocalOverride({ status: "en_viaje" });
        }

        base44.functions.invoke("sendPushNotification", {
          action: "cancel_ride",
          orderId: order.id,
          driverId: myDriverId
        }).catch(console.error);
      } else {
        if (order?.id) ignoredOrdersRef.current.add(order.id);
        setLocalOverride({ status: "disponible", _ignoredOrderId: order?.id });
        window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } finally {
      if (acceptInFlightRef.current === acceptKey) acceptInFlightRef.current = null;
      setIsAccepting(false);
      stopAlert();
      clearInterval(broadcastIntervalRef.current);
    }
  };

  const handleBroadcastReject = async (order) => {
    const realId = getRealOrderId(order?.id);
    await stopNativeRideAlert(realId, "handleBroadcastReject");
    stopAlert();
    clearInterval(broadcastIntervalRef.current);
    prevBroadcastId.current = null;
    if (Capacitor.isNativePlatform()) {
      LocalNotifications.cancel({ notifications: [{ id: 77777 }] }).catch(()=>{});
      PushNotifications.removeAllDeliveredNotifications().catch(()=>{});
      if(realId){
        Capacitor.Plugins.ForegroundService?.markRideResolved({
          orderId: realId,
          assignmentAttempt: order.assignment_attempt || 1,
          resolutionType: "REJECTED"
        }).catch(()=>{});
      }
    }

    if (order?.id) ignoredOrdersRef.current.add(order.id);
    setLocalOverride(prev => ({ ...(prev || {}), _ignoredOrderId: order?.id }));
    const updated = [...dismissedBroadcasts, order.id];
    setDismissedBroadcasts(updated);
    localStorage.setItem(`dismissed_bc_${myDriverId}`, JSON.stringify(updated));

    // Apagar sonido nativo en Android
    base44.functions.invoke("sendPushNotification", {
      action: "cancel_ride",
      orderId: order?.id,
      driverId: myDriverId
    }).catch(console.error);
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
        <OfflineBanner />
        <InstallBanner />
        <div className="flex-1 overflow-y-auto">
          <LoginScreen
            drivers={safeDrivers}
            driversError={driversError}
            savedDriverId={savedDriverId}
            getSessionToken={getSessionToken}
            onSelect={(id, isFirstTime) => {
              setMyDriverId(id);
              sessionStorage.setItem("my_driver_id", id);
              if (!isOperator) {
                localStorage.setItem("my_driver_id", id);
                if (isFirstTime) {
                  localStorage.setItem(`setup_done_${id}`, "1");
                }
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
      <OfflineBanner />
      <InstallBanner />

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 text-white px-4 py-3 flex items-center justify-between shrink-0 overflow-x-hidden">
        <div className="flex items-center gap-3 shrink-0">
          <img
            src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg"
            alt="RC"
            className="w-10 h-10 rounded-xl object-cover"
          />
          {myDriver.current_base && myDriver.status === "disponible" && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-sm py-1 px-2">
              📍 {myDriver.current_base}
            </Badge>
          )}
          {myDriver.status === "en_viaje" && (
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-sm py-1 px-2">En Viaje</Badge>
          )}
          {myDriver.status === "no_disponible" && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-sm py-1 px-2">Inactivo</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pl-4 ml-auto">
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
            className="p-2 rounded-xl bg-gray-700/50 text-gray-400"
            onClick={() => setShowSettings(true)}
            title="Ajustes de cuenta"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <PullToRefresh onRefresh={() => {
         queryClient.invalidateQueries({ queryKey: ["orders"] });
         queryClient.invalidateQueries({ queryKey: ["drivers"] });
         window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
         return new Promise(resolve => setTimeout(resolve, 500));
      }}>
        {receiptOrder ? (
          <ReceiptScreen order={receiptOrder} importeFinal={receiptOrder.importe_final} onClose={() => setReceiptOrder(null)} />
        ) : activeOrder ? (
          <ActiveRideScreen order={activeOrder} driver={myDriver} onStatusChange={handleStatusChange} onCancelRide={handleCancelRide} onFinishRide={handleFinishRide} />
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
            onPanic={() => {
              base44.entities.PanicAlert.create({
                driver_id: myDriverId,
                driver_name: myDriver.name,
                vehicle_plate: myDriver.vehicle_plate,
                current_lat: myDriver.current_lat,
                current_lng: myDriver.current_lng,
              });
              navigator.vibrate?.([500, 200, 500, 200, 500]);
            }}
          />
        )}
      </PullToRefresh>

      {offeredOrder && (
        <IncomingAlert order={offeredOrder} onAccept={handleAccept} onReject={handleReject} isAccepting={isAccepting} />
      )}
      {broadcastOrder && !offeredOrder && (
        <BroadcastAlert
          order={broadcastOrder}
          onAccept={() => handleBroadcastAccept(broadcastOrder)}
          onReject={() => handleBroadcastReject(broadcastOrder)}
          isAccepting={isAccepting}
        />
      )}

      {showMessages && myDriver && (
        <DriverMessages driver={myDriver} onClose={() => setShowMessages(false)} />
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
        <OcasionalMeter onClose={() => setShowOcasional(false)} driver={myDriver} />
      )}

      {/* Ajustes de cuenta */}
      {showSettings && (
        <DriverSettings
          driver={myDriver}
          onClose={() => setShowSettings(false)}
          onOpenBatteryGuide={() => {
            setShowSettings(false);
            setShowBatteryGuide(true);
          }}
          onLogout={() => {
            localStorage.removeItem("my_driver_id");
            localStorage.removeItem("remembered_driver_id");
            sessionStorage.removeItem("my_driver_id");
            sessionStorage.removeItem("remembered_driver_id");
            setMyDriverId("");
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

function DriverSettings({ driver, onClose, onLogout, onOpenBatteryGuide }) {
  const handleRepairApp = async () => {
    if (window.confirm("¿Querés Reparar la App? Esto borrará la caché, arreglará viajes trabados y sincronizará las notificaciones sin perder tu sesión.")) {
      try {
        // 1. Unregister Service Workers
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (let reg of regs) await reg.unregister();
        }
        
        // 2. Clear browser caches
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) await caches.delete(key);
        }

        // 3. Clear sessions and local states (keeping my_driver_id so they don't have to login again if we can help it, but clear tokens)
        localStorage.removeItem("session_token");
        sessionStorage.clear();

        // 4. Force backend state cleanup for this driver
        await base44.entities.Driver.update(driver.id, {
           status: "disponible",
           dispatch_status: "normal",
           active_ride_id: null,
           reserved_order_id: null,
           reservation_token: null,
           manual_reservation_token: null,
           driver_reservation_key: null,
           fcm_token: null,
           push_subscription: null
        });

      } catch (e) {
        console.error("Repair error", e);
      } finally {
        window.location.reload(true);
      }
    }
  };

  const handleDeleteAccount = async () => {
    if (window.confirm("¿Estás seguro que querés eliminar tu cuenta? Vas a perder el acceso y el operador tendrá que registrarte nuevamente.")) {
      try {
        await base44.entities.Driver.delete(driver.id);
        onLogout();
      } catch (e) {
        alert("Error al eliminar la cuenta.");
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-6 space-y-6 shadow-2xl">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Ajustes de cuenta</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Chofer: {driver.name}</p>
        </div>
        <div className="space-y-3">
          <Button variant="secondary" className="w-full h-12 rounded-xl bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-200 border border-orange-200 font-bold" onClick={handleRepairApp}>
            <Zap className="w-5 h-5 mr-2" /> Reparar App / Borrar Caché
          </Button>
          <Button variant="secondary" className="w-full h-12 rounded-xl bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-200" onClick={onOpenBatteryGuide}>
            Permisos y Batería (Si no suena)
          </Button>
          <Button variant="outline" className="w-full h-12 rounded-xl dark:border-slate-700 dark:text-white" onClick={onLogout}>Cerrar Sesión</Button>
          <Button variant="destructive" className="w-full h-12 rounded-xl" onClick={handleDeleteAccount}>Eliminar Mi Cuenta</Button>
          <Button variant="ghost" className="w-full h-12 rounded-xl dark:text-gray-300" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}