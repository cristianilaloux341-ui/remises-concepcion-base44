import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const DEFAULTS = {
  bajada_bandera: 500,
  precio_por_metro: 2,
  precio_por_minuto_espera: 50,
  tolerancia_espera_segundos: 120,
};

export function useTarifaConfig() {
  const { data: configs = [] } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
    staleTime: 60_000,
  });

  const raw = configs[0] || {};
  return {
    bajada_bandera: raw.bajada_bandera ?? DEFAULTS.bajada_bandera,
    precio_por_metro: raw.precio_por_metro ?? DEFAULTS.precio_por_metro,
    precio_por_minuto_espera: raw.precio_por_minuto_espera ?? DEFAULTS.precio_por_minuto_espera,
    tolerancia_espera_segundos: raw.tolerancia_espera_segundos ?? DEFAULTS.tolerancia_espera_segundos,
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
export async function calcularDistanciaRuta(origen, destino) {
  try {
    const geocode = async (addr) => {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`,
        { headers: { "Accept-Language": "es" } }
      );
      const data = await r.json();
      if (!data.length) return null;
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    };

    const [o, d] = await Promise.all([geocode(origen), geocode(destino)]);
    if (!o || !d) return null;

    const osrm = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=false`
    );
    const routeData = await osrm.json();
    if (routeData.code !== "Ok" || !routeData.routes?.length) return null;
    return Math.round(routeData.routes[0].distance);
  } catch (_) {
    return null;
  }
}

/**
 * Calcula importe estimado.
 */
export function calcularImporte(distanciaMetros, tarifa) {
  return Math.round(tarifa.bajada_bandera + distanciaMetros * tarifa.precio_por_metro);
}