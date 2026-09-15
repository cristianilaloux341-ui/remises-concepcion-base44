const QUEUE_EXIT_GRACE_MS = 20 * 1000;

function hasQueueExitGrace(driver: any) {
  if (!driver) return false;
  if (driver.current_base) return true;
  const leftAtMs = driver.queue_left_at ? new Date(driver.queue_left_at).getTime() : NaN;
  return Boolean(
    driver.queue_authoritative_base &&
    driver.queue_authoritative_at &&
    Number.isFinite(leftAtMs) &&
    (Date.now() - leftAtMs) <= QUEUE_EXIT_GRACE_MS
  );
}

export function getEffectiveQueueBase(driver: any) {
  if (!driver) return null;
  const currentBase = driver.current_base || null;
  const authoritativeBase = driver.queue_authoritative_base || null;
  if (currentBase) {
    // Entrada/cambio todavía no sellado: no tiene posición provisional.
    if (!authoritativeBase || authoritativeBase !== currentBase || !driver.queue_authoritative_at) return null;
    return currentBase;
  }
  return hasQueueExitGrace(driver) ? authoritativeBase : null;
}

export function getEffectiveQueueEnteredAt(driver: any) {
  if (!driver || !getEffectiveQueueBase(driver)) return null;
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
    getEffectiveQueueBase(d) === baseName &&
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
    $or: [
      { current_base: baseName },
      { queue_authoritative_base: baseName }
    ]
  }).catch(() => []);

  let nextMs = Date.now();
  for (const d of drivers || []) {
    if (!d || d.id === excludeDriverId) continue;
    if (getEffectiveQueueBase(d) !== baseName) continue;
    if (d.queue_authoritative_base !== baseName || !d.queue_authoritative_at) continue;
    if (d.dispatch_status != null && d.dispatch_status !== "normal") continue;
    if (d.reserved_order_id || d.active_order_id || d.active_ride_id) continue;

    const raw = d.queue_authoritative_at || null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    if (Number.isFinite(ms)) nextMs = Math.max(nextMs, ms + 1);
  }

  return new Date(nextMs).toISOString();
}