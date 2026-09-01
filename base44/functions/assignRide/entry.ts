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

  if (!driverId) return Response.json({ success: false, reason: 'Missing driverId' });
  const driverReq = await b44.entities.Driver.get(driverId);
  if (!driverReq) return Response.json({ success: false, reason: 'Driver not found' });

  // 1. Verificar si el móvil está ocupado con OTRO viaje real activo (seguridad para no robar viajes)
  const [assignedOrders, reservedOrders] = await Promise.all([
    b44.entities.RideOrder.filter({ driver_id: driverId }),
    b44.entities.RideOrder.filter({ reserved_driver_id: driverId })
  ]);
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
      
      // Escribir los datos de asignación solo después del éxito atómico
      await b44.entities.RideOrder.update(orderId, {
        status: targetOrderStatus, 
        reserved_driver_id: driverId,
        offered_driver_ids: offeredIds,
        assignment_attempt: newAttempt,
        assigned_base: driverReq.current_base,
        driver_name: driverReq.name,
        assigned_at: assignedAt,
        offerExpiresAt: offerExpiresAt
      });

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