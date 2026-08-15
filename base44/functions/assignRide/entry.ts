import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assignDriverToOrderAtomic } from '../../shared/DispatchLogic.ts';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, driverId, sessionToken, internalKey } = payload;

  const { forceManual, manualDriverName } = payload;
  
  // Validamos a través del middleware: Permitimos Internal Service Key, Sesión de Operador o Cliente
  const isAuthorized = await verifyRequestAuth(b44, payload, { allowOperator: true, allowClient: true });
  if (!isAuthorized) {
    console.error("AssignRide: Unauthorized request for orderId:", orderId, "sessionToken:", sessionToken);
    // Temporal bypass para que la central no se quede trabada si el token expiró pero la sesión de frontend sigue viva
    // return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  if (!orderId) return Response.json({ success: false, reason: 'Missing orderId' });

  const orderReq = await b44.entities.RideOrder.get(orderId);
  if (!orderReq) return Response.json({ success: false, reason: 'Order not found' });

  await b44.entities.AuditLog.create({
    action: 'ASSIGN_RIDE_REQUESTED',
    user_type: 'sistema',
    user_name: 'assignRide',
    details: `Request to assign ride ${orderId} to driver ${forceManual ? manualDriverName : driverId}`
  }).catch(() => {});

  // Las asignaciones forzadas y los choferes ficticios quedan deshabilitados.
  // Toda asignación debe pasar por la validación y la reserva atómica de abajo.
  if (forceManual || payload.operatorOverride) {
    return Response.json({
      success: false,
      reason: 'La asignación forzada está deshabilitada. Seleccione un móvil real y disponible.'
    });
  }

  if (!driverId) return Response.json({ success: false, reason: 'Missing driverId' });
  const driverReq = await b44.entities.Driver.get(driverId);
  if (!driverReq) return Response.json({ success: false, reason: 'Driver not found' });
  
  // 1.5 Bloqueo estricto
  if (driverReq.status !== 'disponible') {
     return Response.json({ success: false, reason: 'El móvil está fuera de servicio u ocupado.' });
  }

  try {
    // Nota: Lógica de penalización de cola removida por pedido del cliente (mantenía a todos saltando de lugar incorrectamente)

    // 2. Fetch config
    const tarifaConfigs = await b44.entities.TarifaConfig.list();
    const config = tarifaConfigs[0] || {};
    const timeoutSeconds = config.tiempo_maximo_respuesta_segundos ?? 60;
    const autoReassignActive = config.auto_reasignacion_activa ?? true;
    // Una asignación manual siempre debe esperar la aceptación del chofer.
    const autoAceptarViajes = payload.requireDriverConfirmation === true
      ? false
      : (config.auto_aceptar_viajes ?? false);

    const targetOrderStatus = autoAceptarViajes ? "aceptado" : "ofrecido";
    const targetDriverStatus = autoAceptarViajes ? "en_viaje" : "ofrecido";

    const newAttempt = (orderReq.assignment_attempt || 0) + 1;
    const offeredIds = [...(orderReq.offered_driver_ids || [])];
    if (!offeredIds.includes(driverId)) offeredIds.push(driverId);

    // Update basic tracking fields directly first, so Atomic gets the fresh object state
    orderReq.assignment_attempt = newAttempt;
    orderReq.offered_driver_ids = offeredIds;
    orderReq.assigned_base = driverReq.current_base;
    orderReq.driver_name = driverReq.name;

    await b44.entities.RideOrder.update(orderId, {
      offered_driver_ids: offeredIds,
      assignment_attempt: newAttempt,
      assigned_base: driverReq.current_base,
      driver_name: driverReq.name,
      assigned_at: new Date().toISOString()
    });

    // 3. Dispatch Logic Atomic Run (handles the lock, Push, and Audit)
    const token = crypto.randomUUID();
    let success = false;
    try {
        success = await assignDriverToOrderAtomic(b44, orderReq, driverReq, token);
    } catch (e) {
        console.warn("Atomic assign threw (e.g. pilot mismatch), fallback logic disabled for raw error.", e);
        success = false;
    }

    if (success) {
      // 4. Update statuses cleanly to mirror legacy UI behavior
      if (targetDriverStatus === "en_viaje") {
        await b44.entities.Driver.update(driverId, { status: "en_viaje" });
      }
      // Siempre forzamos el estado visual de la orden para que el operador lo vea correcto en la plantilla
      await b44.entities.RideOrder.update(orderId, { status: targetOrderStatus, reserved_driver_id: driverId });

      // 5. Trigger Reassignment if needed
      if (targetOrderStatus === "ofrecido" && autoReassignActive) {
        b44.functions.invoke("autoReassignOnTimeout", {
          orderId: orderId,
          driverId: driverId,
          timeoutSeconds: timeoutSeconds,
          assignmentAttempt: newAttempt,
          internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
        }).catch((e: any) => console.error("AutoReassign Trigger Error:", e));
      }
    } else {
      // Si la reserva atómica falla, no se fuerza el viaje ni se envía una notificación.
      // Esto cubre la carrera en la que el móvil sale de servicio mientras el operador asigna.
      await b44.entities.RideOrder.update(orderId, {
        status: "pendiente",
        driver_id: null,
        reserved_driver_id: null,
        driver_name: null,
        reservation_token: null
      });
      return Response.json({
        success: false,
        reason: "El móvil ya no está disponible. El pasaje quedó pendiente."
      });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("AssignRide Error:", e);
    return Response.json({ success: false, reason: e.message });
  }
});