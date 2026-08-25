import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Cero es intencional: la empresa define todos los parámetros desde Central.
// No debe existir una tarifa oculta de respaldo en cliente, Central ni chofer.
export const METROS_POR_FICHA = 0;
export const VALOR_FICHA = 0;
export const SEGUNDOS_POR_FICHA_ESPERA = 0;

export const TARIFA_DEFAULTS = {
  bajada_bandera: 0,
  nocturna_bajada_bandera: 0,
  valor_ficha: 0,
  metros_por_ficha: 0,
  valor_ficha_espera: 0,
  segundos_por_ficha_espera: 0,
  tolerancia_espera_segundos: 0,
  nocturna_hora_inicio: 0,
  nocturna_hora_fin: 0,
};

function esHorarioNocturno(horaInicio, horaFin, fecha = new Date()) {
  // Si no hay una ventana nocturna configurada, no se activa tarifa nocturna.
  if (horaInicio === horaFin) return false;
  const hora = fecha.getHours();
  if (horaInicio > horaFin) return hora >= horaInicio || hora < horaFin;
  return hora >= horaInicio && hora < horaFin;
}

export function normalizarTarifa(raw = {}, fecha = new Date()) {
  const horaInicio = Number(raw.nocturna_hora_inicio ?? 0);
  const horaFin = Number(raw.nocturna_hora_fin ?? 0);
  const nocturna = esHorarioNocturno(horaInicio, horaFin, fecha);
  return {
    bajada_bandera: Math.max(0, Number(nocturna ? (raw.nocturna_bajada_bandera ?? 0) : (raw.bajada_bandera ?? 0))),
    valor_ficha: Math.max(0, Number(raw.valor_ficha ?? 0)),
    metros_por_ficha: Math.max(0, Number(raw.metros_por_ficha ?? 0)),
    valor_ficha_espera: Math.max(0, Number(raw.valor_ficha_espera ?? 0)),
    segundos_por_ficha_espera: Math.max(0, Number(raw.segundos_por_ficha_espera ?? 0)),
    tolerancia_espera_segundos: Math.max(0, Number(raw.tolerancia_espera_segundos ?? 0)),
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

export function haversineMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distancia de ruta para cotización previa origen → destino. */
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
    if (res.data?.distance) return res.data.distance;
  } catch (_) {}

  // Solo fallback geométrico de distancia; nunca introduce una tarifa monetaria.
  const distStraight = haversineMetros(origenCoords.lat, origenCoords.lng, destinoCoords.lat, destinoCoords.lng);
  return distStraight * 1.3;
}

/** Misma matemática de fichas usada por el servidor. */
export function calcularImportePorFichas(metros, segundosEspera, tarifaOBase) {
  const tarifa = typeof tarifaOBase === "number"
    ? { ...TARIFA_DEFAULTS, bajada_bandera: Math.max(0, Number(tarifaOBase || 0)) }
    : { ...TARIFA_DEFAULTS, ...(tarifaOBase || {}) };

  const bajada = Math.max(0, Number(tarifa.bajada_bandera ?? 0));
  const metrosPorFicha = Math.max(0, Number(tarifa.metros_por_ficha ?? 0));
  const valorFicha = Math.max(0, Number(tarifa.valor_ficha ?? 0));
  const segundosPorFicha = Math.max(0, Number(tarifa.segundos_por_ficha_espera ?? 0));
  const valorFichaEspera = Math.max(0, Number(tarifa.valor_ficha_espera ?? 0));

  const fichasDistancia = metrosPorFicha > 0 && valorFicha > 0
    ? Math.floor(Math.max(0, metros) / metrosPorFicha)
    : 0;
  const fichasEspera = segundosPorFicha > 0 && valorFichaEspera > 0
    ? Math.floor(Math.max(0, segundosEspera) / segundosPorFicha)
    : 0;

  return Math.round(bajada + fichasDistancia * valorFicha + fichasEspera * valorFichaEspera);
}

/** Cotización previa: origen/destino cobra distancia teórica, no espera futura. */
export function calcularImporte(distanciaMetros, tarifa) {
  return calcularImportePorFichas(distanciaMetros, 0, tarifa);
}
