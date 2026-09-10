export async function findNextDriverInZone(b44: any, order: any, excludeDriverId: string | null) {
  const targetZone = order.zone;
  if (!targetZone) return null;

  // Traer únicamente los choferes de la zona objetivo.
  const zoneDrivers = await b44.entities.Driver.filter({
    status: "disponible",
    current_base: targetZone
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

  const allMoviles = movilOr.length
    ? await b44.entities.Movil.filter({ $or: movilOr })
    : [];

  const isDriverWorking = (d: any) => {
    if (d.status !== 'disponible') return false;
    const mobileId = String(d.vehicle_model || '');
    const mobileNumber = parseInt(mobileId, 10);
    const movil = allMoviles.find((m: any) => m.id === mobileId || m.numero_movil === mobileNumber);
    if (!movil || movil.activo === false || movil.fuera_de_servicio === true) {
      return false;
    }
    return true;
  };

  // offered_driver_ids holds previously offered drivers. We cap at 1 offer per driver.
  const offeredDriverIds = order.offered_driver_ids || [];
  
  const available = zoneDrivers.filter((d: any) => {
    const isExcluded = excludeDriverId && d.id === excludeDriverId;
    const isAlreadyOffered = offeredDriverIds.includes(d.id);
    return isDriverWorking(d) && 
           !d.active_order_id && 
           !d.active_ride_id && 
           !d.reserved_order_id && 
           (d.dispatch_status == null || d.dispatch_status === 'normal') &&
           !isExcluded &&
           !isAlreadyOffered;
  });

  const sameBaseQueue = available
    .filter((d: any) => d.current_base === targetZone)
    .sort((a: any, b: any) => {
      const timeA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : Infinity;
      const timeB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : Infinity;
      const tA = isNaN(timeA) ? Infinity : timeA;
      const tB = isNaN(timeB) ? Infinity : timeB;
      if (tA !== tB) return tA - tB;
      return (a.id || "").localeCompare(b.id || "");
    });

  if (sameBaseQueue.length > 0) {
    return sameBaseQueue[0];
  }
  return null;
}