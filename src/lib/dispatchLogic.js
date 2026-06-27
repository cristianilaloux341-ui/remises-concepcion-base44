import { base44 } from "@/api/base44Client";

const BASES = ["1-Puerto", "2-Plaza", "3-Columna", "4-Base", "5-Cementerio", "6-Díaz Vélez", "7-Don Bosco", "8-Monumento"];

// Haversine distance in km
export function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Get ordered queue for a base (FIFO by queue_entered_at)
export function getBaseQueue(drivers, baseName) {
  return drivers
    .filter(d => d.current_base === baseName && d.status === "disponible")
    .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at));
}

// Find best driver for an order: zone-first (FIFO), then nearest base
export async function findBestDriver(order, drivers, bases) {
  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);
  if (!availableDrivers.length) return null;

  // 1) If order has a zone, try that zone first (FIFO)
  if (order.zone) {
    const zoneQueue = getBaseQueue(availableDrivers, order.zone);
    if (zoneQueue.length > 0) return zoneQueue[0];
  }

  // 2) If pickup coordinates available, find nearest base with available drivers
  if (order.pickup_lat && order.pickup_lng) {
    const basesWithDrivers = BASES.filter(b => availableDrivers.some(d => d.current_base === b));
    
    let nearestBase = null;
    let minDist = Infinity;

    for (const baseName of basesWithDrivers) {
      const baseInfo = bases.find(b => b.name === baseName);
      if (baseInfo?.lat && baseInfo?.lng) {
        const dist = getDistance(order.pickup_lat, order.pickup_lng, baseInfo.lat, baseInfo.lng);
        if (dist < minDist) { minDist = dist; nearestBase = baseName; }
      }
    }

    if (nearestBase) {
      const queue = getBaseQueue(availableDrivers, nearestBase);
      if (queue.length > 0) return queue[0];
    }
  }

  // 3) No zone / no coords: first in any queue (FIFO global)
  for (const baseName of BASES) {
    const queue = getBaseQueue(availableDrivers, baseName);
    if (queue.length > 0) return queue[0];
  }
  return null;
}

// Find first available driver in the exact zone (FIFO queue by queue_entered_at)
export function findDriverInZone(zone, drivers) {
  if (!zone) return null;
  return drivers
    .filter(d => d.status === "disponible" && d.current_base === zone)
    .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at))[0] || null;
}

// Assign driver to order (direct / zone-based)
export async function assignDriverToOrder(order, driver) {
  await base44.entities.RideOrder.update(order.id, {
    status: "ofrecido",
    driver_id: driver.id,
    driver_name: driver.name,
    assigned_base: driver.current_base,
    offered_driver_ids: [...(order.offered_driver_ids || []), driver.id],
  });

  // Enviar notificación push real al dispositivo del chofer (no bloqueante)
  base44.functions.invoke("sendPushNotification", {
    action: "send",
    driverId: driver.id,
    orderId: order.id,
    orderData: {
      pickup_address: order.pickup_address,
      dropoff_address: order.dropoff_address,
      fare: order.fare,
    },
  }).catch(() => {});

  // Timeout automático: si el chofer NO acepta en 30s, reasignar a otro
  base44.functions.invoke("autoReassignOnTimeout", {
    orderId: order.id,
    timeoutSeconds: 30,
  }).catch(() => {});
}

// Broadcast: marcar el pedido como "pendiente_broadcast" para que TODOS los disponibles lo vean
// El primero en aceptar gana. Se usa cuando no hay nadie en la zona.
export async function broadcastOrder(order) {
  await base44.entities.RideOrder.update(order.id, {
    status: "pendiente",
    driver_id: null,
    driver_name: null,
    assigned_base: null,
    // Prefijo especial para que DriverApp lo detecte como broadcast urgente
    notes: order.notes ? `[BROADCAST] ${order.notes}` : "[BROADCAST]",
  });
}

