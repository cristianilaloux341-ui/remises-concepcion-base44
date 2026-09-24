import { getEffectiveQueueBase } from './queueOrder.ts';

export async function findNextDriverInZone(b44: any, order: any, excludeDriverId: string | Set<string> | null) {
  const targetZone = order.zone;
  if (!targetZone) return null;

  // La cola se consulta exclusivamente por autoridad server-side:
  // queue_authoritative_base + queue_position. Los campos de proyección no
  // participan en la selección ni pueden alterar la prioridad.
  const zoneDrivers = await b44.entities.Driver.filter({
    status: "disponible",
    queue_authoritative_base: targetZone
  });

  // Driver.vehicle_model es la única referencia autoritativa al Movil.
  // No inferimos identidad por número, patente, driver_id ni caches legacy.
  const mobileIds = [...new Set(zoneDrivers.map((d: any) => String(d.vehicle_model || '')).filter(Boolean))];
  const allMoviles = mobileIds.length
    ? (await Promise.all(mobileIds.map((id:string) => b44.entities.Movil.get(id).catch(() => null)))).filter(Boolean)
    : [];

  const getEffectiveBase = (d:any) => getEffectiveQueueBase(d);
  const getEffectiveQueuePos = (d:any) => {
    if (!getEffectiveQueueBase(d)) return Infinity;
    const pos = Number(d.queue_position);
    return Number.isFinite(pos) && pos > 0 ? pos : Infinity;
  };

  const isDriverWorking = (d: any) => {
    if (d.status !== 'disponible' || getEffectiveBase(d) !== targetZone) return false;
    const mobileId = String(d.vehicle_model || '');
    const movil = allMoviles.find((m: any) => String(m.id || '') === mobileId);
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
           !d.active_ride_id && 
           !d.active_ride_id && 
           !d.reserved_order_id &&
           !d.next_order_id &&
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