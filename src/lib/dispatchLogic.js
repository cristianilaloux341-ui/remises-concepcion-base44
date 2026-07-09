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

// Helper to safely and stably sort a queue
export function sortQueue(driversArray) {
  return driversArray.sort((a, b) => {
    const timeA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
    const timeB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
    const tA = isNaN(timeA) ? 0 : timeA;
    const tB = isNaN(timeB) ? 0 : timeB;
    if (tA !== tB) return tA - tB;
    return (a.id || "").localeCompare(b.id || "");
  });
}

// Get ordered queue for a base (FIFO by queue_entered_at)
export function getBaseQueue(drivers, baseName) {
  return sortQueue(drivers.filter(d => d.current_base === baseName && d.status === "disponible"));
}

// Find best driver for an order: strictly by zone (FIFO)
export async function findBestDriver(order, drivers, bases) {
  if (!Array.isArray(drivers)) { console.error("[CRITICAL ERROR] drivers is not array in findBestDriver!", drivers); return null; }
  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);
  if (!availableDrivers.length) return null;

  // Sólo asignar a los de la zona correspondiente
  if (order.zone) {
    const zoneQueue = getBaseQueue(availableDrivers, order.zone);
    if (zoneQueue.length > 0) return zoneQueue[0];
  }

  // Se eliminó la lógica de proximidad GPS porque causa asignaciones a zonas incorrectas.
  return null;
}

// Find first available driver in the exact zone (FIFO queue by queue_entered_at)
export function findDriverInZone(zone, drivers) {
  if (!zone) return null;
  return getBaseQueue(drivers, zone)[0] || null;
}

// Assign driver to order (direct / zone-based)
export async function assignDriverToOrder(order, driver) {
  // Mover a los móviles salteados al final de la cola
  try {
    if (driver.current_base && driver.status === "disponible") {
      const allDrivers = await base44.entities.Driver.filter({ status: "disponible", current_base: driver.current_base });
      const queue = sortQueue(allDrivers);
      const driverIndex = queue.findIndex(d => d.id === driver.id);
      
      if (driverIndex > 0) {
        const skippedDrivers = queue.slice(0, driverIndex);
        const baseTime = new Date();
        await Promise.all(skippedDrivers.map((d, i) => 
          base44.entities.Driver.update(d.id, {
            queue_entered_at: new Date(baseTime.getTime() + (i * 1000)).toISOString()
          })
        ));
      }
    }
  } catch (e) {
    console.error("Error penalizing skipped drivers", e);
  }

  // Obtener configuración desde TarifaConfig primero
  const tarifaConfigs = await base44.entities.TarifaConfig.list();
  const config = tarifaConfigs[0];
  const timeoutSeconds = config?.tiempo_maximo_respuesta_segundos ?? 60;
  const autoReassignActive = config?.auto_reasignacion_activa ?? true;
  
  const autoAceptarViajes = config?.auto_aceptar_viajes ?? false;

  const targetOrderStatus = autoAceptarViajes ? "aceptado" : "ofrecido";
  const targetDriverStatus = autoAceptarViajes ? "en_viaje" : "ofrecido";

  await base44.entities.RideOrder.update(order.id, {
    status: targetOrderStatus,
    driver_id: driver.id,
    driver_name: driver.name,
    assigned_base: driver.current_base,
    offered_driver_ids: [...(order.offered_driver_ids || []), driver.id],
  });

  await base44.entities.Driver.update(driver.id, {
    status: targetDriverStatus
  });

  base44.functions.invoke("sendPushNotification", {
    action: "send",
    driverId: driver.id,
    orderId: order.id,
    orderData: {
      pickup_address: order.pickup_address,
      dropoff_address: order.dropoff_address,
      fare: order.fare,
    },
  }).catch((e) => console.error("Push Error:", e));

  // Si no se auto-acepta y la reasignación está activa, disparamos el timeout
  if (targetOrderStatus === "ofrecido" && autoReassignActive) {
    base44.functions.invoke("autoReassignOnTimeout", {
      orderId: order.id,
      driverId: driver.id,
      timeoutSeconds: timeoutSeconds
    }).catch(e => console.error("AutoReassign Trigger Error:", e));
  }
}

// Broadcast: marcar el pedido como "pendiente_broadcast" para que TODOS los disponibles lo vean
// El primero en aceptar gana. Se usa cuando no hay nadie en la zona.
export async function broadcastOrder(order, drivers = []) {
  await base44.entities.RideOrder.update(order.id, {
    status: "pendiente",
    driver_id: null,
    driver_name: null,
    assigned_base: null,
    // Prefijo especial para que DriverApp lo detecte como broadcast urgente
    notes: order.notes ? `[BROADCAST] ${order.notes}` : "[BROADCAST]",
  });

  // Notificar a todos los móviles disponibles (en segundo plano)
  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);
  availableDrivers.forEach(driver => 
    base44.functions.invoke("sendPushNotification", {
      action: "send",
      driverId: driver.id,
      orderId: order.id,
      orderData: {
        pickup_address: order.pickup_address,
        dropoff_address: order.dropoff_address,
        fare: order.fare,
      },
      isBroadcast: true
    }).catch(e => console.error("Broadcast Push Error:", e))
  );
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
    // Si la zona fue solicitada explícitamente pero no hay nadie, 
    // pasamos a BROADCAST directo, NO le asignamos a la fuerza a otra base.
    await broadcastOrder(order, drivers);
    return "broadcast";
  }

  // 2) Sin zona -> pasamos a BROADCAST directo. 
  // No usamos coordenadas GPS para adivinar la base porque causa asignaciones cruzadas.
  await broadcastOrder(order, drivers);
  return "broadcast";
}

// Reassign after rejection: next in same base queue (skipping already-offered),
// or broadcast to ALL available drivers if no one left in zone
export async function reassignAfterReject(order, drivers, bases) {
  if (!Array.isArray(drivers)) { console.error("[CRITICAL ERROR] drivers is not array in reassignAfterReject!", drivers); return null; }
  if (!Array.isArray(bases)) { console.error("[CRITICAL ERROR] bases is not array in reassignAfterReject!", bases); bases = BASES; }
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
  const sameBaseQueue = sortQueue(available.filter(d => d.current_base === lastBase));

  if (sameBaseQueue.length > 0) {
    await assignDriverToOrder(order, sameBaseQueue[0]);
    return "next_in_queue";
  }

  // No one in same zone → broadcast a todos disponibles
  await broadcastOrder(order, drivers);
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