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

// Find best driver for an order: nearest base first, then first in queue
export async function findBestDriver(order, drivers, bases) {
  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);
  if (!availableDrivers.length) return null;

  // If order has pickup coordinates, find nearest base with available drivers
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

    const targetBase = nearestBase || basesWithDrivers[0];
    const queue = getBaseQueue(availableDrivers, targetBase);
    return queue[0] || null;
  }

  // No coordinates: just take first in any queue
  for (const baseName of BASES) {
    const queue = getBaseQueue(availableDrivers, baseName);
    if (queue.length > 0) return queue[0];
  }
  return null;
}

// Assign driver to order
export async function assignDriverToOrder(order, driver) {
  await base44.entities.RideOrder.update(order.id, {
    status: "ofrecido",
    driver_id: driver.id,
    driver_name: driver.name,
    assigned_base: driver.current_base,
    offered_driver_ids: [...(order.offered_driver_ids || []), driver.id],
  });
}

// Reassign after rejection: next in same base queue (skipping already-offered),
// or broadcast to ALL available drivers if no one left in zone
export async function reassignAfterReject(order, drivers, bases) {
  const offeredIds = order.offered_driver_ids || [];
  const available = drivers.filter(d => d.status === "disponible" && d.current_base && !offeredIds.includes(d.id));

  if (!available.length) {
    // No one left untried → reset to pendiente without driver
    await base44.entities.RideOrder.update(order.id, {
      status: "pendiente",
      driver_id: null,
      driver_name: null,
    });
    return "sin_moviles";
  }

  // Determine which base the order was assigned from
  const lastBase = order.assigned_base;
  const sameBaseQueue = available
    .filter(d => d.current_base === lastBase)
    .sort((a, b) => new Date(a.queue_entered_at) - new Date(b.queue_entered_at));

  if (sameBaseQueue.length > 0) {
    // Next driver in same base
    const next = sameBaseQueue[0];
    await assignDriverToOrder(order, next);
    return "next_in_queue";
  }

  // No one in same zone → broadcast to ALL available (first to accept wins)
  // We use status "pendiente" with no driver_id so all drivers see it as available,
  // but set a special broadcast flag via notes prefix
  await base44.entities.RideOrder.update(order.id, {
    status: "pendiente",
    driver_id: null,
    driver_name: null,
    assigned_base: null,
  });
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
// Detects the zone for an address using the ZoneMapping entity (editable dictionary)
// Returns { zone, confidence } or null if no match found
export async function detectZoneFromAddress(address) {
  if (!address || address.trim().length < 2) return null;

  const mappings = await base44.entities.ZoneMapping.list("-priority");
  if (!mappings.length) return null;

  const normalized = address.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  let bestMatch = null;
  let bestPriority = -1;

  for (const m of mappings) {
    const keyword = (m.keyword || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!keyword) continue;
    if (normalized.includes(keyword)) {
      const priority = m.priority || 1;
      if (priority > bestPriority) {
        bestPriority = priority;
        bestMatch = m.zone;
      }
    }
  }

  return bestMatch || null;
}

export { BASES };