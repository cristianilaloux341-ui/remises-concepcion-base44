import { base44 } from "@/api/base44Client";

const BASES = ["1-Puerto", "2-Plaza", "3-Columna", "4-Base", "5-Cementerio", "6-Díaz Vélez", "7-Don Bosco", "8-Monumento"];

// Fuente autoritativa de cola: base actual + posición numérica del servidor.
// Los timestamps quedan sólo como compatibilidad/historial para APK legacy.
export function getEffectiveQueueBase(driver) {
  if (!driver) return null;
  const authoritativeBase = driver.queue_authoritative_base || null;
  const pos = Number(driver.queue_position);
  // La vista web usa la misma autoridad que backend. Un current_base=null técnico
  // de una APK vieja no debe hacer desaparecer ni mover al móvil en la lista.
  if (!authoritativeBase) return null;
  if (!Number.isFinite(pos) || pos <= 0) return null;
  return authoritativeBase;
}

// Helper to safely and stably sort a queue
export function sortQueue(driversArray) {
  return driversArray.sort((a, b) => {
    const posA = Number.isFinite(Number(a.queue_position)) && Number(a.queue_position) > 0 ? Number(a.queue_position) : Infinity;
    const posB = Number.isFinite(Number(b.queue_position)) && Number(b.queue_position) > 0 ? Number(b.queue_position) : Infinity;
    if (posA !== posB) return posA - posB;

    // Un empate de queue_position es un estado inválido. La Central debe mostrar
    // exactamente el mismo desempate estable que usa el backend; los timestamps
    // son sólo informativos y nunca deciden prioridad.
    return (a.id || "").localeCompare(b.id || "");
  });
}

// Get ordered queue for a base (posición numérica server-side).
// Una oferta ya reservada deja de pertenecer visual y operativamente a la cola
// aunque `status` siga en "disponible" hasta que el chofer toque Aceptar.
// Si no filtramos la reserva, Central sigue mostrando al móvil (y su tiempo de
// espera) durante esos segundos y hasta puede volver a sugerirlo para otro viaje.
export function getBaseQueue(drivers, baseName) {
  return sortQueue(drivers.filter(d =>
    getEffectiveQueueBase(d) === baseName &&
    d.status === "disponible" &&
    (d.dispatch_status == null || d.dispatch_status === "normal") &&
    !d.reserved_order_id &&
    !d.active_order_id &&
    !d.active_ride_id &&
    !d.next_order_id
  ));
}

// Asignación manual desde Central: la decisión y el commit pertenecen al backend.
export async function assignDriverToOrder(order, driver, options = {}) {
  const sessionToken = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("local_operator_token"))
    ? sessionStorage.getItem("local_operator_token")
    : (typeof localStorage !== "undefined" ? (localStorage.getItem("client_token") || "client_demo_token") : "client_demo_token");
  const res = await base44.functions.invoke("assignRide", {
    orderId: order.id, driverId: driver.id, sessionToken,
    requireDriverConfirmation: options.requireDriverConfirmation === true,
    forceManual: options.forceManual === true,
    manualDriverName: options.forceManual === true ? driver.name : null,
    mobileId: options.mobileId || null,
  });
  if (!res.data?.success) throw new Error(res.data?.reason || "No se pudo asignar el viaje");
  return res.data;
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

// Cache corta en memoria: evita releer todo ZoneMapping por cada dirección.
let _zoneMappingsCache = null;
let _zoneMappingsCacheAt = 0;
const ZONE_MAPPING_CACHE_TTL_MS = 5 * 60 * 1000;

async function getZoneMappingsCached(force = false) {
  const now = Date.now();
  if (!force && _zoneMappingsCache && (now - _zoneMappingsCacheAt) < ZONE_MAPPING_CACHE_TTL_MS) return _zoneMappingsCache;
  // Aumentado a 2000 para evitar que el límite deje fuera mapeos guardados
  const mappings = await base44.entities.ZoneMapping.list("-priority", 2000);
  _zoneMappingsCache = mappings || [];
  _zoneMappingsCacheAt = now;
  return _zoneMappingsCache;
}

function invalidateZoneMappingsCache() {
  _zoneMappingsCache = null;
  _zoneMappingsCacheAt = 0;
}

export async function learnZoneMapping(address, zone) {
  if (!address || !zone || address.trim().length < 3) return;
  if (!BASES.includes(zone)) return; // Validar que la zona exista estrictamente

  const parsed = parseAddress(address);
  if (!parsed.street || parsed.street.length < 3) return;

  const streetNorm = _normalize(parsed.street);
  const stopwords = ["el", "la", "los", "las", "un", "una", "de", "del", "y", "a", "en", "boulevard", "calle", "av", "avenida"];
  const invalidTokens = ["concepcion del uruguay", "entre rios", "argentina", "uruguay"];

  // Evitar que el sistema aprenda basura administrativa o palabras vacías aisladas
  if (stopwords.includes(streetNorm)) return;
  if (invalidTokens.some(t => streetNorm.includes(t))) return;

  const mappings = await getZoneMappingsCached();

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

  // La próxima detección ve inmediatamente lo recién aprendido/corregido.
  invalidateZoneMappingsCache();
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
  const latN = Number(lat), lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
  const polygons = await base44.entities.ZonePolygon.list();
  const matches = [];
  for (const poly of polygons) {
    if (poly.coordinates && poly.coordinates.length > 2 && isPointInPolygon([latN, lngN], poly.coordinates)) {
      matches.push(poly.zone);
    }
  }
  // Una coordenada debe pertenecer a una sola zona. Si los polígonos se solapan,
  // no elegir "la primera" silenciosamente: obliga a corregir la cartografía.
  return matches.length === 1 ? matches[0] : null;
}

// Detecta primero desde la memoria propia de direcciones confirmadas.
// ZoneMapping queda sólo como compatibilidad para datos históricos.
export async function detectZoneFromAddress(address) {
  if (!address || address.trim().length < 2) return null;

  const addressNorm = _normalize(address);
  const history = await base44.entities.AddressHistory.list("-last_used", 2000).catch(() => []);
  const learned = history.find(h => (h.normalized_address || _normalize(h.address)) === addressNorm && h.zone_confirmed && h.zone);
  if (learned) return learned.zone;

  const mappings = await getZoneMappingsCached();
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

  // SE ELIMINÓ EL FALLBACK GENÉRICO (.includes)
  // Si no hay coincidencia exacta de calle o manzana, delegamos obligatoriamente a
  // la geocodificación y a los polígonos matemáticos. Un string no puede secuestrar la zona.

  return bestMatch || null;
}

export { BASES };