import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export const METROS_POR_FICHA = 82;
export const VALOR_FICHA = 100;
export const SEGUNDOS_POR_FICHA_ESPERA = 45;

export const TARIFA_DEFAULTS = {
  bajada_bandera: 1700,
  nocturna_bajada_bandera: 1900,
  valor_ficha: VALOR_FICHA,
  metros_por_ficha: METROS_POR_FICHA,
  valor_ficha_espera: VALOR_FICHA,
  segundos_por_ficha_espera: SEGUNDOS_POR_FICHA_ESPERA,
  tolerancia_espera_segundos: 240,
  nocturna_hora_inicio: 22,
  nocturna_hora_fin: 6,
};

function esHorarioNocturno(horaInicio, horaFin, fecha = new Date()) {
  const hora = fecha.getHours();
  if (horaInicio > horaFin) {
    return hora >= horaInicio || hora < horaFin;
  }
  return hora >= horaInicio && hora < horaFin;
}

export function normalizarTarifa(raw = {}, fecha = new Date()) {
  const horaInicio = Number(raw.nocturna_hora_inicio ?? TARIFA_DEFAULTS.nocturna_hora_inicio);
  const horaFin = Number(raw.nocturna_hora_fin ?? TARIFA_DEFAULTS.nocturna_hora_fin);
  const nocturna = esHorarioNocturno(horaInicio, horaFin, fecha);
  return {
    bajada_bandera: Number(nocturna
      ? (raw.nocturna_bajada_bandera ?? TARIFA_DEFAULTS.nocturna_bajada_bandera)
      : (raw.bajada_bandera ?? TARIFA_DEFAULTS.bajada_bandera)),
    valor_ficha: Number(raw.valor_ficha ?? TARIFA_DEFAULTS.valor_ficha),
    metros_por_ficha: Number(raw.metros_por_ficha ?? TARIFA_DEFAULTS.metros_por_ficha),
    valor_ficha_espera: Number(raw.valor_ficha_espera ?? raw.valor_ficha ?? TARIFA_DEFAULTS.valor_ficha_espera),
    segundos_por_ficha_espera: Number(raw.segundos_por_ficha_espera ?? TARIFA_DEFAULTS.segundos_por_ficha_espera),
    tolerancia_espera_segundos: Number(raw.tolerancia_espera_segundos ?? TARIFA_DEFAULTS.tolerancia_espera_segundos),
    es_nocturna: nocturna,
    nocturna_hora_inicio: horaInicio,
    nocturna_hora_fin: horaFin,
  };
}

export function useTarifaConfig() {
  const { data: configs = [] } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
    staleTime: 60_000,
  });
  return normalizarTarifa(configs[0] || {});
}

/**
 * Haversine: distancia en línea recta entre dos coordenadas (metros).
 */
export function haversineMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calcula distancia de ruta real usando Mapbox Directions API (via backend proxy).
 * Requiere coordenadas exactas de Google Places.
 * Retorna metros (number) o null si falla.
 */
export async function calcularDistanciaRuta(origen, destino, origenCoords = null, destinoCoords = null) {
  if (!origenCoords || !destinoCoords) return null;
  try {
    const sessionToken = localStorage.getItem('client_token') || sessionStorage.getItem('local_operator_token') || 'client_demo_token';
    const res = await base44.functions.invoke("geocodeRoute", {
      action: "route",
      originLat: origenCoords.lat,
      originLng: origenCoords.lng,
      destLat: destinoCoords.lat,
      destLng: destinoCoords.lng,
      sessionToken
    });
    if (res.data?.distance) {
      return res.data.distance;
    }
  } catch (_) {}
  
  // Fallback Haversine + 30% por calles urbanas (mismo que app cliente)
  const distStraight = haversineMetros(origenCoords.lat, origenCoords.lng, destinoCoords.lat, destinoCoords.lng);
  return distStraight * 1.3;
}

/**
 * Reproduce el reloj físico: $100 cada 85 m y $100 cada 30 s de espera
 * después de consumir una única tolerancia acumulada de 120 s.
 */
export function calcularImportePorFichas(metros, segundosEspera, tarifaOBase) {
  // Compatibilidad: las llamadas antiguas pueden seguir pasando solo la bajada.
  const tarifa = typeof tarifaOBase === "number"
    ? { ...TARIFA_DEFAULTS, bajada_bandera: tarifaOBase }
    : { ...TARIFA_DEFAULTS, ...(tarifaOBase || {}) };
  const metrosPorFicha = Math.max(1, Number(tarifa.metros_por_ficha));
  const segundosPorFicha = Math.max(1, Number(tarifa.segundos_por_ficha_espera));
  const fichasDistancia = Math.floor(Math.max(0, metros) / metrosPorFicha);
  const fichasEspera = Math.floor(Math.max(0, segundosEspera) / segundosPorFicha);
  return Math.round(
    Number(tarifa.bajada_bandera)
    + fichasDistancia * Number(tarifa.valor_ficha)
    + fichasEspera * Number(tarifa.valor_ficha_espera)
  );
}

/**
 * Estimación previa del viaje. El tiempo en movimiento no se cobra.
 */
export function calcularImporte(distanciaMetros, tarifa) {
  return calcularImportePorFichas(distanciaMetros, 0, tarifa);
}