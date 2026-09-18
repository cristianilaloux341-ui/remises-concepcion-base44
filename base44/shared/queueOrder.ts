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
    // Evaluamos TODOS los timestamps en la base para garantizar monotonía estricta
    const raw = d.queue_authoritative_at || d.queue_entered_at || null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    if (Number.isFinite(ms)) nextMs = Math.max(nextMs, ms + 10);
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
    // CRÍTICO: Nunca ignorar choferes ocupados o con ofertas. Su posición es 
    // válida y ocupada. Ignorarlos causa posiciones duplicadas al entrar nuevos móviles.
    const pos = Number(d.queue_position);
    if (Number.isFinite(pos) && pos > 0) maxPos = Math.max(maxPos, pos);
  }
  return maxPos + 1;
}

export async function compactQueueUnlocked(b44: any, baseName: string) {
  // Compactación autoritativa: conserva EXACTAMENTE el orden relativo actual y
  // elimina huecos (1,2,3,8 -> 1,2,3,4). Solo debe llamarse dentro del lock de cola
  // y después de una acción operativa real; heartbeat/GPS/reconexión nunca la llaman.
  if (!baseName) return;
  const rows = await b44.entities.Driver.filter({
    queue_authoritative_base: baseName
  }).catch(() => []);
  
  // CRÍTICO: Compactamos TODOS los choferes en la base, incluso si están ocupados
  // o con ofertas. Ignorarlos crearía posiciones duplicadas cuando vuelvan a estar
  // disponibles o cuando la cola avance.
  const inBase = (Array.isArray(rows) ? rows : []).filter(d => getEffectiveQueueBase(d) === baseName);
  const queue = sortQueue(inBase);
  
  // Para que el APK (que a veces ordena por timestamp localmente) vea el mismo orden sin huecos,
  // asignamos fechas secuenciales hacia atrás desde "ahora" o mantenemos el orden temporal.
  // Mantenemos los queue_entered_at originales pero nos aseguramos que su orden temporal 
  // coincide estrictamente con la compactación.
  
  let currentBaseMs = Date.now() - (queue.length * 1000);
  
  for (let i = 0; i < queue.length; i++) {
    const d = queue[i];
    const wanted = i + 1;
    currentBaseMs += 1000;
    const newTimestamp = new Date(currentBaseMs).toISOString();
    
    // Si la posición ya era correcta, verificamos si el timestamp acompaña (APK sync)
    if (Number(d.queue_position) === wanted && Number(d.queue_authority_marker) === wanted) {
        // En compactaciones puras sin movimiento, no tocamos el entered_at para no generar ruido,
        // asumiendo que ya estaba bien. Si hubo un cambio de posición, actualizamos todo.
        continue;
    }
    
    await b44.entities.Driver.updateMany(
      {
        id: d.id,
        queue_authoritative_base: baseName
      },
      { $set: { 
          queue_position: wanted, 
          queue_authority_marker: wanted,
          queue_entered_at: newTimestamp,
          queue_authoritative_at: newTimestamp
        } 
      }
    ).catch(() => ({ updated: 0 }));
    // No lanzamos error si no coincide. Si un móvil salió de la base (cambió queue_authoritative_base)
    // durante la compactación, simplemente ignoramos el update. La misma salida
    // disparará otra compactación inmediatamente.
  }
}

export async function compactQueue(b44: any, baseName: string) {
  if (!baseName) return;
  return withQueueLock(b44, baseName, async () => compactQueueUnlocked(b44, baseName));
}