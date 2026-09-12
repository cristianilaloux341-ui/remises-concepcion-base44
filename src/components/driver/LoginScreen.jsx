import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { MapPin, Phone, CheckCircle2, LogIn, MessageCircle } from "lucide-react";

export function LoginScreen({ drivers, driversError, onSelect, savedDriverId, onClearSaved = () => {}, getSessionToken, unlockAudio, requestNotificationPermission }) {
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
  const savedDriver = savedDriverId && Array.isArray(safeDriversList) ? safeDriversList.find(d => d.id === savedDriverId) : null;

  const requestGps = () => {
    if (!navigator.geolocation) { setGpsStatus("denied"); return; }
    navigator.geolocation.getCurrentPosition(
      () => setGpsStatus("ok"),
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handlePhoneSubmit = async () => {
    if (requestNotificationPermission) await requestNotificationPermission();
    const normalized = phone.replace(/\s|-|\(|\)/g, "");
    if (!normalized) { setError("Ingresá tu número de celular"); return; }
    const found = safeDriversList.find(d => {
      const dp = (d.phone || "").replace(/\s|-|\(|\)/g, "");
      const isPartialMatch = normalized.length >= 6 && dp.length >= 6 && (dp.endsWith(normalized) || normalized.endsWith(dp));
      return dp === normalized || isPartialMatch;
    });
    if (!found) {
      setError("No se encontró ningún chofer con ese número. Verificá con el operador.");
      return;
    }
    setFoundDriver(found);
    setError("");
    if (!found.pin) {
      setStep("create_pin");
    } else {
      setStep("enter_pin");
    }
  };

  const handleCreatePin = async () => {
    if (requestNotificationPermission) await requestNotificationPermission();
    if (pin.length < 4) { setError("El PIN debe tener al menos 4 dígitos"); return; }
    if (!/^\d+$/.test(pin)) { setError("El PIN solo puede contener números"); return; }
    if (pin !== pinConfirm) { setError("Los PINs no coinciden"); return; }
    
    setLoading(true);
    try {
      const sessionToken = getSessionToken ? getSessionToken() : null;
      await base44.entities.Driver.update(foundDriver.id, { pin, current_session_token: sessionToken });
      if (unlockAudio) unlockAudio();
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
    if (requestNotificationPermission) await requestNotificationPermission();
    if (!pin) { setError("Ingresá tu PIN"); return; }
    if (pin !== foundDriver.pin) { setError("PIN incorrecto"); return; }
    
    setLoading(true);
    try {
      const sessionToken = getSessionToken ? getSessionToken() : null;
      await base44.entities.Driver.update(foundDriver.id, { current_session_token: sessionToken });
      if (unlockAudio) unlockAudio();
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
    const randomValues = new Uint16Array(1);
    crypto.getRandomValues(randomValues);
    const tempPin = String((randomValues[0] % 9000) + 1000);
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
                  const sessionToken = getSessionToken ? getSessionToken() : null;
                  await base44.entities.Driver.update(savedDriver.id, { current_session_token: sessionToken });
                  if (unlockAudio) unlockAudio(); 
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

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm space-y-6">
        {headerLogo}

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