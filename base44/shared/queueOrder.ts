export function getEffectiveQueueEnteredAt(driver: any) {
  if (!driver) return null;
  const currentBase = driver.current_base || null;
  const authoritativeBase = driver.queue_authoritative_base || null;
  if (currentBase && authoritativeBase && currentBase !== authoritativeBase) {
    return driver.queue_entered_at || null;
  }
  return driver.queue_authoritative_at || driver.queue_entered_at || null;
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
    (d.current_base || d.queue_authoritative_base || null) === baseName &&
    d.status === "disponible" &&
    (d.dispatch_status == null || d.dispatch_status === "normal") &&
    !d.reserved_order_id &&
    !d.active_order_id &&
    !d.active_ride_id
  ));
}