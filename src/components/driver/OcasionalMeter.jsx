import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { haversineMetros } from "@/hooks/useTarifaConfig";
import { DollarSign, Timer, Navigation, CheckCircle2, XCircle, Car, Zap } from "lucide-react";

/**
 * Taxímetro ocasional: el chofer activa un viaje propio sin despacho.
 * Usa la tarifa configurada por los administradores.
 */
export default function OcasionalMeter({ onClose }) {
  // Estados del taxímetro: 'idle' | 'running' | 'done'
  const [phase, setPhase] = useState("idle");
  const [importeActual, setImporteActual] = useState(0);
  const [metrosRecorridos, setMetrosRecorridos] = useState(0);
  const [enEspera, setEnEspera] = useState(false);
  const [segundosEspera, setSegundosEspera] = useState(0);
  const [esNocturna, setEsNocturna] = useState(false);
  const [tarifaLabel, setTarifaLabel] = useState("");

  const importeRef = useRef(0);
  const metrosRef = useRef(0);
  const contadorParadoRef = useRef(0);
  const lastPosRef = useRef(null);
  const gpsWatchRef = useRef(null);
  const timerRef = useRef(null);
  const segundosEsperaRef = useRef(0);

  const tarifaRef = useRef({
    bajada_bandera: 500,
    precio_por_metro: 2,
    precio_por_minuto_espera: 50,
    tolerancia_espera_segundos: 120,
    es_nocturna: false,
  });

  // Cargar tarifa al montar
  useEffect(() => {
    base44.entities.TarifaConfig.list().then(configs => {
      const raw = configs[0] || {};
      const hora = new Date().getHours();
      const horaInicio = raw.nocturna_hora_inicio ?? 22;
      const horaFin = raw.nocturna_hora_fin ?? 6;
      const nocturna = horaInicio > horaFin
        ? (hora >= horaInicio || hora < horaFin)
        : (hora >= horaInicio && hora < horaFin);

      if (nocturna) {
        tarifaRef.current = {
          bajada_bandera: raw.nocturna_bajada_bandera ?? 700,
          precio_por_metro: raw.nocturna_precio_por_metro ?? 2.8,
          precio_por_minuto_espera: raw.nocturna_precio_por_minuto_espera ?? 70,
          tolerancia_espera_segundos: raw.tolerancia_espera_segundos ?? 120,
        };
        setEsNocturna(true);
        setTarifaLabel("Tarifa Nocturna");
      } else {
        tarifaRef.current = {
          bajada_bandera: raw.bajada_bandera ?? 500,
          precio_por_metro: raw.precio_por_metro ?? 2,
          precio_por_minuto_espera: raw.precio_por_minuto_espera ?? 50,
          tolerancia_espera_segundos: raw.tolerancia_espera_segundos ?? 120,
        };
        setEsNocturna(false);
        setTarifaLabel("Tarifa Diurna");
      }
    }).catch(() => {});
  }, []);

  const iniciarViaje = () => {
    const bajada = tarifaRef.current.bajada_bandera;
    importeRef.current = bajada;
    setImporteActual(bajada);
    metrosRef.current = 0;
    contadorParadoRef.current = 0;
    segundosEsperaRef.current = 0;
    lastPosRef.current = null;
    setMetrosRecorridos(0);
    setEnEspera(false);
    setSegundosEspera(0);
    setPhase("running");

    // GPS
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
            if (metros > 0.5 && metros < 500) {
              metrosRef.current += metros;
              setMetrosRecorridos(Math.round(metrosRef.current));
              // cobrar por metro
              const nuevo = tarifaRef.current.bajada_bandera + metrosRef.current * tarifaRef.current.precio_por_metro;
              importeRef.current = nuevo;
              setImporteActual(Math.round(nuevo));
            }
          }

          lastPosRef.current = { lat: latitude, lng: longitude };

          if (speedKmh < 5) {
            contadorParadoRef.current += 1;
            setEnEspera(true);
          } else {
            contadorParadoRef.current = 0;
            setEnEspera(false);
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    }

    // Timer espera
    timerRef.current = setInterval(() => {
      if (contadorParadoRef.current > tarifaRef.current.tolerancia_espera_segundos) {
        segundosEsperaRef.current += 1;
        setSegundosEspera(segundosEsperaRef.current);
        const costoPorSegundo = tarifaRef.current.precio_por_minuto_espera / 60;
        importeRef.current += costoPorSegundo;
        setImporteActual(Math.round(importeRef.current));
      }
    }, 1000);
  };

  const terminarViaje = () => {
    if (gpsWatchRef.current !== null) navigator.geolocation.clearWatch(gpsWatchRef.current);
    clearInterval(timerRef.current);
    setPhase("done");
  };

  const reiniciar = () => {
    if (gpsWatchRef.current !== null) navigator.geolocation.clearWatch(gpsWatchRef.current);
    clearInterval(timerRef.current);
    setPhase("idle");
    setImporteActual(0);
    setMetrosRecorridos(0);
    setEnEspera(false);
    setSegundosEspera(0);
    importeRef.current = 0;
    metrosRef.current = 0;
  };

  // Pantalla: cobro final
  if (phase === "done") {
    return (
      <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <DollarSign className="w-12 h-12 text-green-400" />
          </div>
          <div>
            <p className="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-1">COBRAR AL PASAJERO</p>
            <p className="text-7xl font-black text-green-400">${Math.round(importeRef.current).toLocaleString()}</p>
            <p className={`text-xs mt-2 font-medium ${esNocturna ? "text-purple-400" : "text-blue-400"}`}>{tarifaLabel}</p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-4 space-y-2 text-sm text-left border border-gray-800">
            <div className="flex justify-between text-gray-400">
              <span>Bajada de bandera</span>
              <span className="text-white font-semibold">${tarifaRef.current.bajada_bandera.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Distancia recorrida</span>
              <span className="text-white font-semibold">{(metrosRecorridos / 1000).toFixed(2)} km</span>
            </div>
            {segundosEspera > 0 && (
              <div className="flex justify-between text-gray-400">
                <span>Tiempo de espera</span>
                <span className="text-amber-400 font-semibold">
                  {Math.floor(segundosEspera / 60)}m {segundosEspera % 60}s
                </span>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <button
              className="w-full h-14 rounded-2xl bg-blue-600 text-white font-bold text-base active:scale-95 transition-all"
              onClick={reiniciar}
            >
              Nuevo Viaje Ocasional
            </button>
            <button
              className="w-full h-12 rounded-2xl border border-gray-700 text-gray-400 font-semibold text-sm active:scale-95 transition-all"
              onClick={onClose}
            >
              Volver a la App
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pantalla: taxímetro en marcha
  if (phase === "running") {
    return (
      <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
            <span className="text-white font-bold text-base">Viaje Ocasional</span>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${esNocturna ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"}`}>
            {tarifaLabel}
          </span>
        </div>

        {/* Taxímetro principal */}
        <div className={`flex-1 flex flex-col items-center justify-center rounded-3xl border ${enEspera ? "bg-amber-500/10 border-amber-500/30" : "bg-green-500/10 border-green-500/30"}`}>
          <div className="flex items-center gap-2 mb-3">
            {enEspera
              ? <Timer className="w-6 h-6 text-amber-400 animate-pulse" />
              : <Navigation className="w-6 h-6 text-green-400" />
            }
            <span className={`text-sm font-bold ${enEspera ? "text-amber-400" : "text-green-400"}`}>
              {enEspera ? "EN ESPERA" : "EN MOVIMIENTO"}
            </span>
          </div>
          <p className="text-8xl font-black text-white leading-none">
            ${Math.round(importeActual).toLocaleString()}
          </p>
          <div className="mt-4 flex gap-6 text-sm text-gray-400">
            <span className="flex items-center gap-1">
              <Car className="w-4 h-4" /> {(metrosRecorridos / 1000).toFixed(2)} km
            </span>
            {segundosEspera > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <Timer className="w-4 h-4" /> {Math.floor(segundosEspera / 60)}:{String(segundosEspera % 60).padStart(2, "0")} espera
              </span>
            )}
          </div>
        </div>

        {/* Botón terminar */}
        <button
          className="mt-4 w-full h-16 rounded-2xl bg-green-500 text-white font-black text-xl flex items-center justify-center gap-3 shadow-lg shadow-green-500/30 active:scale-95 transition-all"
          onClick={terminarViaje}
        >
          <CheckCircle2 className="w-7 h-7" /> Terminar · ${Math.round(importeActual).toLocaleString()}
        </button>
        <button
          className="mt-2 w-full h-11 rounded-2xl border border-red-500/30 text-red-400 font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
          onClick={reiniciar}
        >
          <XCircle className="w-4 h-4" /> Cancelar viaje
        </button>
      </div>
    );
  }

  // Pantalla: inicio (idle)
  return (
    <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto">
            <Zap className="w-10 h-10 text-yellow-400" />
          </div>
          <h2 className="text-2xl font-black text-white">Viaje Ocasional</h2>
          <p className="text-gray-400 text-sm">Iniciá el taxímetro para un viaje propio.<br />La tarifa es la configurada por la central.</p>
        </div>

        {/* Info tarifa */}
        <div className={`rounded-2xl p-4 border space-y-2 text-sm ${esNocturna ? "bg-purple-500/10 border-purple-500/30" : "bg-blue-500/10 border-blue-500/30"}`}>
          <div className={`flex items-center gap-2 font-bold text-xs mb-2 ${esNocturna ? "text-purple-300" : "text-blue-300"}`}>
            <span>{esNocturna ? "🌙" : "☀️"} {tarifaLabel || "Cargando tarifa..."}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-500">Bajada de bandera</span>
            <span className="font-semibold">${tarifaRef.current.bajada_bandera.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-500">Por metro</span>
            <span className="font-semibold">${tarifaRef.current.precio_por_metro}/m</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-500">Espera (por min)</span>
            <span className="font-semibold">${tarifaRef.current.precio_por_minuto_espera}</span>
          </div>
          <div className="flex justify-between text-gray-300">
            <span className="text-gray-500">Tolerancia espera</span>
            <span className="font-semibold">{tarifaRef.current.tolerancia_espera_segundos}s</span>
          </div>
        </div>

        <button
          className="w-full h-16 rounded-2xl bg-yellow-500 text-gray-950 font-black text-xl flex items-center justify-center gap-3 shadow-lg shadow-yellow-500/30 active:scale-95 transition-all"
          onClick={iniciarViaje}
        >
          <Zap className="w-6 h-6" /> Iniciar Taxímetro
        </button>
        <button
          className="w-full h-11 rounded-2xl border border-gray-700 text-gray-400 font-semibold text-sm active:scale-95 transition-all"
          onClick={onClose}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}