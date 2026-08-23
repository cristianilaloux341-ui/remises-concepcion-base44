export function haversineMetros(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calcularImportePorFichas(metros: number, segundosEspera: number, tarifa: any) {
  const metrosPorFicha = Math.max(1, Number(tarifa.metros_por_ficha));
  const segundosPorFicha = Math.max(1, Number(tarifa.segundos_por_ficha_espera));
  const fichasDistancia = Math.floor(Math.max(0, metros) / metrosPorFicha);
  
  const sEspera = Math.max(0, segundosEspera);
  const fichasEspera = sEspera > 0 ? 1 + Math.floor((sEspera - 1) / segundosPorFicha) : 0;

  return Math.round(
    Number(tarifa.bajada_bandera)
    + fichasDistancia * Number(tarifa.valor_ficha)
    + fichasEspera * Number(tarifa.valor_ficha_espera)
  );
}