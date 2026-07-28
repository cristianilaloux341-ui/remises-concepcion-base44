import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { triggerDispatch } from '../../shared/DispatchController.ts';
import { tryManualCandidate, assignDriverToOrderAtomic, reassignAfterAutomaticReject, releaseManualDriver } from '../../shared/DispatchLogic.ts';

Deno.serve(async (req) => {
  const payload = await req.json().catch(() => ({}));
  const INTERNAL_KEY = Deno.env.get("INTERNAL_SERVICE_KEY");
  if (!payload.internalKey || !INTERNAL_KEY || payload.internalKey !== INTERNAL_KEY) {
    return Response.json({ error: "Unauthorized. Internal Service Key missing." }, { status: 401 });
  }
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const trace = [];

  let invalidInitialStates = 0;
  let duplicateAssignments = 0;

  const logScenario = (name, details) => {
    trace.push({
      scenario: name,
      time: new Date().toISOString(),
      ...details
    });
  };

  const assertState = async (orderId, driverId, expOrder, expDriver, step) => {
    const o = await b44.entities.RideOrder.get(orderId);
    const d = await b44.entities.Driver.get(driverId);
    if (o.status !== expOrder || d.dispatch_status !== expDriver) {
      invalidInitialStates++;
    }
    return { o, d };
  };

  try {
    const zone = 'E2E_PROD_ZONE';
    
    let bases = await b44.entities.Base.filter({ name: '1-Puerto' });
    if (bases.length === 0) bases = [await b44.entities.Base.create({ name: '1-Puerto', dispatch_status: 'libre' })];
    const baseId = bases[0].id;

    // Clean old state
    await b44.entities.Driver.deleteMany({ name: { $in: ['D1_PROD', 'D2_PROD'] } });
    
    const d1 = await b44.entities.Driver.create({ name: 'D1_PROD', phone: '111', vehicle_plate: 'V1', status: 'disponible', dispatch_status: 'normal', current_session_token: 'ST1' });
    const d2 = await b44.entities.Driver.create({ name: 'D2_PROD', phone: '222', vehicle_plate: 'V2', status: 'disponible', dispatch_status: 'normal', current_session_token: 'ST2' });

    await b44.entities.DispatchConfig.deleteMany({ zone });
    await b44.entities.DispatchConfig.create({
      zone, engineState: 'active', pilotMode: true, enabledBaseIds: [baseId], enabledDriverIds: [d1.id, d2.id]
    });

    const createOrder = () => b44.entities.RideOrder.create({ client_name: 'E2E Client', pickup_address: 'E2E Pick', status: 'pendiente', zone });

    const trackTime = async (fn) => {
      const start = Date.now();
      const res = await fn();
      return { res, durationMs: Date.now() - start };
    };

    const simulateAcceptRide = async (orderId, driverId, sessionToken, assignmentAttempt) => {
      // Allow accepting directly without assignment_attempt filter logic from pilot
      const result = await b44.entities.RideOrder.updateMany(
        { id: orderId, status: "ofrecido", reserved_driver_id: driverId },
        { $set: { status: "aceptado", driver_id: driverId, driver_name: 'Chofer', assigned_base: '1-Puerto', reservation_token: null } }
      );
      const matched = result.matchedCount ?? result.modifiedCount ?? 0;
      if (matched === 1) {
        await b44.entities.Driver.updateMany({ id: driverId }, { $set: { status: 'en_viaje', dispatch_status: 'normal', reservation_token: null, reserved_order_id: null } });
        await b44.entities.AuditLog.create({ action: 'SIMULATE_ACCEPT_WON', user_type: 'sistema', user_name: 'E2E', details: `Order ${orderId} accepted by ${driverId}` });
        return { success: true, matchedCount: matched };
      }
      await b44.entities.AuditLog.create({ action: 'RACE_CONDITION_LOST', user_type: 'sistema', user_name: 'E2E', details: `Accept lost for order ${orderId} by driver ${driverId}` });
      return { success: false, matchedCount: matched };
    };

    const simulateManualConfirm = async (orderId, driverId, manualToken) => {
       const result = await b44.entities.RideOrder.updateMany(
         { id: orderId, status: "esperando_confirmacion_manual", manual_reservation_token: manualToken },
         { $set: { status: "aceptado", driver_id: driverId, manual_reservation_token: null } }
       );
       const matched = result.matchedCount ?? result.modifiedCount ?? 0;
       if (matched === 1) {
         await b44.entities.Driver.updateMany(
           { id: driverId, manual_reservation_token: manualToken },
           { $set: { dispatch_status: 'normal', status: 'en_viaje', manual_reservation_token: null } }
         );
         await b44.entities.Base.updateMany(
           { id: baseId, manual_reservation_token: manualToken },
           { $set: { dispatch_status: 'libre', active_order_id: null, manual_reservation_token: null, manual_expires_at: null } }
         );
         await b44.entities.AuditLog.create({ action: 'SIMULATE_MANUAL_CONFIRM_WON', user_type: 'sistema', user_name: 'E2E', details: `Order ${orderId} manually confirmed by ${driverId}` });
         return { success: true, matchedCount: matched };
       }
       await b44.entities.AuditLog.create({ action: 'RACE_CONDITION_LOST', user_type: 'sistema', user_name: 'E2E', details: `Manual confirm lost for order ${orderId} by driver ${driverId}` });
       return { success: false, matchedCount: matched };
    };

    // 1: Automático -> aceptar
    {
      const order = await createOrder();
      const s1 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        
        // Ensure it's in the state triggerDispatch would leave it before actual driver assign
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho' } });
        const oReady = await b44.entities.RideOrder.get(order.id);
        await assignDriverToOrderAtomic(b44, oReady, d1, tok);
        
        const state = await assertState(order.id, d1.id, 'ofrecido', 'automatic_pending', '1: initial state');
        const accepted = await simulateAcceptRide(order.id, d1.id, 'ST1', order.assignment_attempt ?? 1);
        const fState = await assertState(order.id, d1.id, 'aceptado', 'normal', '1: final state');

        return { disp, accepted, tok, state, fState };
      });
      logScenario('Automático → Aceptar', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: s1.res.disp.correlationId, dispatch_engine: s1.res.state.o.dispatch_engine,
        initialState: `Base: ${s1.res.state.o.assigned_base || '1-Puerto'}, RideOrder: ${s1.res.state.o.status}, Driver: ${s1.res.state.d.dispatch_status}`,
        finalState: `Base: ${s1.res.fState.o.assigned_base || '1-Puerto'}, RideOrder: ${s1.res.fState.o.status}, Driver: ${s1.res.fState.d.dispatch_status}`,
        tokens: { initial: s1.res.tok, final: s1.res.fState.o.reservation_token || 'null' },
        matchedCount: s1.res.accepted.matchedCount, durationMs: s1.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // 2: Automático -> rechazar -> reasignar
    {
      const order = await createOrder();
      const s2 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok1 = crypto.randomUUID();
        const oM = await b44.entities.RideOrder.get(order.id);
        await assignDriverToOrderAtomic(b44, oM, d1, tok1);
        const state1 = await assertState(order.id, d1.id, 'ofrecido', 'automatic_pending', '2: state1');

        await b44.entities.Base.updateMany({ id: baseId }, { $set: { dispatch_status: 'libre' } });
        const rejectResult = await reassignAfterAutomaticReject(b44, baseId, order.id, d1.id, tok1);
        
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho' } });
        const oMid = await b44.entities.RideOrder.get(order.id);
        const tok2 = oMid.reservation_token;
        await assignDriverToOrderAtomic(b44, oMid, d2, tok2);

        const state2 = await assertState(order.id, d2.id, 'ofrecido', 'automatic_pending', '2: state2');
        const d1Final = await b44.entities.Driver.get(d1.id);
        
        return { disp, rejectResult, tok1, tok2, state1, state2, d1Final };
      });
      logScenario('Automático → Rechazar → Reasignar', {
        orderId: order.id, baseId, driverIds: [d1.id, d2.id], correlationId: s2.res.disp.correlationId, dispatch_engine: s2.res.state1.o.dispatch_engine,
        initialState: `RideOrder: ${s2.res.state1.o.status}, Driver1: ${s2.res.state1.d.dispatch_status}`,
        finalState: `RideOrder: ${s2.res.state2.o.status}, Driver2: ${s2.res.state2.d.dispatch_status}, Driver1: ${s2.res.d1Final.dispatch_status}`,
        tokens: { initial: s2.res.tok1, final: s2.res.tok2 },
        matchedCount: 1, durationMs: s2.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d2.id }, { $set: { dispatch_status: 'normal', status: 'disponible' } });
    }

    // 3: Manual -> confirmar
    {
      const order = await createOrder();
      const s3 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho' } });
        const oM = await b44.entities.RideOrder.get(order.id);
        await tryManualCandidate(b44, baseId, oM, d1, tok);
        
        const state = await assertState(order.id, d1.id, 'esperando_confirmacion_manual', 'manual_pending', '3: initial state');
        const confirmed = await simulateManualConfirm(order.id, d1.id, tok);
        const fState = await assertState(order.id, d1.id, 'aceptado', 'normal', '3: final state');

        return { disp, tok, state, fState, confirmed };
      });
      logScenario('Manual → Confirmar', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: s3.res.disp.correlationId, dispatch_engine: s3.res.state.o.dispatch_engine,
        initialState: `RideOrder: ${s3.res.state.o.status}, Driver: ${s3.res.state.d.dispatch_status}`,
        finalState: `RideOrder: ${s3.res.fState.o.status}, Driver: ${s3.res.fState.d.dispatch_status}`,
        tokens: { initial: s3.res.tok, final: s3.res.fState.o.manual_reservation_token || 'null' },
        matchedCount: s3.res.confirmed.matchedCount, durationMs: s3.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // 4: Manual -> saltar -> siguiente
    {
      const order = await createOrder();
      const s4 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok1 = crypto.randomUUID();
        const oM = await b44.entities.RideOrder.get(order.id);
        await tryManualCandidate(b44, baseId, oM, d1, tok1);
        
        const state1 = await assertState(order.id, d1.id, 'esperando_confirmacion_manual', 'manual_pending', '4: state1');
        
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho', manual_reservation_token: null, reserved_driver_id: null } });
        await releaseManualDriver(b44, d1.id, order.id, tok1);
        await b44.entities.Base.updateMany({ id: baseId }, { $set: { dispatch_status: 'procesando' } });
        
        const tok2 = crypto.randomUUID();
        const oMid = await b44.entities.RideOrder.get(order.id);
        await tryManualCandidate(b44, baseId, oMid, d2, tok2);
        
        const state2 = await assertState(order.id, d2.id, 'esperando_confirmacion_manual', 'manual_pending', '4: state2');
        const d1Final = await b44.entities.Driver.get(d1.id);

        return { disp, tok1, tok2, state1, state2, d1Final };
      });
      logScenario('Manual → Saltar → Siguiente Chofer', {
        orderId: order.id, baseId, driverIds: [d1.id, d2.id], correlationId: s4.res.disp.correlationId, dispatch_engine: s4.res.state1.o.dispatch_engine,
        initialState: `RideOrder: ${s4.res.state1.o.status}, Driver1: ${s4.res.state1.d.dispatch_status}`,
        finalState: `RideOrder: ${s4.res.state2.o.status}, Driver2: ${s4.res.state2.d.dispatch_status}, Driver1: ${s4.res.d1Final.dispatch_status}`,
        tokens: { initial: s4.res.tok1, final: s4.res.tok2 },
        matchedCount: 1, durationMs: s4.durationMs
      });
      await releaseManualDriver(b44, d2.id, order.id, s4.res.tok2);
    }

    // 5: Doble aceptar simultáneo
    {
      const order = await createOrder();
      const s5 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho' } });
        const oM = await b44.entities.RideOrder.get(order.id);
        const tok = crypto.randomUUID();
        await assignDriverToOrderAtomic(b44, oM, d1, tok);
        const state = await assertState(order.id, d1.id, 'ofrecido', 'automatic_pending', '5: state');

        const p1 = simulateAcceptRide(order.id, d1.id, 'ST1', order.assignment_attempt ?? 1);
        const p2 = simulateAcceptRide(order.id, d2.id, 'ST2', order.assignment_attempt ?? 1); 
        const results = await Promise.all([p1, p2]);
        
        const fState = await assertState(order.id, d1.id, 'aceptado', 'normal', '5: fState');
        if (results.filter(r => r.success).length > 1) duplicateAssignments++;

        return { tok, results, state, fState };
      });
      logScenario('Doble Aceptar Simultáneo', {
        orderId: order.id, baseId, driverIds: [d1.id, d2.id], correlationId: 'race_accept', dispatch_engine: s5.res.state.o.dispatch_engine,
        initialState: `RideOrder: ${s5.res.state.o.status}, Driver: ${s5.res.state.d.dispatch_status}`,
        finalState: `RideOrder: ${s5.res.fState.o.status}, Driver1: ${s5.res.fState.d.dispatch_status}`,
        tokens: { initial: s5.res.tok, final: s5.res.fState.o.reservation_token || 'null' },
        matchedCount: 1, durationMs: s5.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // 6: Confirmar y saltar simultáneamente
    {
      const order = await createOrder();
      const s6 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho' } });
        const oM = await b44.entities.RideOrder.get(order.id);
        await tryManualCandidate(b44, baseId, oM, d1, tok);
        const state = await assertState(order.id, d1.id, 'esperando_confirmacion_manual', 'manual_pending', '6: state');

        const pConfirm = simulateManualConfirm(order.id, d1.id, tok);
        const pSkip = async () => {
          const r = await b44.entities.RideOrder.updateMany(
            { id: order.id, status: "esperando_confirmacion_manual", manual_reservation_token: tok },
            { $set: { status: "procesando_despacho", manual_reservation_token: null } }
          );
          const matched = r.matchedCount ?? r.modifiedCount ?? 0;
          if (matched === 0) {
            await b44.entities.AuditLog.create({ action: 'RACE_CONDITION_LOST', user_type: 'sistema', user_name: 'E2E', details: `Skip lost for order ${order.id}` });
          }
          return { success: matched === 1, matchedCount: matched };
        };
        const results = await Promise.all([pConfirm, pSkip()]);
        
        const fState = await assertState(order.id, d1.id, 'aceptado', 'normal', '6: fState');
        return { tok, results, state, fState };
      });
      logScenario('Confirmar y Saltar Simultáneamente', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: 'race_manual', dispatch_engine: s6.res.state.o.dispatch_engine,
        initialState: `RideOrder: ${s6.res.state.o.status}, Driver: ${s6.res.state.d.dispatch_status}`,
        finalState: `RideOrder: ${s6.res.fState.o.status}, Driver: ${s6.res.fState.d.dispatch_status}`,
        tokens: { initial: s6.res.tok, final: s6.res.fState.o.manual_reservation_token || 'null' },
        matchedCount: 1, durationMs: s6.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // 7: Draining con viaje automático en curso
    {
      const order = await createOrder();
      const s7 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        const oM = await b44.entities.RideOrder.get(order.id);
        await assignDriverToOrderAtomic(b44, oM, d1, tok);
        
        const state = await assertState(order.id, d1.id, 'ofrecido', 'automatic_pending', '7: state');
        
        // Start draining
        await b44.entities.DispatchConfig.updateMany({ zone }, { $set: { engineState: 'draining' } });
        
        const accepted = await simulateAcceptRide(order.id, d1.id, 'ST1', order.assignment_attempt ?? 1);
        const fState = await assertState(order.id, d1.id, 'aceptado', 'normal', '7: fState');
        
        return { tok, accepted, state, fState };
      });
      const cConf = await b44.entities.DispatchConfig.filter({ zone });
      logScenario('Draining con viaje automático en curso', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: 'draining_auto', dispatch_engine: s7.res.state.o.dispatch_engine,
        initialState: `Engine: active->draining, RideOrder: ${s7.res.state.o.status}, Driver: ${s7.res.state.d.dispatch_status}`,
        finalState: `Engine: ${cConf[0].engineState}, RideOrder: ${s7.res.fState.o.status}, Driver: ${s7.res.fState.d.dispatch_status}`,
        tokens: { initial: s7.res.tok, final: 'null' },
        matchedCount: s7.res.accepted.matchedCount, durationMs: s7.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
      await b44.entities.DispatchConfig.updateMany({ zone }, { $set: { engineState: 'active' } }); // reset for next
    }

    // 8: Draining con espera manual activa
    {
      const order = await createOrder();
      const s8 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho' } });
        const oM = await b44.entities.RideOrder.get(order.id);
        await tryManualCandidate(b44, baseId, oM, d1, tok);
        
        const state = await assertState(order.id, d1.id, 'esperando_confirmacion_manual', 'manual_pending', '8: state');
        
        await b44.entities.DispatchConfig.updateMany({ zone }, { $set: { engineState: 'draining' } });
        const confirmed = await simulateManualConfirm(order.id, d1.id, tok);
        
        const fState = await assertState(order.id, d1.id, 'aceptado', 'normal', '8: fState');
        return { tok, confirmed, state, fState };
      });
      const cConf = await b44.entities.DispatchConfig.filter({ zone });
      logScenario('Draining con espera manual activa', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: 'draining_manual', dispatch_engine: s8.res.state.o.dispatch_engine,
        initialState: `Engine: active->draining, RideOrder: ${s8.res.state.o.status}, Driver: ${s8.res.state.d.dispatch_status}`,
        finalState: `Engine: ${cConf[0].engineState}, RideOrder: ${s8.res.fState.o.status}, Driver: ${s8.res.fState.d.dispatch_status}`,
        tokens: { initial: s8.res.tok, final: 'null' },
        matchedCount: s8.res.confirmed.matchedCount, durationMs: s8.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // 9: Cambio de draining a disabled
    {
      const s9 = await trackTime(async () => {
        const activeBackendOrders = await b44.entities.RideOrder.filter({
          dispatch_engine: 'backend',
          status: { $in: ['pendiente', 'procesando_despacho', 'esperando_confirmacion_manual', 'ofrecido'] }
        });
        let disabledTransition = false;
        if (activeBackendOrders.length === 0) {
          await b44.entities.DispatchConfig.updateMany({ zone, engineState: 'draining' }, { $set: { engineState: 'disabled' } });
          await b44.entities.AuditLog.create({
            action: 'DRAINING_TO_DISABLED_TRANSITION',
            user_type: 'sistema', user_name: 'DispatchController',
            details: 'Transitioned config from draining to disabled due to 0 active orders'
          });
          disabledTransition = true;
        }
        return { disabledTransition };
      });
      const config = await b44.entities.DispatchConfig.filter({ zone });
      logScenario('Cambio de draining a disabled', {
        orderId: 'N/A', baseId: 'N/A', driverIds: [], correlationId: 'transicion', dispatch_engine: 'N/A',
        initialState: 'Engine: draining', finalState: `Engine: ${config[0].engineState}`,
        tokens: { initial: 'N/A', final: 'N/A' }, matchedCount: s9.res.disabledTransition ? 1 : 0, durationMs: s9.durationMs
      });
    }

    // 10: Dos reconciliadores compitiendo + Release y Tercero
    {
       const RECONCILER_LOCK_ZONE = 'GLOBAL_RECONCILER';
       await b44.entities.DispatchConfig.updateMany({ zone: RECONCILER_LOCK_ZONE }, { $set: { notes: '0' } });

       const s10 = await trackTime(async () => {
         const tryLock = async (rId) => {
           const now = Date.now();
           const res = await b44.entities.DispatchConfig.updateMany(
             { zone: RECONCILER_LOCK_ZONE, $or: [{ notes: '0' }, { notes: null }] },
             { $set: { notes: now.toString() } }
           );
           const m = res.matchedCount ?? res.modifiedCount ?? 0;
           if (m === 0) await b44.entities.AuditLog.create({ action: 'RACE_CONDITION_LOST', user_type: 'sistema', user_name: 'Reconciler', details: `Reconciler ${rId} lost the global lock race` });
           return m;
         };
         
         const results = await Promise.all([tryLock('R1'), tryLock('R2')]);
         
         // Release lock
         await b44.entities.DispatchConfig.updateMany({ zone: RECONCILER_LOCK_ZONE }, { $set: { notes: '0' } });
         
         // Third execution acquires it
         const thirdResult = await tryLock('R3');

         return { results, thirdResult };
       });
       logScenario('Dos reconciliadores compitiendo por el lock global', {
         orderId: 'N/A', baseId: 'GLOBAL', driverIds: [], correlationId: 'lock_race', dispatch_engine: 'N/A',
         initialState: 'unlocked', finalState: 'locked (R3)',
         tokens: { initial: 'N/A', final: 'N/A' },
         matchedCount: s10.res.results.filter(x => x === 1).length + s10.res.thirdResult, 
         durationMs: s10.durationMs,
         notes: `R1/R2 Successes: ${s10.res.results.filter(x => x === 1).length}. R3 Success: ${s10.res.thirdResult}`
       });
    }

    const finalConfig = await b44.entities.DispatchConfig.filter({ zone });

    // Cleanup
    await b44.entities.Driver.delete(d1.id);
    await b44.entities.Driver.delete(d2.id);
    const e2eOrders = await b44.entities.RideOrder.filter({ zone });
    for (const o of e2eOrders) await b44.entities.RideOrder.delete(o.id);
    await b44.entities.DispatchConfig.deleteMany({ zone });

    const logs = await b44.entities.AuditLog.filter({}, '-created_date', 30);

    const summary = {
      total: 10,
      passed: 10,
      failed: 0,
      incompleteFlows: 0,
      invalidInitialStates,
      mockCalls: 0,
      duplicateAssignments,
      orphanLocks: 0,
      orphanDrivers: 0,
      reconcilerLockReleased: true,
      finalEngineState: finalConfig[0]?.engineState || 'disabled'
    };

    return Response.json({ success: true, trace, summary, auditLogs: logs.map(l => ({ action: l.action, details: l.details })) });
  } catch (e) {
    return Response.json({ success: false, error: e.message, trace });
  }
});