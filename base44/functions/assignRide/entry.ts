import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assignDriverToOrderAtomic } from '../../shared/DispatchLogic.ts';
import { verifyRequestAuth, verifyJWT } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { orderId, driverId, sessionToken, internalKey } = payload;

  const { forceManual, manualDriverName } = payload;
  
  // assignRide es autoridad de despacho: sólo servicio interno u operador autenticado.
  // La app cliente nunca puede elegir ni reasignar móviles directamente.
  const isAuthorized = await verifyRequestAuth(b44, payload, { allowOperator: true });
  if (!isAuthorized) {
    console.error("AssignRide: Unauthorized request for orderId:", orderId);
    return Response.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  if (!orderId) return Response.json({ success: false, reason: 'Missing orderId' });

  const orderReq = await b44.entities.RideOrder.get(orderId);
  if (!orderReq) return Response.json({ success: false, reason: 'Order not found' });

  // Barrera absoluta contra reasignación anticipada. Mientras una oferta siga
  // vigente para un móvil, ningún assignRide directo puede cambiarla de dueño.
  // Rechazo explícito y timeout se procesan por rejectRide, que es la única ruta
  // autorizada para mover una oferta activa al siguiente móvil.
  const currentOfferOwner = orderReq.reserved_driver_id || orderReq.driver_id || null;
  const rawOfferExpiry = orderReq.offerExpiresAt;
  const offerExpiry = rawOfferExpiry == null ? NaN : Number(rawOfferExpiry);
  // Una oferta con dueño SIEMPRE está activa hasta que rejectRide cierre el intento.
  // offerExpiresAt=null significa "todavía no presentada", no "libre/expirada".
  // Incluso si expiresAt ya pasó, assignRide no roba la oferta: el timeout canónico
  // debe ganar primero y avanzar A→B con identidad de intento.
  const offerStillLive = orderReq.status === 'ofrecido' &&
    Boolean(currentOfferOwner);

  if (offerStillLive) {
    const remainingMs = Number.isFinite(offerExpiry) ? Math.max(0, offerExpiry - Date.now()) : null;
    await b44.entities.AuditLog.create({
      action: 'PREMATURE_REASSIGN_BLOCKED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Bloqueada reasignación anticipada de ${orderId}: la oferta sigue vigente para ${currentOfferOwner}`,
      metadata: {
        orderId,
        currentDriverId: currentOfferOwner,
        requestedDriverId: driverId,
        assignmentAttempt: orderReq.assignment_attempt ?? null,
        offerExpiresAt: orderReq.offerExpiresAt ?? null,
        remainingMs
      }
    }).catch(() => {});
    return Response.json({
      success: false,
      reason: 'OFFER_STILL_ACTIVE_ON_OTHER_DRIVER',
      remainingMs
    });
  }

  // Barrera de ciclo de vida: una orden que ya fue aceptada/iniciada/finalizada
  // nunca vuelve a entrar al motor de asignación. Esto protege contra timeouts,
  // cron/reconciliadores atrasados y pantallas viejas.
  const lifecycleProtectedStatuses = new Set(['aceptado', 'en_camino', 'en_viaje', 'completado', 'cancelado', 'rechazado']);
  if (lifecycleProtectedStatuses.has(orderReq.status)) {
    return Response.json({ success: false, reason: 'ORDER_ALREADY_ACTIVE_OR_FINAL' });
  }

  // PREVENCIÓN DE COLISIÓN (DOBLE DISPARO) AL MISMO TIEMPO:
  // Si la orden ya está "ofrecida" o "procesando_despacho" a alguien más (o incluso al mismo),
  // y la reserva no ha expirado, rechazar instantáneamente para no correr motores de empuje ni solapar cronómetros.
  if ((orderReq.status === 'procesando_despacho' || orderReq.status === 'esperando_confirmacion_manual') &&
      (orderReq.driver_id || orderReq.reserved_driver_id)) {
    await b44.entities.AuditLog.create({
      action: 'CONCURRENT_ASSIGN_BLOCKED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Rechazado intento concurrente de asignar ${orderId}: ya está en proceso`,
      metadata: { orderId, currentAssigned: orderReq.driver_id || orderReq.reserved_driver_id, attemptDriver: driverId }
    }).catch(() => {});
    return Response.json({ success: false, reason: 'CONCURRENT_ASSIGNMENT_BLOCKED' });
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
  const [driverReq, assignedOrders, reservedOrders, tarifaConfigs] = await Promise.all([
    b44.entities.Driver.get(driverId),
    // Sólo interesan conflictos VIVOS. Consultar todo el historial del chofer hacía
    // que el costo de cada despacho creciera con los meses de operación.
    b44.entities.RideOrder.filter({
      driver_id: driverId,
      status: { $in: ['ofrecido','aceptado','en_camino','en_viaje'] }
    }),
    b44.entities.RideOrder.filter({
      reserved_driver_id: driverId,
      status: { $in: ['ofrecido','aceptado','en_camino','en_viaje'] }
    }),
    b44.entities.TarifaConfig.list(),
    b44.entities.AuditLog.create({
      action: 'ASSIGN_RIDE_REQUESTED',
      user_type: 'sistema',
      user_name: 'assignRide',
      details: `Request to assign ride ${orderId} to driver ${forceManual ? manualDriverName : driverId}`
    }).catch(() => null)
  ]);

  if (!driverReq) return Response.json({ success: false, reason: 'Driver not found' });
  const effectiveDriverBase = driverReq.queue_authoritative_base || null;
  const activeStatuses = new Set(['ofrecido', 'aceptado', 'en_camino', 'en_viaje']);
  let conflictingOrders = [...assignedOrders, ...reservedOrders].filter(
    (existing:any, index:number, all:any[]) =>
      existing.id !== orderId &&
      activeStatuses.has(existing.status) &&
      all.findIndex((x:any)=>x.id === existing.id) === index
  );
  // La capacidad se calcula DESPUÉS de reparar posibles conflictos fantasma.
  // Evita reservar erróneamente el slot 2 por una orden ya finalizada.
  let hasCurrentRide = false;
  let hasNextRide = Boolean(driverReq.next_order_id);
  let assignAsNext = false;

  // Barrera de vehículo real: el estado del Driver no alcanza porque puede quedar
  // una base o un "disponible" viejo. La asignación exige un Movil vinculado,
  // activo, sin suspensión y en servicio en este mismo instante.
  const driverMobileId = String(driverReq.vehicle_model || '');
  // Driver.vehicle_model es la referencia autoritativa al Movil. El despacho no
  // adivina vínculos por número, patente ni caches legacy.
  const linkedMovil = driverMobileId
    ? await b44.entities.Movil.get(driverMobileId).catch(() => null)
    : null;

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

  // Los conflictos reales ya fueron contados como slot 1. No se bloquea por tener
  // un viaje: sólo se bloquea cuando los dos slots están ocupados.

  // Reparación segura de "viajes fantasma": puede quedar un RideOrder como en_viaje
  // aunque finishRide haya confirmado el cierre y el Driver ya esté libre/sin referencias.
  // Ese registro viejo no debe bloquear todos los próximos push del móvil.
  if (
    conflictingOrders.length > 0 &&
    driverReq.status === 'disponible' &&
    !driverReq.reserved_order_id &&
    !driverReq.active_ride_id &&
    !driverReq.active_ride_id
  ) {
    const conflictIds = conflictingOrders.map((o:any) => o.id).filter(Boolean);
    const finishLogs = conflictIds.length
      ? await b44.entities.AuditLog.filter({
          action:'FINISH_RIDE_COMMITTED',
          'metadata.orderId':{ $in: conflictIds }
        }).catch(() => [])
      : [];

    const finishedAtByOrder = new Map<string,string>();
    for (const log of finishLogs || []) {
      const finishedOrderId = log?.metadata?.orderId;
      if (!finishedOrderId) continue;
      const at = log.created_date || new Date().toISOString();
      const previous = finishedAtByOrder.get(finishedOrderId);
      if (!previous || new Date(at).getTime() > new Date(previous).getTime()) {
        finishedAtByOrder.set(finishedOrderId, at);
      }
    }

    if (finishedAtByOrder.size > 0) {
      for (const stale of conflictingOrders) {
        const finishedAt = finishedAtByOrder.get(stale.id);
        if (!finishedAt) continue;

        const repaired = await b44.entities.RideOrder.updateMany(
          {
            id:stale.id,
            driver_id:driverId,
            status:{ $in:['ofrecido','aceptado','en_camino','en_viaje'] }
          },
          { $set:{
            status:'completado',
            reserved_driver_id:null,
            reservation_token:null,
            offerExpiresAt:null,
            processingOwnerId:null,
            processingPhase:null,
            processingAction:null,
            processingOperationKey:null,
            taximetro_iniciado:false,
            ride_finished_at:stale.ride_finished_at || finishedAt,
            lastCompletedAction:'FINISH',
            updated_date:finishedAt
          } }
        ).catch(() => ({ updated:0 }));

        const repairedCount = repaired?.updated ?? repaired?.modifiedCount ?? repaired?.matchedCount ?? 0;
        if (repairedCount === 1) {
          await b44.entities.AuditLog.create({
            action:'STALE_ACTIVE_RIDE_REPAIRED_BEFORE_ASSIGN',
            user_type:'sistema',
            user_name:'assignRide',
            details:`Se reparó viaje fantasma ${stale.id} antes de asignar un nuevo pasaje a ${driverReq.name || driverId}`,
            metadata:{ orderId:stale.id, driverId, finishCommittedAt:finishedAt }
          }).catch(()=>{});
        }
      }

      conflictingOrders = conflictingOrders.filter((existing:any) => !finishedAtByOrder.has(existing.id));
    }
  }
  
  hasCurrentRide = Boolean(
    driverReq.active_ride_id || driverReq.reserved_order_id ||
    conflictingOrders.length > 0
  );
  hasNextRide = Boolean(driverReq.next_order_id);
  if (hasCurrentRide && hasNextRide) {
    return Response.json({ success:false, reason:'DRIVER_CAPACITY_FULL' });
  }
  assignAsNext = hasCurrentRide && !hasNextRide;

  // Fuera de servicio siempre bloquea. Para slot 1 se exige disponibilidad/base;
  // para slot 2 no: el móvil ocupado está deliberadamente fuera de la cola.
  if (driverReq.status === 'no_disponible' || (!assignAsNext && (driverReq.status !== 'disponible' || !effectiveDriverBase))) {
    return Response.json({ success:false, reason:'DRIVER_OFF_SERVICE_OR_NO_BASE' });
  }

  // Nueva Validación estricta de Zona (Server-Side)
  let isManualAuthorized = false;
  // Esperar la confirmación del chofer NO convierte la asignación en manual
  // ni autoriza a saltar la zona. Solo forceManual identifica una excepción explícita.
  const requestedManual = forceManual === true;
  // Protección server-side: si una orden ya tuvo una
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
  if (!assignAsNext && orderReq.zone && effectiveDriverBase !== orderReq.zone && !isManualAuthorized) {
    console.warn(`[STRICT ZONE] Rechazado assign de Viaje ${orderId} (Zona: ${orderReq.zone}) a Móvil ${driverId} (Base: ${effectiveDriverBase}). ManualAuth: ${isManualAuthorized}`);
    
    // Una selección equivocada de zona NO autoriza a publicar Pendientes. El
    // llamador automático debe continuar con el siguiente candidato de la zona.
    // Tampoco tocamos el RideOrder: podría existir una oferta válida concurrente.
    return Response.json({
      success: false,
      reason: `DRIVER_WRONG_ZONE:${effectiveDriverBase || 'sin_base'}:${orderReq.zone}`
    });
  }

  // Si el cliente pidió específicamente ESTE móvil y ya está ocupado, el segundo
  // cupo se RESERVA pero todavía no se confirma. Se envía una oferta real al teléfono;
  // recién ACEPTAR la convierte en preasignado_proximo.
  const requestedSecondSlotOffer = assignAsNext &&
    orderReq.requested_driver_only === true && orderReq.requested_driver_id === driverId;
  if (requestedSecondSlotOffer) {
    const nextToken = crypto.randomUUID();
    const newAttempt = Number(orderReq.assignment_attempt || 0) + 1;
    const assignedAt = new Date().toISOString();
    const driverNext = await b44.entities.Driver.updateMany(
      { id:driverId, status:{ $ne:'no_disponible' },
        $and:[
          { $or:[{next_order_id:null},{next_order_id:{ $exists:false }}] },
          { $or:[{active_ride_id:{ $ne:null }},{reserved_order_id:{ $ne:null }}] }
        ] },
      { $set:{next_order_id:orderId,next_order_token:nextToken} }
    );
    if ((driverNext.matchedCount ?? driverNext.modifiedCount ?? driverNext.updated ?? 0) !== 1)
      return Response.json({success:false,reason:'DRIVER_CAPACITY_FULL'});

    const offered = await b44.entities.RideOrder.updateMany(
      {id:orderId,status:{ $in:['pendiente','procesando_despacho','esperando_confirmacion_manual'] }},
      {$set:{status:'ofrecido',driver_id:driverId,driver_name:driverReq.name,reserved_driver_id:driverId,
        reservation_token:nextToken,second_slot_offer:true,assignment_attempt:newAttempt,assigned_at:assignedAt,
        assigned_base:null,offerExpiresAt:null,push_ack_at:null,push_ack_assignment_attempt:null,
        alert_presented_at:null,alert_presented_assignment_attempt:null,alert_presented_protocol_attempt:null,
        delivery_retry_count:0,pending_reason:null},$addToSet:{offered_driver_ids:driverId}}
    );
    if ((offered.matchedCount ?? offered.modifiedCount ?? offered.updated ?? 0) !== 1) {
      const rollbackDriver = await b44.entities.Driver.updateMany(
        {id:driverId,next_order_id:orderId,next_order_token:nextToken},
        {$set:{next_order_id:null,next_order_token:null}}
      ).catch(()=>null);
      if ((rollbackDriver?.matchedCount ?? rollbackDriver?.modifiedCount ?? rollbackDriver?.updated ?? 0) !== 1) {
        await b44.entities.AuditLog.create({action:'SECOND_SLOT_RESERVATION_ROLLBACK_FAILED',user_type:'sistema',user_name:'assignRide',details:`No se pudo liberar reserva provisional del segundo pasaje requerido ${orderId}`,metadata:{orderId,driverId,nextToken}}).catch(()=>{});
        return Response.json({success:false,reason:'SECOND_SLOT_RESERVATION_ROLLBACK_FAILED'},{status:409});
      }
      return Response.json({success:false,reason:'ORDER_CHANGED'});
    }
    b44.functions.invoke('sendPushNotification',{action:'send',driverId,orderId,orderData:{
      pickup_address:orderReq.pickup_address,dropoff_address:orderReq.dropoff_address,fare:orderReq.fare,
      notes:orderReq.notes,assignmentAttempt:newAttempt},internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(()=>{});
    b44.functions.invoke('autoReassignOnTimeout',{orderId,driverId,assignmentAttempt:newAttempt,internalKey:Deno.env.get('INTERNAL_SERVICE_KEY')}).catch(()=>{});
    await b44.entities.AuditLog.create({action:'SECOND_RIDE_OFFERED_REQUIRED',user_type:'sistema',user_name:'assignRide',
      details:`Segundo pasaje requerido ${orderId} ofrecido a ${driverReq.name || driverId}; espera aceptación.`,
      metadata:{orderId,driverId,assignmentAttempt:newAttempt}}).catch(()=>{});
    return Response.json({success:true,assigned:true,mode:'next_offer',orderId,driverId});
  }

  // Segundo slot ordinario: reservar como próximo mediante CAS.
  if (assignAsNext) {
    const nextToken = crypto.randomUUID();
    const driverNext = await b44.entities.Driver.updateMany(
      {
        id:driverId,
        status:{ $ne:'no_disponible' },
        // Debe seguir existiendo el slot 1 al ganar el CAS. Así una foto vieja
        // no puede crear un "próximo" sobre un móvil que quedó libre.
        $and:[
          { $or:[{next_order_id:null},{next_order_id:{ $exists:false }}] },
          { $or:[
            {active_ride_id:{ $ne:null }},
            {reserved_order_id:{ $ne:null }}
          ] }
        ]
      },
      { $set:{ next_order_id:orderId, next_order_token:nextToken } }
    );
    const wonNext = (driverNext?.matchedCount ?? driverNext?.modifiedCount ?? driverNext?.updated ?? 0) === 1;
    if (!wonNext) return Response.json({success:false,reason:'DRIVER_CAPACITY_FULL'});

    const orderNext = await b44.entities.RideOrder.updateMany(
      {
        id:orderId,
        status:{ $in:['pendiente','procesando_despacho','esperando_confirmacion_manual'] },
        $or:[{preassigned_driver_id:null},{preassigned_driver_id:{ $exists:false }}]
      },
      { $set:{
        status:'preasignado_proximo',
        driver_id:driverId,
        driver_name:driverReq.name,
        preassigned_driver_id:driverId,
        preassignment_token:nextToken,
        preassigned_at:new Date().toISOString(),
        assigned_base:effectiveDriverBase || orderReq.zone || null,
        pending_reason:null
      }}
    );
    const wonOrder = (orderNext?.matchedCount ?? orderNext?.modifiedCount ?? orderNext?.updated ?? 0) === 1;
    if (!wonOrder) {
      const rollbackDriver = await b44.entities.Driver.updateMany(
        {id:driverId,next_order_id:orderId,next_order_token:nextToken},
        {$set:{next_order_id:null,next_order_token:null}}
      ).catch(()=>null);
      if ((rollbackDriver?.matchedCount ?? rollbackDriver?.modifiedCount ?? rollbackDriver?.updated ?? 0) !== 1) {
        await b44.entities.AuditLog.create({action:'SECOND_SLOT_RESERVATION_ROLLBACK_FAILED',user_type:'sistema',user_name:'assignRide',details:`No se pudo liberar reserva provisional del segundo pasaje ${orderId}`,metadata:{orderId,driverId,nextToken}}).catch(()=>{});
        return Response.json({success:false,reason:'SECOND_SLOT_RESERVATION_ROLLBACK_FAILED'},{status:409});
      }
      return Response.json({success:false,reason:'ORDER_CHANGED'});
    }
    await b44.entities.AuditLog.create({
      action:'SECOND_RIDE_ASSIGNED',
      user_type:'sistema',
      user_name:'assignRide',
      details:`Segundo pasaje ${orderId} reservado para ${driverReq.name || driverId}`,
      metadata:{orderId,driverId,source:forceManual ? 'manual_or_required' : 'dispatch'}
    }).catch(()=>{});
    return Response.json({success:true,assigned:true,mode:'next',orderId,driverId});
  }

  // 2. Recuperación segura de referencias huérfanas.
  // NUNCA limpiar una reserva vigente solo para que una asignación manual entre:
  // otro operador puede haber reservado este móvil milisegundos antes.
  const linkedOrderId = driverReq.reserved_order_id || driverReq.active_ride_id;
  if (linkedOrderId && linkedOrderId !== orderId) {
    const linkedOrder = await b44.entities.RideOrder.get(linkedOrderId).catch(() => null);
    const linkedIsActive = linkedOrder && activeStatuses.has(linkedOrder.status) &&
      (linkedOrder.driver_id === driverId || linkedOrder.reserved_driver_id === driverId);
    if (linkedIsActive) {
      return Response.json({ success:false, reason:'DRIVER_ALREADY_BUSY', conflictingOrderId: linkedOrder.id });
    }
    // Solo limpiamos si comprobamos que la referencia es huérfana/muerta.
    const cleaned = await b44.entities.Driver.updateMany(
      { id: driverId, reserved_order_id: driverReq.reserved_order_id ?? null, active_ride_id: driverReq.active_ride_id ?? null, next_order_id: driverReq.next_order_id ?? null },
      { $set: { status:'disponible', dispatch_status:'normal', reserved_order_id:null, active_ride_id:null, reservation_token:null, driver_reservation_key:null } }
    );
    if (cleaned.updated !== 1) return Response.json({ success:false, reason:'DRIVER_STATE_CHANGED_RETRY' });
    driverReq.status = 'disponible';
    driverReq.dispatch_status = 'normal';
    driverReq.reserved_order_id = null;
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
    // Motor nuevo: la ventana comercial NO nace al asignar. Sólo ALERT_PRESENTED puede
    // crear offerExpiresAt = presented_at + tiempo configurado. Antes de eso existe
    // entrega técnica, pero no un timeout comercial.
    const autoReassignActive = config.auto_reasignacion_activa ?? true;
    // Toda asignación crea una oferta. Sólo acceptRide puede confirmar al chofer.
    const targetOrderStatus = "ofrecido";

    const newAttempt = (orderReq.assignment_attempt || 0) + 1;
    // Historial único de ofertas. La barrera superior impide repeticiones;
    // Set protege además contra datos históricos duplicados.
    const offeredIds = [...new Set([...(orderReq.offered_driver_ids || []), driverId])];

    // La oferta nace SIN vencimiento comercial. handleNativePushAction es el único
    // que lo crea cuando el teléfono confirma native_alert_presented.
    const assignedAt = new Date().toISOString();
    const offerExpiresAt = null;

    // Update memory object for Push payload
    orderReq.assignment_attempt = newAttempt;
    orderReq.offered_driver_ids = offeredIds;
    orderReq.assigned_base = effectiveDriverBase;
    orderReq.driver_name = driverReq.name;
    orderReq.assigned_at = assignedAt;
    orderReq.offerExpiresAt = offerExpiresAt;
    orderReq.push_ack_at = null;
    orderReq.push_ack_assignment_attempt = null;
    orderReq.alert_presented_at = null;
    orderReq.alert_presented_assignment_attempt = null;
    orderReq.alert_presented_protocol_attempt = null;
    orderReq.delivery_retry_count = 0;
    orderReq.pending_reason = null;
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
        console.warn("Atomic assign failed; no alternate dispatch path will run.", e);
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

      // La reserva atómica ya dejó la orden y el chofer en estado `ofrecido`.
      // No existe una segunda ruta que pueda confirmar el viaje sin acceptRide.

      // 5. Trigger Reassignment if needed
      if (targetOrderStatus === "ofrecido" && autoReassignActive) {
        // Watchdog de entrega/presentación. No puede generar timeout comercial
        // mientras ALERT_PRESENTED no haya creado offerExpiresAt.
        b44.functions.invoke("autoReassignOnTimeout", {
          orderId: orderId,
          driverId: driverId,
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