import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { calcularImportePorFichas, normalizarTarifa, TARIFA_DEFAULTS } from "@/hooks/useTarifaConfig";
import { createGpsStabilityFilter, GPS_LOCATION_EVENT } from "@/lib/gpsStability";
import { MapPin, Phone, Navigation, Car, CheckCircle2, XCircle, Timer, AlertCircle } from "lucide-react";

export const STATUS_CONFIG = {
  ofrecido:  { label: "Nuevo Viaje",    bg: "bg-amber-500"  },
  aceptado:  { label: "Aceptado",       bg: "bg-blue-500"   },
  en_camino: { label: "En Puerta",      bg: "bg-purple-500" },
  en_viaje:  { label: "En Viaje",       bg: "bg-cyan-500"   },
  completado:{ label: "Completado",     bg: "bg-green-500"  },
};

export function openMapsNavigation(address, driverLat, driverLng) {
  const dest = encodeURIComponent(address);
  let url;
  if (driverLat && driverLng) {
    url = `https://www.google.com/maps/dir/${driverLat},${driverLng}/${dest}`;
  } else {
    url = `https://www.google.com/maps/search/?api=1&query=${dest}`;
  }
  window.open(url, "_blank");
}

export default function ActiveRideScreen({ order, driver, onStatusChange, onCancelRide, onFinishRide }) {
  const cfg = STATUS_CONFIG[order.status];

  // ── Taxímetro en tiempo real (solo cuando status === "en_viaje") ────────────
  const [importeActual, setImporteActual] = useState(order.importe_real_actual || order.importe_estimado || 0);
  const [metrosRecorridos, setMetrosRecorridos] = useState(0);
  const [enEspera, setEnEspera] = useState(false);
  const [esperaManual, setEsperaManual] = useState(false);
  const [tarifaCargada, setTarifaCargada] = useState(false);
  const esperaManualRef = useRef(false);

  const metrosRef = useRef(0);
  const importeRef = useRef(importeActual);
  const contadorParadoRef = useRef(0);
  const enEsperaRef = useRef(false); // ref para evitar stale closure en setInterval
  const lastGpsAtRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => { importeRef.current = importeActual; }, [importeActual]);

  const tarifaRef = useRef({ ...TARIFA_DEFAULTS });

  useEffect(() => {
    base44.entities.TarifaConfig.list().then(configs => {
      tarifaRef.current = normalizarTarifa(configs[0] || {});
    }).catch(() => {
      tarifaRef.current = { ...TARIFA_DEFAULTS };
    }).finally(() => setTarifaCargada(true));
  }, []);

  const lastSaveAtRef = useRef(0);
  const saveImporte = (nuevoImporte, segundosEspera, metros, segundosTolerancia, force = false) => {
    const ahora = Date.now();
    // Guardar si es forzado (cambió la tarifa) o cada 15 segundos (para no saturar la red y evitar que se cuelgue)
    if (!force && ahora - lastSaveAtRef.current < 15000) return;
    lastSaveAtRef.current = ahora;

    base44.entities.RideOrder.update(order.id, {
      importe_real_actual: Math.round(nuevoImporte),
      segundos_espera_acumulados: segundosEspera,
      metros_taximetro: metros,
      segundos_tolerancia_espera_usados: segundosTolerancia,
      taximetro_iniciado: true,
    }).catch(() => {});
  };

  useEffect(() => {
    if (order.status !== "en_viaje" || !tarifaCargada) return;

    // Primera puesta en marcha: se congela la tarifa vigente dentro del viaje.
    // Si Android recarga, recupera exactamente esa tarifa aunque la empresa haya publicado otra.
    const reanudando = order.taximetro_iniciado === true;
    if (reanudando && order.tarifa_bajada_bandera) {
      tarifaRef.current = {
        bajada_bandera: order.tarifa_bajada_bandera,
        valor_ficha: order.tarifa_valor_ficha || TARIFA_DEFAULTS.valor_ficha,
        metros_por_ficha: order.tarifa_metros_por_ficha || TARIFA_DEFAULTS.metros_por_ficha,
        valor_ficha_espera: order.tarifa_valor_ficha_espera || TARIFA_DEFAULTS.valor_ficha_espera,
        segundos_por_ficha_espera: order.tarifa_segundos_por_ficha_espera || TARIFA_DEFAULTS.segundos_por_ficha_espera,
        tolerancia_espera_segundos: order.tarifa_tolerancia_espera_segundos ?? TARIFA_DEFAULTS.tolerancia_espera_segundos,
      };
    }
    metrosRef.current = reanudando ? (order.metros_taximetro || 0) : 0;
    contadorParadoRef.current = reanudando ? (order.segundos_tolerancia_espera_usados || 0) : 0;
    let segundosEspera = reanudando ? (order.segundos_espera_acumulados || 0) : 0;
    lastGpsAtRef.current = 0;
    const importeInicial = calcularImportePorFichas(
      metrosRef.current,
      segundosEspera,
      tarifaRef.current
    );
    setMetrosRecorridos(Math.round(metrosRef.current));
    setImporteActual(importeInicial);
    importeRef.current = importeInicial;

    if (!reanudando) {
      base44.entities.RideOrder.update(order.id, {
        importe_real_actual: importeInicial,
        segundos_espera_acumulados: 0,
        metros_taximetro: 0,
        segundos_tolerancia_espera_usados: 0,
        taximetro_iniciado: true,
        tarifa_bajada_bandera: tarifaRef.current.bajada_bandera,
        tarifa_valor_ficha: tarifaRef.current.valor_ficha,
        tarifa_metros_por_ficha: tarifaRef.current.metros_por_ficha,
        tarifa_valor_ficha_espera: tarifaRef.current.valor_ficha_espera,
        tarifa_segundos_por_ficha_espera: tarifaRef.current.segundos_por_ficha_espera,
        tarifa_tolerancia_espera_segundos: tarifaRef.current.tolerancia_espera_segundos,
      }).catch(() => {});
    }

    const gpsFilter = createGpsStabilityFilter();
    const onGpsLocation = (event) => {
      const result = gpsFilter.process(event.detail);
      if (!result.accepted) return;
      lastGpsAtRef.current = Date.now();

      if (result.distance > 0) {
        metrosRef.current += result.distance;
        setMetrosRecorridos(Math.round(metrosRef.current));

        const nuevo = calcularImportePorFichas(
          metrosRef.current,
          segundosEspera,
          tarifaRef.current
        );
        const cambioImporte = nuevo !== importeRef.current;
        importeRef.current = nuevo;
        if (cambioImporte) setImporteActual(nuevo);
        saveImporte(nuevo, segundosEspera, metrosRef.current, contadorParadoRef.current, cambioImporte);
      }

      const esperando = result.speedKmh < 5 || esperaManualRef.current;
      setEnEspera(esperando);
      enEsperaRef.current = esperando;
    };

    window.addEventListener(GPS_LOCATION_EVENT, onGpsLocation);

    timerRef.current = setInterval(() => {
      // Respaldo: si después de una lectura válida dejan de llegar puntos por 15 s, se considera detenido.
      const gpsSilencioso = lastGpsAtRef.current > 0 && Date.now() - lastGpsAtRef.current > 15_000;
      
      let stateChanged = false;

      // La tolerancia corre desde el minuto cero del viaje (independiente de si se mueve o está detenido)
      if (contadorParadoRef.current < tarifaRef.current.tolerancia_espera_segundos) {
        contadorParadoRef.current += 1;
        stateChanged = true;
      } else if (enEsperaRef.current || esperaManualRef.current || gpsSilencioso) {
        // Una vez consumida la tolerancia, se suma espera SOLO cuando está detenido
        segundosEspera += 1;
        stateChanged = true;
      }

      if (stateChanged) {
        const nuevo = calcularImportePorFichas(
          metrosRef.current,
          segundosEspera,
          tarifaRef.current
        );
        const cambioImporte = nuevo !== importeRef.current;
        importeRef.current = nuevo;
        if (cambioImporte) setImporteActual(nuevo);
        saveImporte(nuevo, segundosEspera, metrosRef.current, contadorParadoRef.current, cambioImporte);
      }
    }, 1000);

    return () => {
      window.removeEventListener(GPS_LOCATION_EVENT, onGpsLocation);
      gpsFilter.reset();
      clearInterval(timerRef.current);
    };
  }, [order.status, order.id, tarifaCargada]);

  const handleNavigate = () => {
    const address = order.status === "en_viaje" ? order.dropoff_address : order.pickup_address;
    if (address) openMapsNavigation(address, driver?.current_lat, driver?.current_lng);
  };

  const [isFinishing, setIsFinishing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const handleStartRide = async (targetStatus) => {
    if (isStarting || isFinishing) return;
    setIsStarting(true);
    
    const sessionToken = localStorage.getItem("session_token");
    let confirmed = false;
    for (let attempt = 0; attempt < 4 && !confirmed; attempt++) {
      try {
        const res = await base44.functions.invoke("startRide", {
          orderId: order.id,
          driverId: driver.id,
          targetStatus,
          sessionToken
        });
        if (res.data?.success) {
           confirmed = true;
        } else if (res.data?.reason === "OPERATION_IN_PROGRESS") {
           // will retry
        } else {
           break;
        }
      } catch (err) {}
      if (!confirmed) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    
    if (!confirmed) {
      window.alert("No se pudo actualizar el estado del viaje. Revisá tu conexión.");
      window.dispatchEvent(new CustomEvent("radiocab_reconnect"));
    }
    setIsStarting(false);
  };

  const handleCompletar = async () => {
    if (isFinishing || isStarting) return; 
    setIsFinishing(true);
    const finalFare = Math.round(importeRef.current);
    if (onFinishRide) {
      const completed = await onFinishRide(finalFare);
      if (completed === false) setIsFinishing(false);
    } else {
      onStatusChange("completado", finalFare);
    }
  };

  const handleLlegue = async () => {
    if (order.client_id) {
      base44.functions.invoke("sendPushNotification", {
        action: 'send_client_push',
        payloadType: 'bocina',
        userId: order.client_id,
        orderId: order.id
      }).catch(() => {});
    }
    await handleStartRide("en_camino");
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-950">
      <div className="px-4 pt-4 pb-6 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-bold text-white text-base">Viaje en Curso</p>
          <span className={`${cfg?.bg} text-white text-xs font-bold px-3 py-1 rounded-full`}>{cfg?.label}</span>
        </div>

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
          <div className="flex items-center gap-2 text-gray-400 text-xs pt-1 border-t border-gray-800">
            <span className="font-semibold">
              {order.payment_method === "Transferencia" ? "🏦 Transferencia" : "💵 Efectivo"}
            </span>
          </div>
          {order.notes && order.notes.replace(/^\[BROADCAST\]\s*/, "").trim() && (
            <div className="pt-2 border-t border-gray-800 mt-1">
              <p className="text-sm text-yellow-100 italic px-3 py-2 bg-yellow-900/40 rounded-xl border border-yellow-700/50">
                "{order.notes.replace(/^\[BROADCAST\]\s*/, "").trim()}"
              </p>
            </div>
          )}
        </div>

        <button
          className="w-full h-14 rounded-2xl gap-2 bg-red-600 hover:bg-red-700 text-white font-bold text-lg flex items-center justify-center active:scale-95 transition-all shadow-lg animate-pulse"
          onClick={() => {
            base44.entities.PanicAlert.create({
              driver_id: driver.id,
              driver_name: driver.name,
              vehicle_plate: driver.vehicle_plate,
              current_lat: driver.current_lat,
              current_lng: driver.current_lng,
            });
            navigator.vibrate?.([500, 200, 500, 200, 500]);
          }}
        >
          <AlertCircle className="w-6 h-6" /> Botón de Pánico
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            className="w-full h-11 rounded-2xl gap-2 border border-blue-500/40 text-blue-400 bg-blue-500/10 font-semibold text-sm flex items-center justify-center active:scale-95 transition-all"
            onClick={handleNavigate}
          >
            <Navigation className="w-4 h-4" />
            Navegar
          </button>
          
          {order.status === "en_viaje" && (
            <button
              className={`w-full h-11 rounded-2xl gap-2 border font-semibold text-sm flex items-center justify-center active:scale-95 transition-all ${esperaManual ? "bg-amber-500 text-gray-900 border-amber-500" : "border-amber-500/40 text-amber-400 bg-amber-500/10"}`}
              onClick={() => {
                const next = !esperaManual;
                setEsperaManual(next);
                esperaManualRef.current = next;
                if (next) {
                  setEnEspera(true);
                  enEsperaRef.current = true;
                }
              }}
            >
              <Timer className="w-4 h-4" />
              {esperaManual ? "Esperando..." : "Forzar Espera"}
            </button>
          )}
        </div>

        {order.status === "aceptado" && (
          <div className="space-y-2">
            {!order.dropoff_address ? (
              <button className="w-full h-14 rounded-2xl gap-2 bg-cyan-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg disabled:opacity-50" onClick={() => handleStartRide("en_viaje")} disabled={isStarting || isFinishing}>
                <Car className="w-5 h-5" /> {isStarting ? "Iniciando..." : "Iniciar Viaje (Sin Destino)"}
              </button>
            ) : (
              <button className="w-full h-14 rounded-2xl gap-2 bg-amber-500 text-gray-900 text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg disabled:opacity-50" onClick={handleLlegue} disabled={isStarting || isFinishing}>
                <AlertCircle className="w-5 h-5" /> {isStarting ? "Avisando..." : "Llegué a la Puerta (Avisar)"}
              </button>
            )}
            <button className="w-full h-11 rounded-2xl gap-2 border border-red-500/40 text-red-400 bg-red-500/10 font-semibold text-sm flex items-center justify-center active:scale-95 transition-all disabled:opacity-50" onClick={onCancelRide} disabled={isStarting || isFinishing}>
              <XCircle className="w-4 h-4" /> Anular — volver a mi base
            </button>
          </div>
        )}
        {order.status === "en_camino" && (
          <div className="space-y-2">
            <button className="w-full h-14 rounded-2xl gap-2 bg-cyan-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg disabled:opacity-50" onClick={() => handleStartRide("en_viaje")} disabled={isStarting || isFinishing}>
              <Car className="w-5 h-5" /> {isStarting ? "Iniciando..." : "Pasajero a Bordo"}
            </button>
            <button className="w-full h-11 rounded-2xl gap-2 border border-red-500/40 text-red-400 bg-red-500/10 font-semibold text-sm flex items-center justify-center active:scale-95 transition-all disabled:opacity-50" onClick={onCancelRide} disabled={isStarting || isFinishing}>
              <XCircle className="w-4 h-4" /> Anular — no salió / cancelar
            </button>
          </div>
        )}
        {order.status === "en_viaje" && (
          <button className="w-full h-14 rounded-2xl gap-2 bg-green-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg disabled:opacity-50" onClick={handleCompletar} disabled={isFinishing || isStarting}>
            <CheckCircle2 className="w-5 h-5" /> {isFinishing ? "Terminando..." : `Terminar Viaje · $${importeActual.toLocaleString()}`}
          </button>
        )}
      </div>

    </div>
  );
}