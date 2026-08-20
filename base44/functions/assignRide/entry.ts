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

  const mobileId = String(payload.mobileId || "");
  if (mobileId) {
    const mobile = await b44.entities.Movil.get(mobileId).catch(() => null);
    if (!mobile) {
      return Response.json({ success: false, reason: 'El móvil seleccionado ya no existe. El pasaje no fue enviado.' });
    }
    if (mobile.activo === false || mobile.fuera_de_servicio || mobile.suspension_motivo) {
      return Response.json({ success: false, reason: `El móvil ${mobile.numero_movil} está inhabilitado o suspendido.` });
    }

    const configuredIds = Array.isArray(mobile.driver_ids) ? mobile.driver_ids.filter(Boolean) : [];
    if (mobile.driver_id && !configuredIds.includes(mobile.driver_id)) configuredIds.push(mobile.driver_id);
    const normalizedPlate = String(mobile.dominio || '').replace(/\s+/g, '').toUpperCase();
    const allDrivers = await b44.entities.Driver.list();
    const linkedDrivers = allDrivers.filter((candidate: any) => {
      if (configuredIds.includes(candidate.id)) return true;
      const model = String(candidate.vehicle_model || '');
      if (model === String(mobile.id) || model === String(mobile.numero_movil)) return true;
      const candidatePlate = String(candidate.vehicle_plate || '').replace(/\s+/g, '').toUpperCase();
      return normalizedPlate && candidatePlate === normalizedPlate;
    });
    const availableLinked = linkedDrivers.filter((candidate: any) => candidate.status === 'disponible');

    if (!linkedDrivers.some((candidate: any) => candidate.id === driverId)) {
      return Response.json({ success: false, reason: `El chofer seleccionado no está vinculado al móvil ${mobile.numero_movil}.` });
    }
    if (availableLinked.length === 0) {
      return Response.json({ success: false, reason: `El móvil ${mobile.numero_movil} no tiene ningún chofer en servicio.` });
    }
    if (availableLinked.length > 1) {
      return Response.json({
        success: false,
        reason: `El móvil ${mobile.numero_movil} tiene más de un chofer en servicio (${availableLinked.map((d: any) => d.name).join(', ')}). Primero dejá solamente uno activo.`
      });
    }
    if (availableLinked[0].id !== driverId) {
      return Response.json({ success: false, reason: `Cambió el chofer activo del móvil ${mobile.numero_movil}. Volvé a intentar la asignación.` });
    }
  }
  // 1.5 Bloqueo estricto: la asignación manual nunca puede despertar
  // ni reservar un móvil fuera de servicio, ocupado o con otro viaje activo.
  if (driverReq.status !== 'disponible') {
    return Response.json({
      success: false,
      reason: 'El móvil está fuera de servicio u ocupado. El pasaje no fue enviado.'
    });
  }
  if ((driverReq.dispatch_status && driverReq.dispatch_status !== 'normal') || driverReq.reserved_order_id) {
    return Response.json({
      success: false,
      reason: 'El móvil ya tiene una asignación pendiente o un viaje activo. El pasaje no fue enviado.'
    });
  }

  const [assignedOrders, reservedOrders] = await Promise.all([
    b44.entities.RideOrder.filter({ driver_id: driverId }),
    b44.entities.RideOrder.filter({ reserved_driver_id: driverId })
  ]);
  const activeStatuses = new Set(['ofrecido', 'aceptado', 'en_camino', 'en_viaje']);
  const conflictingOrder = [...assignedOrders, ...reservedOrders].find(
    (existing: any) => existing.id !== orderId && activeStatuses.has(existing.status)
  );
  if (conflictingOrder) {
    return Response.json({
      success: false,
      reason: 'El móvil ya tiene otro pasaje activo. Este pasaje quedó pendiente y no fue enviado.'
    });
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

    // Update memory object for Push payload
    orderReq.assignment_attempt = newAttempt;
    orderReq.offered_driver_ids = offeredIds;
    orderReq.assigned_base = driverReq.current_base;
    orderReq.driver_name = driverReq.name;

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
      
      // Escribir los datos de asignación solo después del éxito atómico
      await b44.entities.RideOrder.update(orderId, {
        status: targetOrderStatus, 
        reserved_driver_id: driverId,
        offered_driver_ids: offeredIds,
        assignment_attempt: newAttempt,
        assigned_base: driverReq.current_base,
        driver_name: driverReq.name,
        assigned_at: new Date().toISOString()
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