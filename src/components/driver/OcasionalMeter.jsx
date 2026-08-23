import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { calcularImportePorFichas, normalizarTarifa, TARIFA_DEFAULTS } from "@/hooks/useTarifaConfig";
import { createGpsStabilityFilter, GPS_LOCATION_EVENT } from "@/lib/gpsStability";
import { DollarSign, Timer, Navigation, CheckCircle2, XCircle, Zap, Clock } from "lucide-react";

/**
 * Taxímetro GPS en tiempo real, igual al reloj físico.
 * - Valor de ficha configurable por metros.
 * - Tolerancia inicial que descuenta por cada segundo de viaje (en movimiento o no).
 * - Después de consumir la tolerancia, valor de ficha por segundos de espera/detenido.
 */
export default function OcasionalMeter({ onClose, driver }) {
  const [phase, setPhase] = useState("idle"); // 'idle' | 'running' | 'done'
  const [guardando, setGuardando] = useState(false);
  const [importeActual, setImporteActual] = useState(0);
  const [metrosRecorridos, setMetrosRecorridos] = useState(0);
  const [segundosTotales, setSegundosTotales] = useState(0);
  const [esNocturna, setEsNocturna] = useState(false);
  const [tarifaLabel, setTarifaLabel] = useState("Cargando tarifa...");
  const [tarifaCargada, setTarifaCargada] = useState(false);
  const [esperaManual, setEsperaManual] = useState(false);

  // Refs para evitar stale closures en GPS/timer
  const esperaManualRef = useRef(false);
  const metrosRef = useRef(0);
  const segundosMovimientoRef = useRef(0);
  const segundosEsperaRef = useRef(0);
  const toleranciaRestanteRef = useRef(0);
  const enEsperaRef = useRef(false);
  const gpsFilterRef = useRef(null);
  const gpsEventHandlerRef = useRef(null);
  const lastGpsAtRef = useRef(0);
  const timerRef = useRef(null);

  const tarifa = useRef({ ...TARIFA_DEFAULTS, es_nocturna: false });

  // Cargar tarifa al montar
  useEffect(() => {
    base44.entities.TarifaConfig.list().then(configs => {
      tarifa.current = normalizarTarifa(configs[0] || {});
      setEsNocturna(tarifa.current.es_nocturna);
      setTarifaLabel(tarifa.current.es_nocturna ? "🌙 Tarifa Nocturna" : "☀️ Tarifa Diurna");
      setTarifaCargada(true);
    }).catch(() => { setTarifaCargada(true); });
  }, []);

  const stopGpsConsumption = () => {
    if (gpsEventHandlerRef.current) {
      window.removeEventListener(GPS_LOCATION_EVENT, gpsEventHandlerRef.current);
      gpsEventHandlerRef.current = null;
    }
    gpsFilterRef.current?.reset();
    gpsFilterRef.current = null;
  };

  useEffect(() => {
    return () => {
      stopGpsConsumption();
      clearInterval(timerRef.current);
    };
  }, []);

  // El tiempo en movimiento no se cobra: solo distancia y espera.
  const recalcular = (metros, _sMovimiento, sEspera) => {
    return calcularImportePorFichas(metros, sEspera, tarifa.current);
  };

  const iniciarViaje = () => {
    metrosRef.current = 0;
    segundosMovimientoRef.current = 0;
    segundosEsperaRef.current = 0;
    toleranciaRestanteRef.current = tarifa.current.tolerancia_espera_segundos;
    enEsperaRef.current = false;
    setMetrosRecorridos(0);
    setSegundosTotales(0);
    setImporteActual(tarifa.current.bajada_bandera);
    setPhase("running");

    // Consume la única señal GPS compartida por la aplicación.
    stopGpsConsumption();
    const gpsFilter = createGpsStabilityFilter();
    const onGpsLocation = (event) => {
      const result = gpsFilter.process(event.detail);
      if (!result.accepted) return;
      lastGpsAtRef.current = Date.now();

      if (result.distance > 0) {
        metrosRef.current += result.distance;
        setMetrosRecorridos(Math.round(metrosRef.current));
        setImporteActual(recalcular(metrosRef.current, segundosMovimientoRef.current, segundosEsperaRef.current));
      }

      enEsperaRef.current = result.speedKmh < 5 || esperaManualRef.current;
    };
    gpsFilterRef.current = gpsFilter;
    gpsEventHandlerRef.current = onGpsLocation;
    window.addEventListener(GPS_LOCATION_EVENT, onGpsLocation);

    // En vez de pelear contra el event loop de React, usamos el timestamp real
    const startTime = Date.now();
    let ultimaLectura = startTime;

    timerRef.current = setInterval(() => {
      const now = Date.now();
      
      // SIEMPRE actualizamos la pantalla para que nunca se congele, incluso si el intervalo corrió a los 990ms
      const realTotalSeconds = Math.floor((now - startTime) / 1000);
      setSegundosTotales(realTotalSeconds);

      const deltaSecs = Math.floor((now - ultimaLectura) / 1000);
      if (deltaSecs < 1) return;
      
      // Actualizamos ultimaLectura restando el sobrante, para no perder milisegundos
      ultimaLectura += deltaSecs * 1000;

      const gpsSilencioso = lastGpsAtRef.current > 0 && now - lastGpsAtRef.current > 15_000;
      
      const estaEsperando = enEsperaRef.current || esperaManualRef.current || gpsSilencioso;

      if (toleranciaRestanteRef.current > 0) {
        if (deltaSecs <= toleranciaRestanteRef.current) {
          toleranciaRestanteRef.current -= deltaSecs;
          segundosMovimientoRef.current += deltaSecs;
        } else {
          const excedente = deltaSecs - toleranciaRestanteRef.current;
          toleranciaRestanteRef.current = 0;
          if (estaEsperando) {
            segundosEsperaRef.current += excedente;
          } else {
            segundosMovimientoRef.current += excedente;
          }
        }
      } else {
        if (estaEsperando) {
          segundosEsperaRef.current += deltaSecs;
        } else {
          segundosMovimientoRef.current += deltaSecs;
        }
      }
      
      setImporteActual(recalcular(metrosRef.current, segundosMovimientoRef.current, segundosEsperaRef.current));
    }, 250); // Corremos cada 250ms para que visualmente NUNCA salte ni se trabe un segundo
  };

  const terminarViaje = async () => {
    stopGpsConsumption();
    clearInterval(timerRef.current);
    setGuardando(true);

    const importeFinal = recalcular(metrosRef.current, segundosMovimientoRef.current, segundosEsperaRef.current);

    try {
      await base44.entities.RideOrder.create({
        client_name: "Viaje Ocasional (Calle)",
        pickup_address: "Viaje en calle",
        status: "completado",
        driver_id: driver?.id || "",
        driver_name: driver?.name || "",
        importe_real_actual: importeFinal,
        fare: importeFinal,
        source: "operador",
        segundos_espera_acumulados: segundosEsperaRef.current,
        distancia_teorica_metros: Math.round(metrosRef.current),
        taximetro_iniciado: true,
        metros_taximetro: Math.round(metrosRef.current),
        tarifa_bajada_bandera: tarifa.current.bajada_bandera,
        tarifa_valor_ficha: tarifa.current.valor_ficha,
        tarifa_metros_por_ficha: tarifa.current.metros_por_ficha,
        tarifa_valor_ficha_espera: tarifa.current.valor_ficha_espera,
        tarifa_segundos_por_ficha_espera: tarifa.current.segundos_por_ficha_espera,
        tarifa_tolerancia_espera_segundos: tarifa.current.tolerancia_espera_segundos,
        created_date: new Date().toISOString()
      });
      // Forzar recarga de los viajes para que aparezca en estadísticas
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    } catch (e) {
      console.error("Error guardando viaje ocasional", e);
    }

    setGuardando(false);
    setPhase("done");
  };

  const reiniciar = () => {
    stopGpsConsumption();
    clearInterval(timerRef.current);
    setPhase("idle");
    setImporteActual(0);
    setMetrosRecorridos(0);
    setSegundosTotales(0);
    metrosRef.current = 0;
    segundosMovimientoRef.current = 0;
    segundosEsperaRef.current = 0;
    toleranciaRestanteRef.current = 0;
    enEsperaRef.current = false;
    lastGpsAtRef.current = 0;
  };

  // Formato mm:ss
  const fmtTiempo = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Pantalla: cobro final ──────────────────────────────────────────────────
  if (phase === "done") {
    const importeFinal = recalcular(metrosRecorridos, segundosMovimientoRef.current, segundosEsperaRef.current);
    const km = (metrosRecorridos / 1000).toFixed(2);
    const minutosMov = (segundosMovimientoRef.current / 60).toFixed(1);
    const minutosEsp = (segundosEsperaRef.current / 60).toFixed(1);
    const fichasDistancia = Math.floor(metrosRecorridos / tarifa.current.metros_por_ficha);
    const fichasEspera = Math.floor(segundosEsperaRef.current / tarifa.current.segundos_por_ficha_espera);
    return (
      <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
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
              <span>{fichasDistancia} fichas × ${tarifa.current.valor_ficha}</span>
              <span>${(fichasDistancia * tarifa.current.valor_ficha).toLocaleString()}</span>
            </div>
            <div className="h-px bg-gray-800" />
            <div className="flex justify-between">
              <span className="text-gray-500">Tiempo en mov.</span>
              <span className="text-white font-bold">{minutosMov} min</span>
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>No se cobra tiempo en movimiento</span>
              <span>$0</span>
            </div>
            <div className="h-px bg-gray-800" />
            <div className="flex justify-between">
              <span className="text-gray-500">Tiempo de espera</span>
              <span className="text-white font-bold">{minutosEsp} min</span>
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>{fichasEspera} fichas × ${tarifa.current.valor_ficha_espera}</span>
              <span>${(fichasEspera * tarifa.current.valor_ficha_espera).toLocaleString()}</span>
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
      <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col p-4 pt-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
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

        <div className="mt-4">
          <button
            className={`w-full h-12 rounded-2xl gap-2 border font-semibold text-sm flex items-center justify-center active:scale-95 transition-all ${esperaManual ? "bg-amber-500 text-gray-900 border-amber-500" : "border-amber-500/40 text-amber-400 bg-amber-500/10"}`}
            onClick={() => {
              const next = !esperaManual;
              setEsperaManual(next);
              esperaManualRef.current = next;
              if (next) enEsperaRef.current = true;
            }}
          >
            <Timer className="w-4 h-4" />
            {esperaManual ? "Esperando manualmente..." : "Forzar Espera"}
          </button>
        </div>

        <button
          disabled={guardando}
          className="mt-4 w-full h-16 rounded-2xl bg-green-500 text-white font-black text-xl flex items-center justify-center gap-3 shadow-lg shadow-green-500/30 active:scale-95 transition-all shrink-0 disabled:opacity-50"
          onClick={terminarViaje}
        >
          <CheckCircle2 className="w-7 h-7" /> {guardando ? "Guardando..." : `Terminar · $${importeActual.toLocaleString()}`}
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
    <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
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