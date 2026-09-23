// Motor nuevo: contrato único de autoridad para Central + APK.
// Ninguna pantalla, heartbeat, GPS o reconexión puede decidir estados comerciales.

const DISPATCH_STATE = {
  DISPATCHING: "procesando_despacho",
  OFFERED: "ofrecido",
  ACCEPTED: "aceptado",
  PENDING: "pendiente",
} as const;

function ownsOffer(order:any, driverId:string, assignmentAttempt:number) {
  return Boolean(
    order &&
    order.status === DISPATCH_STATE.OFFERED &&
    order.reserved_driver_id === driverId &&
    Number(order.assignment_attempt) === Number(assignmentAttempt)
  );
}

function hasPresentedCurrentOffer(order:any) {
  return Boolean(
    order?.alert_presented_at &&
    Number(order.alert_presented_assignment_attempt) === Number(order.assignment_attempt)
  );
}

function responseWindowExpired(order:any, now=Date.now()) {
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
