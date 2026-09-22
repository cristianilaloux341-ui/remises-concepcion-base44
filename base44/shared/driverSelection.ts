import { getEffectiveQueueBase } from './queueOrder.ts';

export async function findNextDriverInZone(b44: any, order: any, excludeDriverId: string | Set<string> | null) {
  const targetZone = order.zone;
  if (!targetZone) return null;

  // La cola se consulta por autoridad server-side. `current_base` puede parpadear a
  // null en APK legacy; mientras queue_authoritative_base + queue_position sigan
  // vigentes, el móvil continúa perteneciendo a su cola sin ninguna gracia temporal.
  const zoneDrivers = await b44.entities.Driver.filter({
    status: "disponible",
    queue_authoritative_base: targetZone
  });

  // Driver.vehicle_model guarda el ID del móvil. No descargar toda la flota:
  // validar solamente los móviles vinculados a los choferes de ESTA zona.
  const driverIds = [...new Set(zoneDrivers.map((d: any) => d.id).filter(Boolean))];
  const mobileIds = [...new Set(zoneDrivers.map((d: any) => String(d.vehicle_model || '')).filter(Boolean))];
  const mobileNumbers = [...new Set(zoneDrivers.map((d: any) => parseInt(String(d.vehicle_model || ''), 10)).filter((n: number) => Number.isFinite(n)))];
  const plates = [...new Set(zoneDrivers.map((d: any) => String(d.vehicle_plate || '').replace(/\s+/g, '').toUpperCase()).filter(Boolean))];

  const movilOr: any[] = [];
  if (mobileIds.length) movilOr.push({ id: { $in: mobileIds } });
  if (mobileNumbers.length) movilOr.push({ numero_movil: { $in: mobileNumbers } });
  if (driverIds.length) {
    movilOr.push({ driver_id: { $in: driverIds } });
    movilOr.push({ driver_ids: { $in: driverIds } });
  }
  if (plates.length) movilOr.push({ dominio: { $in: plates } });

  // Una selección A→B→C puede repetirse varias veces si otro despacho ganó el
  // candidato por milisegundos. No hacemos un get() por cada móvil de la zona en
  // cada intento: el filtro por vínculos/número/patente resuelve el lote primero y
  // sólo consultamos por ID los vehicle_model que realmente hayan quedado sin
  // resolver. Esto mantiene la misma validación sin multiplicar llamadas bajo carga.
  const movilesByFallback = movilOr.length
    ? await b44.entities.Movil.filter({ $or: movilOr }).catch(() => [])
    : [];
  const fallbackIds = new Set((movilesByFallback || []).map((m:any) => String(m.id || '')));
  const unresolvedMobileIds = mobileIds.filter((id:string) => !fallbackIds.has(id));
  const movilesById = unresolvedMobileIds.length
    ? await Promise.all(unresolvedMobileIds.map((id:string) => b44.entities.Movil.get(id).catch(() => null)))
    : [];
  const allMoviles = [...movilesByFallback, ...movilesById.filter(Boolean)]
    .filter((m: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === m.id) === i);

  const getEffectiveBase = (d:any) => getEffectiveQueueBase(d);
  const getEffectiveQueuePos = (d:any) => {
    if (!getEffectiveQueueBase(d)) return Infinity;
    const pos = Number(d.queue_position);
    return Number.isFinite(pos) && pos > 0 ? pos : Infinity;
  };

  const isDriverWorking = (d: any) => {
    if (d.status !== 'disponible' || getEffectiveBase(d) !== targetZone) return false;
    const mobileId = String(d.vehicle_model || '');
    const mobileNumber = parseInt(mobileId, 10);
    const driverPlate = String(d.vehicle_plate || '').replace(/\s+/g, '').toUpperCase();
    const movil = allMoviles.find((m: any) =>
      m.id === mobileId ||
      m.numero_movil === mobileNumber ||
      m.driver_id === d.id ||
      (Array.isArray(m.driver_ids) && m.driver_ids.includes(d.id)) ||
      (driverPlate && String(m.dominio || '').replace(/\s+/g, '').toUpperCase() === driverPlate)
    );
    if (!movil || movil.activo === false || movil.fuera_de_servicio === true || movil.suspension_motivo) {
      return false;
    }
    return true;
  };

  // offered_driver_ids holds previously offered drivers. We cap at 1 offer per driver.
  const offeredDriverIds = order.offered_driver_ids || [];
  
  const available = zoneDrivers.filter((d: any) => {
    const isExcluded = excludeDriverId instanceof Set
      ? excludeDriverId.has(d.id)
      : Boolean(excludeDriverId && d.id === excludeDriverId);
    const isAlreadyOffered = offeredDriverIds.includes(d.id);
    const isBlocked = Number(d.bloqueo_post_aceptacion_hasta) > Date.now();
    return isDriverWorking(d) && 
           !d.active_order_id && 
           !d.active_ride_id && 
           !d.reserved_order_id && 
           (d.dispatch_status == null || d.dispatch_status === 'normal') &&
           !isExcluded &&
           !isAlreadyOffered &&
           !isBlocked;
  });

  const sameBaseQueue = available
    .filter((d: any) => getEffectiveBase(d) === targetZone)
    .sort((a: any, b: any) => {
      const posA = getEffectiveQueuePos(a);
      const posB = getEffectiveQueuePos(b);
      if (posA !== posB) return posA - posB;
      return (a.id || "").localeCompare(b.id || "");
    });

  if (sameBaseQueue.length > 0) {
    return sameBaseQueue[0];
  }
  return null;
}