const QUEUE_LOCK_TTL_MS = 10000;
const QUEUE_LOCK_WAIT_MS = 3000;

function mutationCount(result: any): number {
  return Math.max(
    Number(result?.updated ?? 0),
    Number(result?.modifiedCount ?? 0),
    Number(result?.matchedCount ?? 0)
  );
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cola operativa: current_base + queue_position son la autoridad.
// Los timestamps se conservan únicamente como historial/proyección para APK legacy.
export function getEffectiveQueueBase(driver: any) {
  if (!driver) return null;
  const authoritativeBase = driver.queue_authoritative_base || null;
  const pos = Number(driver.queue_position);
  // La membresía de cola la decide exclusivamente el servidor. Las APK v12.27/v12.29
  // pueden publicar un current_base=null técnico durante heartbeat/reconexión; ese
  // parpadeo no puede sacar al móvil de la cola ni alterar su prioridad. Una salida
  // real ya limpia queue_authoritative_base + queue_position server-side.
  if (!authoritativeBase) return null;
  if (!Number.isFinite(pos) || pos <= 0) return null;
  return authoritativeBase;
}

export function sortQueue(driversArray: any[]) {
  return driversArray.sort((a, b) => {
    const posA = Number.isFinite(Number(a.queue_position)) && Number(a.queue_position) > 0 ? Number(a.queue_position) : Infinity;
    const posB = Number.isFinite(Number(b.queue_position)) && Number(b.queue_position) > 0 ? Number(b.queue_position) : Infinity;
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

// Lock exclusivo por base, separado del lock comercial de despacho.
// Evita que dos entradas/rechazos simultáneos calculen el mismo MAX+1.
export async function withQueueLock<T>(
  b44: any,
  baseName: string,
  fn: () => Promise<T>,
  waitMs: number = QUEUE_LOCK_WAIT_MS
): Promise<T> {
  if (!baseName) return await fn();

  const rows = await b44.entities.QueueLock.filter({ base_name: baseName }).catch(() => []);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`QUEUE_LOCK_INVALID:${baseName}:${Array.isArray(rows) ? rows.length : 0}`);
  }

  const lock = rows[0];
  const owner = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  let acquired = false;

  while (!acquired && Date.now() <= deadline) {
    const now = Date.now();
    const res = await b44.entities.QueueLock.updateMany(
      {
        id: lock.id,
        $or: [
          { owner: null },
          { owner: { $exists: false } },
          { expires_at: null },
          { expires_at: { $exists: false } },
          { expires_at: { $lt: now } }
        ]
      },
      {
        $set: { owner, expires_at: now + QUEUE_LOCK_TTL_MS },
        $inc: { version: 1 }
      }
    ).catch(() => ({ updated: 0 }));

    acquired = mutationCount(res) === 1;
    if (!acquired) await sleep(20 + Math.floor(Math.random() * 31));
  }

  if (!acquired) throw new Error(`QUEUE_LOCK_BUSY:${baseName}`);

  try {
    return await fn();
  } finally {
    await b44.entities.QueueLock.updateMany(
      { id: lock.id, owner },
      { $set: { owner: null, expires_at: null } }
    ).catch(() => null);
  }
}

// Proyección legacy únicamente: genera una hora posterior a las demás para que
// v12.27/v12.29 sigan viendo "último". El servidor NUNCA usa esta hora para elegir.
export async function getNextQueueTailAt(b44: any, baseName: string, excludeDriverId: string | null = null) {
  const drivers = await b44.entities.Driver.filter({
    queue_authoritative_base: baseName
  }).catch(() => []);

  let nextMs = Date.now();
  for (const d of drivers || []) {
    if (!d || d.id === excludeDriverId) continue;
    if (getEffectiveQueueBase(d) !== baseName) continue;
    if (d.status === 'en_viaje' || d.active_ride_id || d.active_order_id || d.reserved_order_id) continue;
    const raw = d.queue_authoritative_at || d.queue_entered_at || null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    if (Number.isFinite(ms)) nextMs = Math.max(nextMs, ms + 1);
  }
  return new Date(nextMs).toISOString();
}

// Debe ejecutarse dentro de withQueueLock cuando el resultado vaya a escribirse.
export async function getNextQueuePosition(b44: any, baseName: string, excludeDriverId: string | null = null) {
  const drivers = await b44.entities.Driver.filter({
    queue_authoritative_base: baseName
  }).catch(() => []);

  let maxPos = 0;
  for (const d of drivers || []) {
    if (!d || d.id === excludeDriverId) continue;
    if (getEffectiveQueueBase(d) !== baseName) continue;
    if (d.status === 'en_viaje' || d.active_ride_id || d.active_order_id || d.reserved_order_id) continue;
    const pos = Number(d.queue_position);
    if (Number.isFinite(pos) && pos > 0) maxPos = Math.max(maxPos, pos);
  }
  return maxPos + 1;
}

export async function compactQueueUnlocked(b44: any, baseName: string) {
  if (!baseName) return;
  const drivers = await b44.entities.Driver.filter({
    queue_authoritative_base: baseName
  }).catch(() => []);

  const queue = drivers.filter((d: any) =>
    getEffectiveQueueBase(d) === baseName &&
    d.status !== 'en_viaje' &&
    !d.active_ride_id &&
    !d.active_order_id &&
    !d.reserved_order_id &&
    Number.isFinite(Number(d.queue_position)) && Number(d.queue_position) > 0
  ).sort((a: any, b: any) => {
    const diff = Number(a.queue_position) - Number(b.queue_position);
    if (diff !== 0) return diff;
    
    const timeA = a.queue_authoritative_at ? new Date(a.queue_authoritative_at).getTime() : Infinity;
    const timeB = b.queue_authoritative_at ? new Date(b.queue_authoritative_at).getTime() : Infinity;
    if (timeA !== timeB) return timeA - timeB;
    
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  let expectedPos = 1;
  for (const d of queue) {
    if (Number(d.queue_position) !== expectedPos) {
      await b44.entities.Driver.updateMany(
        { id: d.id, queue_authoritative_base: baseName, queue_position: d.queue_position },
        { $set: { queue_position: expectedPos, queue_authority_marker: expectedPos } }
      ).catch(() => null);
    }
    expectedPos++;
  }
}

export async function compactQueue(b44: any, baseName: string) {
  if (!baseName) return;
  return withQueueLock(b44, baseName, async () => compactQueueUnlocked(b44, baseName));
}