export function getEffectiveQueueEnteredAt(driver: any) {
  if (!driver) return null;
  const currentBase = driver.current_base || null;
  const authoritativeBase = driver.queue_authoritative_base || null;
  if (!currentBase) return null;
  // Mientras una entrada/cambio todavía no fue sellado por servidor, no inventamos
  // una posición provisoria con la hora del teléfono.
  if (!authoritativeBase || authoritativeBase !== currentBase) return null;
  return driver.queue_authoritative_at || null;
}

export function sortQueue(driversArray: any[]) {
  return driversArray.sort((a, b) => {
    const queueA = getEffectiveQueueEnteredAt(a);
    const queueB = getEffectiveQueueEnteredAt(b);
    const timeA = queueA ? new Date(queueA).getTime() : Infinity;
    const timeB = queueB ? new Date(queueB).getTime() : Infinity;
    const tA = isNaN(timeA) ? Infinity : timeA;
    const tB = isNaN(timeB) ? Infinity : timeB;
    if (tA !== tB) return tA - tB;
    return (a.id || "").localeCompare(b.id || "");
  });
}

export function getBaseQueue(drivers: any[], baseName: string) {
  return sortQueue(drivers.filter(d =>
    d.current_base === baseName &&
    d.queue_authoritative_base === baseName &&
    Boolean(d.queue_authoritative_at) &&
    d.status === "disponible" &&
    (d.dispatch_status == null || d.dispatch_status === "normal") &&
    !d.reserved_order_id &&
    !d.active_order_id &&
    !d.active_ride_id
  ));
}

// Sella una entrada NUEVA siempre detrás del último móvil que ya existe en la base.
// No confía en la hora del teléfono ni en Date.now() a secas: un reorden manual puede
// haber dejado una marca ligeramente futura. Tomamos la cola fresca del servidor y
// usamos como mínimo (último + 1 ms). Así "entra = último" es una regla matemática.
export async function getNextQueueTailAt(b44: any, baseName: string, excludeDriverId: string | null = null) {
  const drivers = await b44.entities.Driver.filter({
    status: "disponible",
    current_base: baseName
  }).catch(() => []);

  let nextMs = Date.now();
  for (const d of drivers || []) {
    if (!d || d.id === excludeDriverId) continue;
    if (d.current_base !== baseName) continue;
    if (d.queue_authoritative_base !== baseName || !d.queue_authoritative_at) continue;
    if (d.dispatch_status != null && d.dispatch_status !== "normal") continue;
    if (d.reserved_order_id || d.active_order_id || d.active_ride_id) continue;

    const raw = d.queue_authoritative_at || null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    if (Number.isFinite(ms)) nextMs = Math.max(nextMs, ms + 1);
  }

  return new Date(nextMs).toISOString();
}