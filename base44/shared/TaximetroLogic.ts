export function haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calcularImportePorFichas(metros: number, segundosEspera: number, tarifa: any) {
  const bajada = Math.max(0, Number(tarifa.bajada_bandera ?? 0));
  const metrosPorFicha = Math.max(0, Number(tarifa.metros_por_ficha ?? 0));
  const valorFicha = Math.max(0, Number(tarifa.valor_ficha ?? 0));
  const segundosPorFicha = Math.max(0, Number(tarifa.segundos_por_ficha_espera ?? 0));
  const valorFichaEspera = Math.max(0, Number(tarifa.valor_ficha_espera ?? 0));

  // Cero significa "modalidad no configurada": nunca se reemplaza por un valor oculto.
  const fichasDistancia = metrosPorFicha > 0 && valorFicha > 0
    ? Math.floor(Math.max(0, metros) / metrosPorFicha)
    : 0;

  const sEspera = Math.max(0, segundosEspera);
  const fichasEspera = segundosPorFicha > 0 && valorFichaEspera > 0
    ? Math.floor(sEspera / segundosPorFicha)
    : 0;

  return Math.round(bajada + fichasDistancia * valorFicha + fichasEspera * valorFichaEspera);
}