import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { haversineMetros } from "@/hooks/useTarifaConfig";
import { MapPin, Phone, Navigation, Car, CheckCircle2, XCircle, Timer } from "lucide-react";

export const STATUS_CONFIG = {
  ofrecido:  { label: "Nuevo Viaje",    bg: "bg-amber-500"  },
  aceptado:  { label: "Aceptado",       bg: "bg-blue-500"   },
  en_camino: { label: "En Camino",      bg: "bg-purple-500" },
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

  const metrosRef = useRef(0);
  const importeRef = useRef(importeActual);
  const contadorParadoRef = useRef(0);
  const enEsperaRef = useRef(false); // ref para evitar stale closure en setInterval
  const lastPosRef = useRef(null);
  const gpsWatchRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { importeRef.current = importeActual; }, [importeActual]);

  const distanciaTeórica = order.distancia_teorica_metros || 0;
  const tarifaRef = useRef({
    bajada_bandera: 500,
    precio_por_metro: 2,
    precio_por_minuto_espera: 50,
    tolerancia_espera_segundos: 120,
  });

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

  const saveTimeoutRef = useRef(null);
  const saveImporte = (nuevoImporte, segundosEspera) => {
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      base44.entities.RideOrder.update(order.id, {
        importe_real_actual: Math.round(nuevoImporte),
        segundos_espera_acumulados: segundosEspera,
      }).catch(() => {});
    }, 3000); 
  };

  useEffect(() => {
    if (order.status !== "en_viaje") return;

    // Si no hay destino, la base inicial es la bajada de bandera
    const importeInicial = order.importe_real_actual || order.importe_estimado || tarifaRef.current.bajada_bandera;
    setImporteActual(importeInicial);
    importeRef.current = importeInicial;
    metrosRef.current = 0;
    contadorParadoRef.current = 0;
    let segundosEspera = order.segundos_espera_acumulados || 0;

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

            let costoIncremental = 0;
            if (!order.dropoff_address) {
                // Sin destino: cuenta desde el primer metro
                costoIncremental = metros * tarifaRef.current.precio_por_metro;
            } else if (metrosRef.current > distanciaTeórica) {
                // Con destino: cobra el excedente
                const excedenteAnterior = (metrosRef.current - metros) - distanciaTeórica;
                if (excedenteAnterior < 0) {
                   const metrosExcedentes = metrosRef.current - distanciaTeórica;
                   costoIncremental = metrosExcedentes * tarifaRef.current.precio_por_metro;
                } else {
                   costoIncremental = metros * tarifaRef.current.precio_por_metro;
                }
            }

            if (costoIncremental > 0) {
                importeRef.current += costoIncremental;
                setImporteActual(Math.round(importeRef.current));
            }
          }
        }

        lastPosRef.current = { lat: latitude, lng: longitude };

        if (speedKmh < 5) {
          setEnEspera(true);
          enEsperaRef.current = true;
        } else {
          contadorParadoRef.current = 0;
          setEnEspera(false);
          enEsperaRef.current = false;
        }
      }, () => {}, { enableHighAccuracy: true, maximumAge: 0 });
    }

    timerRef.current = setInterval(() => {
      if (enEsperaRef.current || contadorParadoRef.current > 0) {
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
  }, [order.status, order.id]);

  const handleNavigate = () => {
    const address = order.status === "en_viaje" ? order.dropoff_address : order.pickup_address;
    if (address) openMapsNavigation(address, driver?.current_lat, driver?.current_lng);
  };

  const [isFinishing, setIsFinishing] = useState(false);
  const handleCompletar = async () => {
    if (isFinishing) return; 
    setIsFinishing(true);
    clearTimeout(saveTimeoutRef.current);
    const finalFare = Math.round(importeRef.current);
    if (onFinishRide) {
      await onFinishRide(finalFare);
    } else {
      onStatusChange("completado", finalFare);
    }
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
        </div>

        <button
          className="w-full h-11 rounded-2xl gap-2 border border-blue-500/40 text-blue-400 bg-blue-500/10 font-semibold text-sm flex items-center justify-center active:scale-95 transition-all"
          onClick={handleNavigate}
        >
          <Navigation className="w-4 h-4" />
          Navegar con Google Maps
        </button>

        {order.status === "aceptado" && (
          <div className="space-y-2">
            {!order.dropoff_address ? (
              <button className="w-full h-14 rounded-2xl gap-2 bg-cyan-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg" onClick={() => onStatusChange("en_viaje")}>
                <Car className="w-5 h-5" /> Iniciar Viaje (Sin Destino)
              </button>
            ) : (
              <button className="w-full h-14 rounded-2xl gap-2 bg-purple-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg" onClick={() => onStatusChange("en_camino")}>
                <Navigation className="w-5 h-5" /> Saliendo a Buscar
              </button>
            )}
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
          <button className="w-full h-14 rounded-2xl gap-2 bg-green-600 text-white text-base font-bold flex items-center justify-center active:scale-95 transition-all shadow-lg disabled:opacity-50" onClick={handleCompletar} disabled={isFinishing}>
            <CheckCircle2 className="w-5 h-5" /> {isFinishing ? "Terminando..." : `Terminar Viaje · $${importeActual.toLocaleString()}`}
          </button>
        )}
      </div>

    </div>
  );
}