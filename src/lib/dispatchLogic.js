import { base44 } from "@/api/base44Client";

const BASES = ["Puerto", "Plaza", "Columna", "Cementerio", "Don Bosco", "Díaz Vélez", "Monumento"];

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
  await Promise.all([
    base44.entities.RideOrder.update(order.id, {
      status: "ofrecido",
      driver_id: driver.id,
      driver_name: driver.name,
      assigned_base: driver.current_base,
      offered_driver_ids: [...(order.offered_driver_ids || []), driver.id],
    }),
  ]);
}

export { BASES };