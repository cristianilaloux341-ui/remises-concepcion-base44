// Motor nuevo: contrato único de autoridad para Central + APK.
// Ninguna pantalla, heartbeat, GPS o reconexión puede decidir estados comerciales.

export const DISPATCH_STATE = {
  DISPATCHING: "procesando_despacho",
  OFFERED: "ofrecido",
  ACCEPTED: "aceptado",
  PENDING: "pendiente",
} as const;

export function isPublicPending(order:any) {
  return Boolean(
    order &&
    order.status === DISPATCH_STATE.PENDING &&
    order.processingAction === "PENDING_AUTHORIZED" &&
    !order.reserved_driver_id &&
    !order.driver_id &&
    !order.active_order_id &&
    !order.active_ride_id
  );
}

export function ownsOffer(order:any, driverId:string, assignmentAttempt:number) {
  return Boolean(
    order &&
    order.status === DISPATCH_STATE.OFFERED &&
    order.reserved_driver_id === driverId &&
    Number(order.assignment_attempt) === Number(assignmentAttempt)
  );
}

export function hasPresentedCurrentOffer(order:any) {
  return Boolean(
    order?.alert_presented_at &&
    Number(order.alert_presented_assignment_attempt) === Number(order.assignment_attempt)
  );
}

export function responseWindowExpired(order:any, now=Date.now()) {
  if (!hasPresentedCurrentOffer(order)) return false;
  const expires = Number(order.offerExpiresAt);
  return Number.isFinite(expires) && now >= expires;
}

// Una oferta que todavía no fue PRESENTED jamás se convierte en rechazo comercial.
// Debe recuperarse/reintentarse sobre el mismo móvil.
export function canProcessCommercialTimeout(order:any, driverId:string, assignmentAttempt:number, now=Date.now()) {
  return ownsOffer(order, driverId, assignmentAttempt) &&
    hasPresentedCurrentOffer(order) &&
    responseWindowExpired(order, now);
}

// Pendientes sólo existe cuando el motor autoritativo agotó la cola de la zona.
export async function authorizePendingAfterZoneExhausted(b44:any, orderId:string, reason:string) {
  const order = await b44.entities.RideOrder.get(orderId).catch(() => null);
  if (!order) return { success:false, reason:"ORDER_NOT_FOUND" };
  if (["aceptado","en_camino","en_viaje","completado","cancelado"].includes(order.status)) {
    return { success:false, reason:"TERMINAL_OR_OWNED_STATE" };
  }
  if (order.reserved_driver_id || order.driver_id) {
    return { success:false, reason:"DRIVER_STILL_OWNS_ORDER" };
  }
  const res = await b44.entities.RideOrder.updateMany(
    {
      id:orderId,
      status:"procesando_despacho",
      reserved_driver_id:null,
      driver_id:null
    },
    {
      $set:{
        status:"pendiente",
        processingAction:"PENDING_AUTHORIZED",
        pending_reason:reason,
        offerExpiresAt:null,
        alert_presented_at:null
      }
    }
  );
  const changed = Number(res?.updated ?? res?.modifiedCount ?? res?.matchedCount ?? 0) === 1;
  return { success:changed, reason:changed ? "PENDING_AUTHORIZED" : "STATE_CHANGED" };
}
