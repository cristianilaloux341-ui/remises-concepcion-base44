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
    // Si no tiene queue_position, es que no está validado por server
    if (driver.queue_position == null) return null;
    if (!authoritativeBase || authoritativeBase !== currentBase) return null;
    return currentBase;
  }
  return hasQueueExitGrace(driver) ? authoritativeBase : null;
}

export function sortQueue(driversArray: any[]) {
  return driversArray.sort((a, b) => {
    const posA = Number.isFinite(Number(a.queue_position)) && a.queue_position > 0 ? Number(a.queue_position) : Infinity;
    const posB = Number.isFinite(Number(b.queue_position)) && b.queue_position > 0 ? Number(b.queue_position) : Infinity;
    if (posA !== posB) return posA - posB;
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

// Solo guarda el timestamp histórico, pero devuelve la posicion calculada
export async function getNextQueueTailAt(b44: any, baseName: string, excludeDriverId: string | null = null) {
  return new Date().toISOString();
}

export async function getNextQueuePosition(b44: any, baseName: string, excludeDriverId: string | null = null) {
  const drivers = await b44.entities.Driver.filter({
    status: "disponible",
    $or: [
      { current_base: baseName },
      { queue_authoritative_base: baseName }
    ]
  }).catch(() => []);

  let maxPos = 0;
  for (const d of drivers || []) {
    if (!d || d.id === excludeDriverId) continue;
    if (getEffectiveQueueBase(d) !== baseName) continue;
    // Include drivers in pending dispatch to keep the max position accurate
    // Because if driver 1 is deciding, max pos is 1. If we exclude him, max pos is 0,
    // and new driver would get pos 1.
    
    const pos = Number(d.queue_position);
    if (Number.isFinite(pos) && pos > 0) {
      maxPos = Math.max(maxPos, pos);
    }
  }

  return maxPos + 1;
}

export async function compactQueue(b44: any, baseName: string) {
  if (!baseName) return;
  const drivers = await b44.entities.Driver.filter({
    status: "disponible",
    $or: [
      { current_base: baseName },
      { queue_authoritative_base: baseName }
    ]
  }).catch(() => []);
  
  const queue = drivers.filter(d => 
    getEffectiveQueueBase(d) === baseName &&
    Number.isFinite(Number(d.queue_position)) && Number(d.queue_position) > 0
  ).sort((a, b) => Number(a.queue_position) - Number(b.queue_position));
  
  let expectedPos = 1;
  for (const d of queue) {
    if (Number(d.queue_position) !== expectedPos) {
      await b44.entities.Driver.update(d.id, { queue_position: expectedPos }).catch(()=>null);
    }
    expectedPos++;
  }
}