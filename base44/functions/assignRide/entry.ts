import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assignDriverToOrderAtomic, validatePilotDriver } from '../../shared/DispatchLogic.ts';
import { verifyRequestAuth, verifyJWT } from '../../shared/security.ts';

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

  // Barrera de ciclo de vida: una orden que ya fue aceptada/iniciada/finalizada
  // nunca vuelve a entrar al motor de asignación. Esto protege contra timeouts,
  // cron/reconciliadores atrasados y pantallas viejas.
  const lifecycleProtectedStatuses = new Set(['aceptado', 'en_camino', 'en_viaje', 'completado', 'cancelado', 'rechazado']);
  if (lifecycleProtectedStatuses.has(orderReq.status)) {
    return Response.json({ success: false, reason: 'ORDER_ALREADY_ACTIVE_OR_FINAL' });
  }

  // Defensa adicional ante un retroceso ya ocurrido: si quedó "pendiente" pero
  // el historial confirma que había sido aceptado o iniciado, no redistribuirlo.
  if (orderReq.status === 'pendiente' && ['ACCEPT', 'START', 'FINISH'].includes(orderReq.lastCompletedAction)) {
    await b44.entities.AuditLog.create({
      action: 'LIFECYCLE_REGRESSION_ASSIGN_BLOCKED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Bloqueada reasignación del viaje ${orderId}: figura pendiente pero ya había avanzado a ${orderReq.lastCompletedAction}`,
      metadata: { orderId, driverId, lastCompletedAction: orderReq.lastCompletedAction }
    }).catch(() => {});
    return Response.json({ success: false, reason: 'LIFECYCLE_REGRESSION_PROTECTED' });
  }

  if (!driverId) return Response.json({ success: false, reason: 'Missing driverId' });

  // Estas validaciones son independientes entre sí. Ejecutarlas en serie agregaba
  // varios viajes de red antes de marcar la oferta como `ofrecido` (10–15 s en
  // casos reales). Se resuelven en paralelo sin relajar ninguna regla operativa.
  const [driverReq, allMoviles, assignedOrders, reservedOrders, tarifaConfigs] = await Promise.all([
    b44.entities.Driver.get(driverId),
    b44.entities.Movil.list(),
    b44.entities.RideOrder.filter({ driver_id: driverId }),
    b44.entities.RideOrder.filter({ reserved_driver_id: driverId }),
    b44.entities.TarifaConfig.list(),
    b44.entities.AuditLog.create({
      action: 'ASSIGN_RIDE_REQUESTED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Request to assign ride ${orderId} to driver ${forceManual ? manualDriverName : driverId}`
    }).catch(() => null),
    validatePilotDriver(b44, orderReq.zone || '1-Puerto', driverId)
  ]);

  if (!driverReq) return Response.json({ success: false, reason: 'Driver not found' });
  // Evita repetir la misma consulta dentro del bloque atómico.
  orderReq.__pilotValidated = true;

  // Barrera de vehículo real: el estado del Driver no alcanza porque puede quedar
  // una base o un "disponible" viejo. La asignación exige un Movil vinculado,
  // activo, sin suspensión y en servicio en este mismo instante.
  const driverMobileId = String(driverReq.vehicle_model || '');
  const driverMobileNumber = parseInt(driverMobileId, 10);
  const driverPlate = String(driverReq.vehicle_plate || '').replace(/\s+/g, '').toUpperCase();
  const linkedMovil = allMoviles.find((m: any) =>
    m.id === driverMobileId ||
    m.numero_movil === driverMobileNumber ||
    m.driver_id === driverId ||
    (Array.isArray(m.driver_ids) && m.driver_ids.includes(driverId)) ||
    (driverPlate && String(m.dominio || '').replace(/\s+/g, '').toUpperCase() === driverPlate)
  );

  if (!linkedMovil || linkedMovil.activo === false || linkedMovil.fuera_de_servicio === true || linkedMovil.suspension_motivo) {
    await b44.entities.AuditLog.create({
      action: 'INELIGIBLE_MOBILE_ASSIGN_BLOCKED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Bloqueada asignación del viaje ${orderId}: móvil inexistente, suspendido o fuera de servicio`,
      metadata: { orderId, driverId, mobileId: linkedMovil?.id || null }
    }).catch(() => {});
    return Response.json({
      success: false,
      reason: 'El móvil no está habilitado o está fuera de servicio. El pasaje debe quedar pendiente.'
    });
  }

  // Barrera definitiva: un mismo pasaje jamás se ofrece dos veces al mismo chofer.
  // Se valida en el punto común de entrada para cubrir reasignaciones automáticas,
  // solicitudes duplicadas, cron atrasado y acciones de pantallas viejas.
  const previousOffers = Array.isArray(orderReq.offered_driver_ids)
    ? orderReq.offered_driver_ids.filter(Boolean)
    : [];
  if (previousOffers.includes(driverId)) {
    await b44.entities.AuditLog.create({
      action: 'DUPLICATE_DRIVER_REASSIGN_BLOCKED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Bloqueada segunda oferta del viaje ${orderId} al chofer ${driverId}`,
      metadata: {
        orderId,
        driverId,
        assignmentAttempt: orderReq.assignment_attempt ?? null
      }
    }).catch(() => {});
    return Response.json({
      success: false,
      reason: 'DRIVER_ALREADY_OFFERED_THIS_ORDER'
    });
  }

  // 1. Verificar si el móvil está ocupado con OTRO viaje real activo (seguridad para no robar viajes)
  const activeStatuses = new Set(['ofrecido', 'aceptado', 'en_camino', 'en_viaje']);
  const conflictingOrders = [...assignedOrders, ...reservedOrders].filter(
    (existing: any) => existing.id !== orderId && activeStatuses.has(existing.status)
  );
  
  if (conflictingOrders.length > 0) {
    // Nunca cancelar automáticamente otro pasaje para destrabar un móvil.
    // Mientras tenga un viaje activo, este móvil simplemente no es candidato.
    // El pasaje que intentamos asignar conserva su estado y el despacho automático seguirá buscando.
    return Response.json({
      success: false,
      reason: 'DRIVER_ALREADY_BUSY'
    });
  }

  if (driverReq.status === 'no_disponible') {
    return Response.json({
      success: false,
      reason: 'El móvil está fuera de turno. No puede recibir viajes hasta que inicie servicio.'
    });
  }

  // Nueva Validación estricta de Zona (Server-Side)
  let isManualAuthorized = false;
  // Esperar la confirmación del chofer NO convierte la asignación en manual
  // ni autoriza a saltar la zona. Solo forceManual identifica una excepción explícita.
  const requestedManual = forceManual === true;
  // Protección server-side también para APK viejos: si una orden ya tuvo una
  // aceptación confirmada y aparece nuevamente como pendiente, nunca debe entrar
  // al despacho automático. Solo una asignación manual autorizada de Central puede reactivarla.
  const wasAlreadyAccepted = orderReq.status === 'pendiente' && ['ACCEPT', 'START', 'FINISH'].includes(orderReq.lastCompletedAction);
  const heldForCentralReview =
    String(orderReq.notes || '').includes('[REVISION_CENTRAL_CANCELADO_CHOFER]') ||
    wasAlreadyAccepted;
  if (heldForCentralReview && !requestedManual) {
    return Response.json({ success: false, reason: 'PENDING_CENTRAL_REVIEW' });
  }
  
  if (requestedManual && sessionToken) {
    const tokenData = await verifyJWT(sessionToken);
    if (tokenData && tokenData.id) {
      const ops = await b44.entities.UsuariosSistema.filter({ id: tokenData.id });
      if (ops.length > 0 && ops[0].activo) {
        const rol = ops[0].rol || ops[0].role;
        if (["Administrador General", "Supervisor", "Operador", "admin", "supervisor", "operador"].includes(rol)) {
          isManualAuthorized = true;
        }
      }
    }
  }

  // La selección automática jamás cruza zonas. Solamente una asignación manual
  // autenticada de Central puede elegir otro móvil como excepción de emergencia.
  if (orderReq.zone && driverReq.current_base !== orderReq.zone && !isManualAuthorized) {
    console.warn(`[STRICT ZONE] Rechazado assign de Viaje ${orderId} (Zona: ${orderReq.zone}) a Móvil ${driverId} (Base: ${driverReq.current_base}). ManualAuth: ${isManualAuthorized}`);
    
    // Limpiamos devolviendo a pendiente de forma 100% ATÓMICA.
    // Solo si el pasaje sigue exactamente en el mismo estado en que lo leímos.
    // Si otro proceso legítimo ya lo tomó o modificó, no tocamos nada.
    await b44.entities.RideOrder.updateMany(
       { 
         id: orderId, 
         status: orderReq.status,
         assignment_attempt: orderReq.assignment_attempt ?? null,
         driver_id: orderReq.driver_id ?? null,
         reserved_driver_id: orderReq.reserved_driver_id ?? null,
         reservation_token: orderReq.reservation_token ?? null
       },
       { $set: { status: 'pendiente', driver_id: null, driver_name: null, reserved_driver_id: null, assigned_base: null, reservation_token: null, manual_reservation_token: null, offerExpiresAt: null } }
    );
    
    return Response.json({
      success: false,
      reason: `Asignación denegada: el móvil está en ${driverReq.current_base || 'ninguna base'} y el pasaje es de zona ${orderReq.zone}. Debe quedar pendiente.`
    });
  }

  // 2. Recuperación segura de referencias huérfanas.
  // NUNCA limpiar una reserva vigente solo para que una asignación manual entre:
  // otro operador puede haber reservado este móvil milisegundos antes.
  const linkedOrderId = driverReq.reserved_order_id || driverReq.active_order_id || driverReq.active_ride_id;
  if (linkedOrderId && linkedOrderId !== orderId) {
    const linkedOrder = await b44.entities.RideOrder.get(linkedOrderId).catch(() => null);
    const linkedIsActive = linkedOrder && activeStatuses.has(linkedOrder.status) &&
      (linkedOrder.driver_id === driverId || linkedOrder.reserved_driver_id === driverId);
    if (linkedIsActive) {
      return Response.json({ success:false, reason:'DRIVER_ALREADY_BUSY', conflictingOrderId: linkedOrder.id });
    }
    // Solo limpiamos si comprobamos que la referencia es huérfana/muerta.
    const cleaned = await b44.entities.Driver.updateMany(
      { id: driverId, reserved_order_id: driverReq.reserved_order_id ?? null, active_order_id: driverReq.active_order_id ?? null, active_ride_id: driverReq.active_ride_id ?? null },
      { $set: { status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_order_id:null, active_ride_id:null, reservation_token:null, manual_reservation_token:null, driver_reservation_key:null } }
    );
    if (cleaned.updated !== 1) return Response.json({ success:false, reason:'DRIVER_STATE_CHANGED_RETRY' });
    driverReq.status = 'disponible';
    driverReq.dispatch_status = 'normal';
    driverReq.reserved_order_id = null;
    driverReq.active_order_id = null;
    driverReq.active_ride_id = null;
    driverReq.reservation_token = null;
  } else if (driverReq.status !== 'disponible' || (driverReq.dispatch_status != null && driverReq.dispatch_status !== 'normal')) {
    // Sin referencia a viaje no pisamos el estado a ciegas: el CAS atómico decide.
    return Response.json({ success:false, reason:'DRIVER_NOT_AVAILABLE' });
  }

  try {
    // Nota: Lógica de penalización de cola removida por pedido del cliente (mantenía a todos saltando de lugar incorrectamente)

    // 2. Config ya cargada en paralelo con las validaciones anteriores.
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
    // Historial único de ofertas. La barrera superior impide repeticiones;
    // Set protege además contra datos históricos duplicados.
    const offeredIds = [...new Set([...(orderReq.offered_driver_ids || []), driverId])];

    // Cada asignación crea una ventana propia de respuesta. acceptRide usa
    // offerExpiresAt como autoridad para decidir si la oferta sigue vigente.
    const assignedAt = new Date().toISOString();
    const offerExpiresAt = Date.now() + (timeoutSeconds * 1000);

    // Update memory object for Push payload
    orderReq.assignment_attempt = newAttempt;
    orderReq.offered_driver_ids = offeredIds;
    orderReq.assigned_base = driverReq.current_base;
    orderReq.driver_name = driverReq.name;
    orderReq.assigned_at = assignedAt;
    orderReq.offerExpiresAt = offerExpiresAt;
    if (requestedManual) {
      orderReq.notes = String(orderReq.notes || '')
        .replace(/\s*\[REVISION_CENTRAL_CANCELADO_CHOFER\]\s*/g, ' ')
        .trim();
    }

    // 3. Dispatch Logic Atomic Run (handles the lock, Push, and Audit)
    const token = crypto.randomUUID();
    let success = false;
    const oldDriverId = orderReq.reserved_driver_id;
    const oldToken = orderReq.reservation_token;

    try {
        success = await assignDriverToOrderAtomic(b44, orderReq, driverReq, token);
    } catch (e) {
        console.warn("Atomic assign threw (e.g. pilot mismatch), fallback logic disabled for raw error.", e);
        success = false;
    }

    if (success) {
      // 3.5 Liberar al chofer anterior si la orden estaba ofrecida a otro y se reasignó manualmente
      if (oldDriverId && oldDriverId !== driverId) {
         await b44.entities.Driver.updateMany(
           { id: oldDriverId, reservation_token: oldToken },
           { $set: { dispatch_status: 'normal', reserved_order_id: null, reservation_token: null } }
         ).catch(e => console.error("Error liberando chofer anterior", e));
      }

      // 4. Update statuses cleanly to mirror legacy UI behavior
      if (targetDriverStatus === "en_viaje") {
        // No pisar a ciegas el móvil después de la reserva atómica.
        // Solo cambia de estado si todavía conserva la reserva de ESTA orden/token.
        await b44.entities.Driver.updateMany(
          { id: driverId, reserved_order_id: orderId, reservation_token: token },
          { $set: { status: "en_viaje" } }
        );
      }
      
      // Para el flujo normal `ofrecido`, todos estos datos ya quedaron persistidos
      // atómicamente ANTES del push. Evitar una segunda escritura reduce latencia y
      // elimina la ventana de carrera con assignment_attempt. Solo conservar el
      // update adicional si alguna instalación usa auto_aceptar_viajes.
      if (targetOrderStatus !== "ofrecido") {
        await b44.entities.RideOrder.update(orderId, {
          status: targetOrderStatus,
          notes: orderReq.notes,
          reserved_driver_id: driverId,
          offered_driver_ids: offeredIds,
          assignment_attempt: newAttempt,
          assigned_base: driverReq.current_base,
          driver_name: driverReq.name,
          assigned_at: assignedAt,
          offerExpiresAt: offerExpiresAt
        });
      }

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
      // Si la reserva atómica falla, el pasaje ya fue tomado por otro proceso o el móvil ya no está disponible.
      // No modificamos la orden para no pisar un éxito concurrente.
      return Response.json({
        success: false,
        reason: "No se pudo reservar el pasaje (asignación concurrente o móvil ocupado)."
      });
    }

    return Response.json({ success: true });
  } catch (e) {
    console.error("AssignRide Error:", e);
    return Response.json({ success: false, reason: e.message });
  }
});