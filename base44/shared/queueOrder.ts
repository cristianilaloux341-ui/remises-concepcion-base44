const QUEUE_LOCK_TTL_MS = 10000;
// En ráfagas de Central/choferes preferimos esperar la cola autoritativa antes que
// devolver un falso fallo de entrada. Sigue por debajo del TTL: si el dueño murió,
// el lock expira a los 10 s y el siguiente contendiente puede recuperarlo.
const QUEUE_LOCK_WAIT_MS = 12000;

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

// Cola operativa: queue_authoritative_base + queue_position son la única autoridad.
export function getEffectiveQueueBase(driver: any) {
  if (!driver) return null;
  const authoritativeBase = driver.queue_authoritative_base || null;
  const pos = Number(driver.queue_position);
  // La membresía de cola la decide exclusivamente el servidor mediante
  // queue_authoritative_base + queue_position. Los campos de proyección no pueden
  // sacar al móvil de la cola ni alterar su prioridad.
  if (!authoritativeBase) return null;
  if (!Number.isFinite(pos) || pos <= 0) return null;
  return authoritativeBase;
}

export function sortQueue(driversArray: any[]) {
  return driversArray.sort((a, b) => {
    const posA = Number.isFinite(Number(a.queue_position)) && Number(a.queue_position) > 0 ? Number(a.queue_position) : Infinity;
    const posB = Number.isFinite(Number(b.queue_position)) && Number(b.queue_position) > 0 ? Number(b.queue_position) : Infinity;
    if (posA !== posB) return posA - posB;

    // Un empate de queue_position es un estado inválido. Desempate estable
    // por ID; compactQueue corrige luego las posiciones bajo QueueLock.
    return (a.id || "").localeCompare(b.id || "");
  });
}

export function getBaseQueue(drivers: any[], baseName: string) {
  return sortQueue(drivers.filter(d =>
    getEffectiveQueueBase(d) === baseName &&
    d.status === "disponible" &&
    (d.dispatch_status == null || d.dispatch_status === "normal") &&
    !d.reserved_order_id &&
    !d.active_ride_id &&
    !d.next_order_id
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

  // Renovación mientras fn() trabaja: una reordenación larga no puede perder el
  // lock a los 10 s y dejar entrar a otro escritor sobre la misma base.
  let renewalStopped = false;
  let leaseLost = false;
  let stopRenewal!: () => void;
  const renewalStop = new Promise<void>(resolve => { stopRenewal = resolve; });
  const renewal = (async () => {
    while (!renewalStopped) {
      await Promise.race([
        sleep(Math.max(1000, Math.floor(QUEUE_LOCK_TTL_MS / 3))),
        renewalStop
      ]);
      if (renewalStopped) break;
      const renewed = await b44.entities.QueueLock.updateMany(
        { id: lock.id, owner },
        { $set: { expires_at: Date.now() + QUEUE_LOCK_TTL_MS } }
      ).catch(() => ({ updated: 0 }));
      if (mutationCount(renewed) !== 1) {
        leaseLost = true;
        break;
      }
    }
  })();

  try {
    const result = await fn();
    if (leaseLost) throw new Error(`QUEUE_LOCK_LEASE_LOST:${baseName}`);
    return result;
  } finally {
    renewalStopped = true;
    stopRenewal();
    await renewal.catch(() => {});
    await b44.entities.QueueLock.updateMany(
      { id: lock.id, owner },
      { $set: { owner: null, expires_at: null } }
    ).catch(() => null);
  }
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
    if (d.status === 'en_viaje' || d.active_ride_id || d.reserved_order_id || d.next_order_id) continue;
    const pos = Number(d.queue_position);
    if (Number.isFinite(pos) && pos > 0) maxPos = Math.max(maxPos, pos);
  }
  return maxPos + 1;
}

export async function compactQueueUnlocked(b44: any, baseName: string) {
  // Compactación autoritativa: queue_position es la única prioridad operativa.
  // Sólo reescribimos posiciones que realmente cambiaron.
  if (!baseName) return;
  const rows = await b44.entities.Driver.filter({
    status: 'disponible',
    queue_authoritative_base: baseName
  }).catch(() => []);
  const queue = getBaseQueue(Array.isArray(rows) ? rows : [], baseName);

  for (let i = 0; i < queue.length; i++) {
    const d = queue[i];
    const wanted = i + 1;
    if (Number(d.queue_position) === wanted) continue;

    const changed = await b44.entities.Driver.updateMany(
      {
        id: d.id,
        status: 'disponible',
        queue_authoritative_base: baseName,
        dispatch_status: d.dispatch_status ?? 'normal',
        reserved_order_id: null,
        active_ride_id: null,
        next_order_id: null,
        queue_position: d.queue_position
      },
      { $set: {
          queue_position: wanted,
          queue_last_operation_key: null,
        }
      }
    ).catch(() => ({ updated: 0 }));

    if (mutationCount(changed) !== 1) {
      throw new Error(`QUEUE_COMPACT_CONCURRENT_CHANGE:${baseName}:${d.id}`);
    }
  }

  // Verificación post-escritura bajo el mismo QueueLock: no alcanza con que cada
  // update haya respondido OK; la cola final debe conservar exactamente los mismos
  // miembros elegibles y quedar 1..N, sin huecos ni duplicados.
  const verifyRows = await b44.entities.Driver.filter({
    status: 'disponible',
    queue_authoritative_base: baseName
  }).catch(() => []);
  const verified = getBaseQueue(Array.isArray(verifyRows) ? verifyRows : [], baseName);

  const expectedIds = queue.map(d => d.id).sort();
  const verifiedIds = verified.map(d => d.id).sort();
  if (expectedIds.length !== verifiedIds.length ||
      expectedIds.some((id, i) => id !== verifiedIds[i])) {
    throw new Error(`QUEUE_COMPACT_MEMBERS_CHANGED:${baseName}`);
  }

  for (let i = 0; i < verified.length; i++) {
    if (Number(verified[i].queue_position) !== i + 1) {
      throw new Error(`QUEUE_COMPACT_VERIFY_FAILED:${baseName}:${verified[i].id}:${verified[i].queue_position}`);
    }
  }
}

export async function compactQueue(b44: any, baseName: string) {
  if (!baseName) return;
  return withQueueLock(b44, baseName, async () => compactQueueUnlocked(b44, baseName));
}