// Auto-dispatch: intenta asignar por zona; si no hay nadie → broadcast
// Retorna: "assigned" | "broadcast" | "no_drivers"
export async function autoDispatch(order, drivers, bases) {
  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);

  if (!availableDrivers.length) return "no_drivers";

  // 1) Buscar primero en la zona del pedido (FIFO)
  if (order.zone) {
    const zoneQueue = getBaseQueue(availableDrivers, order.zone);
    if (zoneQueue.length > 0) {
      await assignDriverToOrder(order, zoneQueue[0]);
      return "assigned";
    }
  }

  // 2) Sin zona o zona vacía → buscar por coordenadas (base más cercana)
  if (order.pickup_lat && order.pickup_lng) {
    const basesWithDrivers = BASES.filter(b => availableDrivers.some(d => d.current_base === b));
    let nearestBase = null;
    let minDist = Infinity;
    for (const baseName of basesWithDrivers) {
      const baseInfo = bases.find(b => b.name === baseName);
      if (baseInfo?.lat && baseInfo?.lng) {
        const dist = getDistance(order.pickup_lat, order.pickup_lng, baseInfo.lat, baseInfo.lng);
        if (dist < minDist) { minDist = dist; nearestBase = baseName; }
      }
    }
    if (nearestBase) {
      const queue = getBaseQueue(availableDrivers, nearestBase);
      if (queue.length > 0) {
        await assignDriverToOrder(order, queue[0]);
        return "assigned";
      }
    }
  }

  // 3) Sin nadie en zona → broadcast a todos
  await broadcastOrder(order);
  return "broadcast";
}

// Reassign after rejection: next in same base queue (skipping already-offered),
// or broadcast to ALL available drivers if no one left in zone
export async function reassignAfterReject(order, drivers, bases) {
  const offeredIds = order.offered_driver_ids || [];
  const available = drivers.filter(d => d.status === "disponible" && d.current_base && !offeredIds.includes(d.id));

  if (!available.length) {
    await base44.entities.RideOrder.update(order.id, {
      status: "pendiente",
      driver_id: null,
      driver_name: null,
    });
    return "sin_moviles";
  }

  // Next driver in same base (FIFO)
  const lastBase = order.assigned_base || order.zone;
  const sameBaseQueue = available
    .filter(d => d.current_base === lastBase)
    .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at));

  if (sameBaseQueue.length > 0) {
    await assignDriverToOrder(order, sameBaseQueue[0]);
    return "next_in_queue";
  }

  // No one in same zone → broadcast a todos disponibles
  await broadcastOrder(order);
  return "broadcast";
}

// ── Address Parsing ───────────────────────────────────────────────────────────
// Extracts street name and number from an Argentine-style address
export function parseAddress(address) {
  if (!address) return { street: null, number: null };
  const cleaned = address.trim();

  // Try to match: street name + number (possibly followed by more text)
  // Handles: "San Martín 1250", "9 de Julio 350", "Av. Mitre 800 esq. Moreno"
  const match = cleaned.match(/^(.+?)\s+(\d{2,5})\b(.*)$/);

  if (match) {
    let street = match[1].trim();
    const number = parseInt(match[2], 10);
    // Strip common prefixes
    street = street.replace(/^(av\.?|avda\.?|calle|bv\.?|blvd\.?|pje\.?|pasaje)\s+/i, "").trim();
    return { street, number };
  }

  // No number — extract street name only
  let street = cleaned;
  street = street.split(/\s+(y|esq\.?|esquina)\s+/i)[0].trim();
  street = street.replace(/^(av\.?|avda\.?|calle|bv\.?|blvd\.?|pje\.?|pasaje)\s+/i, "").trim();
  return { street: street || null, number: null };
}

