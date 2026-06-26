import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const DEFAULTS = {
  bajada_bandera: 500,
  precio_por_metro: 2,
  precio_por_minuto_corrido: 30,
  precio_por_minuto_espera: 50,
  tolerancia_espera_segundos: 120,
  nocturna_bajada_bandera: 700,
  nocturna_precio_por_metro: 2.8,
  nocturna_precio_por_minuto_corrido: 45,
  nocturna_precio_por_minuto_espera: 70,
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
    const res = await base44.functions.invoke("geocodeRoute", {
      action: "route",
      originLat: origenCoords.lat,
      originLng: origenCoords.lng,
      destLat: destinoCoords.lat,
      destLng: destinoCoords.lng,
    });
    return res.data?.distance ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Calcula importe estimado.
 */
export function calcularImporte(distanciaMetros, tarifa) {
  const precioPorMetro = tarifa.precio_por_metro ?? 2;
  return Math.round(tarifa.bajada_bandera + distanciaMetros * precioPorMetro);
}