import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export const METROS_POR_FICHA = 85;
export const VALOR_FICHA = 100;
export const SEGUNDOS_POR_FICHA_ESPERA = 30;

const DEFAULTS = {
  bajada_bandera: 1700,
  precio_por_metro: VALOR_FICHA / METROS_POR_FICHA,
  precio_por_minuto_corrido: 0,
  precio_por_minuto_espera: 200,
  tolerancia_espera_segundos: 120,
  nocturna_bajada_bandera: 1900,
  nocturna_precio_por_metro: VALOR_FICHA / METROS_POR_FICHA,
  nocturna_precio_por_minuto_corrido: 0,
  nocturna_precio_por_minuto_espera: 200,
  nocturna_hora_inicio: 22,
  nocturna_hora_fin: 6,
};

function esHorarioNocturno(horaInicio, horaFin) {
  const hora = new Date().getHours();
  if (horaInicio > horaFin) {
    return hora >= horaInicio || hora < horaFin;
  }
  return hora >= horaInicio && hora < horaFin;
}

export function useTarifaConfig() {
  const { data: configs = [] } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
    staleTime: 60_000,
  });

  const raw = configs[0] || {};
  const nocturna = esHorarioNocturno(
    raw.nocturna_hora_inicio ?? DEFAULTS.nocturna_hora_inicio,
    raw.nocturna_hora_fin ?? DEFAULTS.nocturna_hora_fin
  );

  if (nocturna) {
    return {
      bajada_bandera: raw.nocturna_bajada_bandera ?? DEFAULTS.nocturna_bajada_bandera,
      precio_por_metro: raw.nocturna_precio_por_metro ?? DEFAULTS.nocturna_precio_por_metro,
      precio_por_minuto_corrido: raw.nocturna_precio_por_minuto_corrido ?? DEFAULTS.nocturna_precio_por_minuto_corrido,
      precio_por_minuto_espera: raw.nocturna_precio_por_minuto_espera ?? DEFAULTS.nocturna_precio_por_minuto_espera,
      tolerancia_espera_segundos: raw.tolerancia_espera_segundos ?? DEFAULTS.tolerancia_espera_segundos,
      es_nocturna: true,
    };
  }

  return {
    bajada_bandera: raw.bajada_bandera ?? DEFAULTS.bajada_bandera,
    precio_por_metro: raw.precio_por_metro ?? DEFAULTS.precio_por_metro,
    precio_por_minuto_corrido: raw.precio_por_minuto_corrido ?? DEFAULTS.precio_por_minuto_corrido,
    precio_por_minuto_espera: raw.precio_por_minuto_espera ?? DEFAULTS.precio_por_minuto_espera,
    tolerancia_espera_segundos: raw.tolerancia_espera_segundos ?? DEFAULTS.tolerancia_espera_segundos,
    es_nocturna: false,
  };
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
export function calcularImportePorFichas(metros, segundosEspera, bajadaBandera) {
  const fichasDistancia = Math.floor(Math.max(0, metros) / METROS_POR_FICHA);
  const fichasEspera = Math.floor(Math.max(0, segundosEspera) / SEGUNDOS_POR_FICHA_ESPERA);
  return Math.round(bajadaBandera + ((fichasDistancia + fichasEspera) * VALOR_FICHA));
}

/**
 * Estimación previa del viaje. El tiempo en movimiento no se cobra.
 */
export function calcularImporte(distanciaMetros, tarifa) {
  return calcularImportePorFichas(distanciaMetros, 0, tarifa.bajada_bandera);
}