// ── Zone Learning ─────────────────────────────────────────────────────────────
// Saves/updates ZoneMapping when an address+zone is confirmed
const _normalize = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export async function learnZoneMapping(address, zone) {
  if (!address || !zone || address.trim().length < 3) return;

  const parsed = parseAddress(address);
  if (!parsed.street || parsed.street.length < 2) return;

  const streetNorm = _normalize(parsed.street);
  const mappings = await base44.entities.ZoneMapping.list("-priority", 500);

  // Check general street mapping
  const existingGeneral = mappings.find(m => _normalize(m.keyword) === streetNorm);

  if (!existingGeneral) {
    // New street — create general mapping
    await base44.entities.ZoneMapping.create({
      keyword: parsed.street,
      zone,
      priority: 1,
      notes: parsed.number ? `Ej: altura ${parsed.number}` : "",
    });
  } else if (existingGeneral.zone === zone && parsed.number) {
    // Same zone — enrich notes with height
    const notes = existingGeneral.notes || "";
    const numStr = String(parsed.number);
    if (!notes.includes(numStr) && notes.length < 400) {
      const updated = notes ? `${notes}, ${numStr}` : `Alturas: ${numStr}`;
      await base44.entities.ZoneMapping.update(existingGeneral.id, { notes: updated });
    }
  }

  // If number exists, create a height-block mapping (more specific = higher priority)
  if (parsed.number) {
    const block = Math.floor(parsed.number / 100);
    const blockKeyword = `${parsed.street} ${block}`;
    const blockNorm = _normalize(blockKeyword);
    const existingBlock = mappings.find(m => _normalize(m.keyword) === blockNorm);

    if (!existingBlock) {
      await base44.entities.ZoneMapping.create({
        keyword: blockKeyword,
        zone,
        priority: 10,
        notes: `Alturas ${block}00-${block}99`,
      });
    } else if (existingBlock.zone !== zone) {
      // Operator chose a different zone for this block — update it
      await base44.entities.ZoneMapping.update(existingBlock.id, { zone });
    }
  }
}

// ── Zone Detection ────────────────────────────────────────────────────────────
// Ray-casting algorithm for Point-in-Polygon
function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Check if coordinates fall inside any defined ZonePolygon
export async function detectZoneFromCoords(lat, lng) {
  if (!lat || !lng) return null;
  const polygons = await base44.entities.ZonePolygon.list();
  for (const poly of polygons) {
    if (poly.coordinates && poly.coordinates.length > 2) {
      if (isPointInPolygon([lat, lng], poly.coordinates)) {
        return poly.zone;
      }
    }
  }
  return null;
}

// Detects the zone for an address using the ZoneMapping entity (editable dictionary)
// Returns { zone, confidence } or null if no match found
export async function detectZoneFromAddress(address) {
  if (!address || address.trim().length < 2) return null;

  const mappings = await base44.entities.ZoneMapping.list("-priority");
  if (!mappings.length) return null;

  const parsed = parseAddress(address);
  const streetNorm = (parsed.street || address).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  let blockNorm = null;
  if (parsed.number) {
    const block = Math.floor(parsed.number / 100);
    blockNorm = `${streetNorm} ${block}`;
  }

  let bestMatch = null;
  let bestPriority = -1;

  for (const m of mappings) {
    const keyword = (m.keyword || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (!keyword) continue;
    
    // Primero, si el operador configuró manualmente las alturas (ej: san martin 12)
    if (blockNorm && keyword === blockNorm) {
      const priority = m.priority || 10;
      if (priority > bestPriority) {
        bestPriority = priority;
        bestMatch = m.zone;
      }
    } 
    // Luego, coincidencia exacta del nombre de la calle entera
    else if (keyword === streetNorm) {
      const priority = m.priority || 1;
      if (priority > bestPriority) {
        bestPriority = priority;
        bestMatch = m.zone;
      }
    }
  }

  // Si no hubo coincidencia exacta de calle, probamos incluído genérico por las dudas
  if (!bestMatch) {
    const normalized = address.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const m of mappings) {
      const keyword = (m.keyword || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (keyword && normalized.includes(keyword)) {
        const priority = m.priority || 1;
        if (priority > bestPriority) {
          bestPriority = priority;
          bestMatch = m.zone;
        }
      }
    }
  }

  return bestMatch || null;
}

export { BASES };