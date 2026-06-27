import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { haversineMetros } from "@/hooks/useTarifaConfig";
import { DollarSign, Timer, Navigation, CheckCircle2, XCircle, Car, Zap, Clock } from "lucide-react";

/**
 * Taxímetro GPS en tiempo real.
 * Fórmula: Precio = Bajada_Bandera + (km × precio_km) + (minutos × precio_minuto)
 * - La distancia se mide con GPS + Haversine cada actualización de posición.
 * - El tiempo corre desde que se pulsa "Iniciar" hasta "Terminar".
 * - No depende de ninguna API externa.
 */
export default function OcasionalMeter({ onClose }) {
  const [phase, setPhase] = useState("idle"); // 'idle' | 'running' | 'done'
  const [importeActual, setImporteActual] = useState(0);
  const [metrosRecorridos, setMetrosRecorridos] = useState(0);
  const [segundosTotales, setSegundosTotales] = useState(0);
  const [esNocturna, setEsNocturna] = useState(false);
  const [tarifaLabel, setTarifaLabel] = useState("Cargando tarifa...");
  const [tarifaCargada, setTarifaCargada] = useState(false);

  // Refs para evitar stale closures en GPS/timer
  const metrosRef = useRef(0);
  const segundosRef = useRef(0);
  const lastPosRef = useRef(null);
  const gpsWatchRef = useRef(null);
  const timerRef = useRef(null);

  const tarifa = useRef({
    bajada_bandera: 500,
    precio_por_km: 2000,       // precio_por_metro * 1000
    precio_por_minuto: 30,
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
        tarifa.current = {
          bajada_bandera: raw.nocturna_bajada_bandera ?? 700,
          precio_por_km: (raw.nocturna_precio_por_metro ?? 2.8) * 1000,
          precio_por_minuto: raw.nocturna_precio_por_minuto_corrido ?? 45,
        };
        setEsNocturna(true);
        setTarifaLabel("🌙 Tarifa Nocturna");
      } else {
        tarifa.current = {
          bajada_bandera: raw.bajada_bandera ?? 500,
          precio_por_km: (raw.precio_por_metro ?? 2) * 1000,
          precio_por_minuto: raw.precio_por_minuto_corrido ?? 30,
        };
        setEsNocturna(false);
        setTarifaLabel("☀️ Tarifa Diurna");
      }
      setTarifaCargada(true);
    }).catch(() => { setTarifaCargada(true); });
  }, []);

  // Recalcular importe a partir de metros + segundos actuales
  const recalcular = (metros, segundos) => {
    const km = metros / 1000;
    const minutos = segundos / 60;
    const total = tarifa.current.bajada_bandera
      + km * tarifa.current.precio_por_km
      + minutos * tarifa.current.precio_por_minuto;
    return Math.round(total);
  };

  const iniciarViaje = () => {
    metrosRef.current = 0;
    segundosRef.current = 0;
    lastPosRef.current = null;
    setMetrosRecorridos(0);
    setSegundosTotales(0);
    setImporteActual(tarifa.current.bajada_bandera);
    setPhase("running");

    // GPS: acumula distancia real con Haversine
    if (navigator.geolocation) {
      gpsWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (lastPosRef.current) {
            const metros = haversineMetros(
              lastPosRef.current.lat, lastPosRef.current.lng,
              latitude, longitude
            );
            // Filtrar saltos de GPS (> 0.5m y < 300m entre lecturas)
            if (metros > 0.5 && metros < 300) {
              metrosRef.current += metros;
              setMetrosRecorridos(Math.round(metrosRef.current));
              setImporteActual(recalcular(metrosRef.current, segundosRef.current));
            }
          }
          lastPosRef.current = { lat: latitude, lng: longitude };
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000 }
      );
    }

    // Timer: cada segundo suma tiempo y recalcula
    timerRef.current = setInterval(() => {
      segundosRef.current += 1;
      setSegundosTotales(s => s + 1);
      setImporteActual(recalcular(metrosRef.current, segundosRef.current));
    }, 1000);
  };

  const terminarViaje = () => {
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    clearInterval(timerRef.current);
    setPhase("done");
  };

  const reiniciar = () => {
    if (gpsWatchRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
    }
    clearInterval(timerRef.current);
    setPhase("idle");
    setImporteActual(0);
    setMetrosRecorridos(0);
    setSegundosTotales(0);
    metrosRef.current = 0;
    segundosRef.current = 0;
  };

  // Formato mm:ss
  const fmtTiempo = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Pantalla: cobro final ──────────────────────────────────────────────────
  if (phase === "done") {
    const importeFinal = recalcular(metrosRecorridos, segundosTotales);
    const km = (metrosRecorridos / 1000).toFixed(2);
    const minutos = (segundosTotales / 60).toFixed(1);
    return (
      <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 text-center">
          <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <DollarSign className="w-12 h-12 text-green-400" />
          </div>
          <div>
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-1">COBRAR AL PASAJERO</p>
            <p className="text-7xl font-black text-green-400">${importeFinal.toLocaleString()}</p>
            <p className={`text-xs mt-2 font-semibold ${esNocturna ? "text-purple-400" : "text-blue-400"}`}>{tarifaLabel}</p>
          </div>

          {/* Desglose */}
          <div className="bg-gray-900 rounded-2xl p-4 space-y-3 text-sm text-left border border-gray-800">
            <div className="flex justify-between">
              <span className="text-gray-500">Bajada de bandera</span>
              <span className="text-white font-bold">${tarifa.current.bajada_bandera.toLocaleString()}</span>
            </div>
            <div className="h-px bg-gray-800" />
            <div className="flex justify-between">
              <span className="text-gray-500">Distancia GPS</span>
              <span className="text-white font-bold">{km} km</span>
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>{km} km × ${tarifa.current.precio_por_km.toLocaleString()}/km</span>
              <span>${Math.round((metrosRecorridos / 1000) * tarifa.current.precio_por_km).toLocaleString()}</span>
            </div>
            <div className="h-px bg-gray-800" />
            <div className="flex justify-between">
              <span className="text-gray-500">Tiempo de viaje</span>
              <span className="text-white font-bold">{minutos} min</span>
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>{minutos} min × ${tarifa.current.precio_por_minuto}/min</span>
              <span>${Math.round((segundosTotales / 60) * tarifa.current.precio_por_minuto).toLocaleString()}</span>
            </div>
            <div className="h-px bg-gray-800" />
            <div className="flex justify-between font-bold text-green-400">
              <span>TOTAL</span>
              <span>${importeFinal.toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-3">
            <button
              className="w-full h-14 rounded-2xl bg-blue-600 text-white font-bold text-base active:scale-95 transition-all"
              onClick={reiniciar}
            >
              Nuevo Viaje Ocasional
            </button>
            <button
              className="w-full h-11 rounded-2xl border border-gray-700 text-gray-400 font-semibold text-sm active:scale-95 transition-all"
              onClick={onClose}
            >
              Volver a la App
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Pantalla: taxímetro en marcha ─────────────────────────────────────────
  if (phase === "running") {
    return (
      <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col p-4 pt-6">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
            <span className="text-white font-bold">Viaje Ocasional</span>
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${esNocturna ? "bg-purple-500/20 text-purple-300" : "bg-blue-500/20 text-blue-300"}`}>
            {tarifaLabel}
          </span>
        </div>

        {/* Taxímetro central */}
        <div className="flex-1 flex flex-col items-center justify-center rounded-3xl bg-gray-900 border border-gray-800">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-2">TARIFA ACTUAL</p>
          <p className="text-8xl font-black text-green-400 leading-none">
            ${importeActual.toLocaleString()}
          </p>
          <div className="mt-6 flex gap-8">
            <div className="text-center">
              <div className="flex items-center gap-1 justify-center text-blue-400 mb-1">
                <Navigation className="w-4 h-4" />
                <span className="text-xs font-bold">DISTANCIA</span>
              </div>
              <p className="text-xl font-black text-white">{(metrosRecorridos / 1000).toFixed(2)} km</p>
            </div>
            <div className="w-px bg-gray-800" />
            <div className="text-center">
              <div className="flex items-center gap-1 justify-center text-amber-400 mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-xs font-bold">TIEMPO</span>
              </div>
              <p className="text-xl font-black text-white">{fmtTiempo(segundosTotales)}</p>
            </div>
          </div>
        </div>

        <button
          className="mt-4 w-full h-16 rounded-2xl bg-green-500 text-white font-black text-xl flex items-center justify-center gap-3 shadow-lg shadow-green-500/30 active:scale-95 transition-all shrink-0"
          onClick={terminarViaje}
        >
          <CheckCircle2 className="w-7 h-7" /> Terminar · ${importeActual.toLocaleString()}
        </button>
        <button
          className="mt-2 w-full h-11 rounded-2xl border border-red-500/30 text-red-400 font-semibold text-sm flex items-center justify-center gap-2 active:scale-95 transition-all shrink-0"
          onClick={reiniciar}
        >
          <XCircle className="w-4 h-4" /> Cancelar viaje
        </button>
      </div>
    );
  }

  // ── Pantalla: inicio (idle) ───────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <div className="w-20 h-20 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto">
            <Zap className="w-10 h-10 text-yellow-400" />
          </div>
          <h2 className="text-2xl font-black text-white">Viaje Ocasional</h2>
          <p className="text-gray-400 text-sm">El taxímetro mide distancia GPS real y tiempo de viaje.<br />No depende de internet ni de mapas.</p>
        </div>

        {/* Solo muestra la tarifa vigente sin valores */}
        <div className={`rounded-2xl p-3 border text-center ${esNocturna ? "bg-purple-500/10 border-purple-500/30" : "bg-blue-500/10 border-blue-500/30"}`}>
          <p className={`font-bold text-sm ${esNocturna ? "text-purple-300" : "text-blue-300"}`}>{tarifaLabel}</p>
          <p className="text-gray-500 text-xs mt-0.5">La tarifa es configurada por la administración</p>
        </div>

        <button
          disabled={!tarifaCargada}
          className="w-full h-16 rounded-2xl bg-yellow-500 text-gray-950 font-black text-xl flex items-center justify-center gap-3 shadow-lg shadow-yellow-500/30 active:scale-95 transition-all disabled:opacity-50"
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