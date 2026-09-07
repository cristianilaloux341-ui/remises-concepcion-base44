import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Phone, MapPin, CheckCircle2, XCircle, List, DollarSign, PowerOff, Wifi, Zap } from "lucide-react";

export function IncomingAlert({ order, onAccept, onReject, isAccepting }) {
  const [isValid, setIsValid] = useState(true);
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

export function BroadcastAlert({ order, onAccept, onReject, isAccepting }) {
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

export function AvailableOrders({ orders, onTake }) {
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

export function ReceiptScreen({ order, importeFinal, onClose }) {
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

export function OffServiceScreen({ onGoOnService }) {
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

export function DriverSettings({ driver, onClose, onLogout, onOpenBatteryGuide }) {
  const handleRepairApp = async () => {
    if (window.confirm("¿Querés Reparar la App? Esto borrará la caché, arreglará viajes trabados y sincronizará las notificaciones sin perder tu sesión.")) {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (let reg of regs) await reg.unregister();
        }
        
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const key of keys) await caches.delete(key);
        }

        localStorage.removeItem("session_token");
        sessionStorage.clear();

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