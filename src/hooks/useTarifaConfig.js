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
    // Rango nocturno cruza medianoche (ej: 22 → 6)
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
 * Calcula distancia en metros entre dos pares lat/lng usando Haversine.
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
 * Llama a OSRM (open source, sin API key) para obtener distancia de ruta real entre dos direcciones.
 * Primero geocodifica con Nominatim, luego obtiene ruta con OSRM.
 * Retorna metros (number) o null si falla.
 */
const CIUDAD = "Concepción del Uruguay, Entre Ríos, Argentina";
// Bounding box de Concepción del Uruguay (viewbox para Nominatim)
const VIEWBOX = "-58.35,-33.20,-58.15,-33.08";

export async function calcularDistanciaRuta(origen, destino, origenCoords = null, destinoCoords = null) {
  try {
    const geocode = async (addr) => {
      const query = `${addr}, ${CIUDAD}`;
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=ar&bounded=1&viewbox=${VIEWBOX}`,
          { headers: { "Accept-Language": "es", "User-Agent": "remiseria-app/1.0" }, signal: AbortSignal.timeout(5000) }
        );
        const data = await r.json();
        if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        // Fallback sin bounded
        const r2 = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=ar&viewbox=${VIEWBOX}`,
          { headers: { "Accept-Language": "es", "User-Agent": "remiseria-app/1.0" }, signal: AbortSignal.timeout(5000) }
        );
        const data2 = await r2.json();
        if (data2.length) return { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon) };
      } catch (_) {}
      return null;
    };

    // Usar coords ya conocidas; geocodificar solo las que faltan
    const [o, d] = await Promise.all([
      origenCoords ? Promise.resolve(origenCoords) : geocode(origen),
      destinoCoords ? Promise.resolve(destinoCoords) : geocode(destino),
    ]);
    if (!o || !d) return null;

    // OSRM: ruta real por calles
    try {
      const osrm = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=false`,
        { signal: AbortSignal.timeout(6000) }
      );
      const routeData = await osrm.json();
      if (routeData.code === "Ok" && routeData.routes?.length) {
        return Math.round(routeData.routes[0].distance);
      }
    } catch (_) {}

    // Fallback: haversine × 1.3 si OSRM no responde
    const lineal = haversineMetros(o.lat, o.lng, d.lat, d.lng);
    return Math.round(lineal * 1.3);
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