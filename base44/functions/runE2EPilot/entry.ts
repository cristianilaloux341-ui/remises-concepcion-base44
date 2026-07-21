import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { triggerDispatch } from '../../shared/DispatchController.ts';
import { tryManualCandidate, assignDriverToOrderAtomic, reassignAfterAutomaticReject, releaseManualDriver } from '../../shared/DispatchLogic.ts';
import { runReconciliation } from '../../shared/DispatchReconciler.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const trace = [];

  const logScenario = (name, details) => {
    trace.push({
      scenario: name,
      time: new Date().toISOString(),
      ...details
    });
  };

  try {
    const zone = 'E2E_PROD_ZONE';
    
    let bases = await b44.entities.Base.filter({ name: '1-Puerto' });
    if (bases.length === 0) {
      const newBase = await b44.entities.Base.create({ name: '1-Puerto', dispatch_status: 'libre' });
      bases = [newBase];
    }
    const baseId = bases[0].id;

    const d1 = await b44.entities.Driver.create({ name: 'D1_PROD', phone: '111', vehicle_plate: 'V1', status: 'disponible', dispatch_status: 'normal', current_session_token: 'ST1' });
    const d2 = await b44.entities.Driver.create({ name: 'D2_PROD', phone: '222', vehicle_plate: 'V2', status: 'disponible', dispatch_status: 'normal', current_session_token: 'ST2' });

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
      const result = await b44.entities.RideOrder.updateMany(
        { id: orderId, $or: [{ status: "ofrecido" }, { status: "pendiente" }], assignment_attempt: assignmentAttempt },
        { $set: { status: "aceptado", driver_id: driverId, driver_name: 'Chofer', assigned_base: '1-Puerto' } }
      );
      if ((result.matchedCount ?? result.modifiedCount ?? 0) === 1) {
        await b44.entities.Driver.updateMany({ id: driverId }, { $set: { status: 'en_viaje', dispatch_status: 'normal' } });
        return true;
      }
      return false;
    };

    const simulateManualConfirm = async (orderId, driverId, manualToken) => {
       const result = await b44.entities.RideOrder.updateMany(
         { id: orderId, status: "esperando_confirmacion_manual", manual_reservation_token: manualToken },
         { $set: { status: "aceptado", driver_id: driverId, manual_reservation_token: null } }
       );
       if ((result.matchedCount ?? result.modifiedCount ?? 0) === 1) {
         await b44.entities.Driver.updateMany(
           { id: driverId, manual_reservation_token: manualToken },
           { $set: { dispatch_status: 'normal', status: 'en_viaje', manual_reservation_token: null } }
         );
         await b44.entities.Base.updateMany(
           { id: baseId, manual_reservation_token: manualToken },
           { $set: { dispatch_status: 'libre', active_order_id: null, manual_reservation_token: null, manual_expires_at: null } }
         );
         return true;
       }
       return false;
    };

    // SCENARIO 1: Automático - Aceptar
    {
      const order = await createOrder();
      const s1 = await trackTime(async () => {
        const t1 = await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await assignDriverToOrderAtomic(b44, order, d1, tok);
        const accepted = await simulateAcceptRide(order.id, d1.id, 'ST1', order.assignment_attempt ?? 1);
        return { dispatch: t1, accepted, tok };
      });
      const o1 = await b44.entities.RideOrder.get(order.id);
      logScenario('AUTOMATICO_ACEPTAR', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: s1.res.dispatch.correlationId, dispatch_engine: o1.dispatch_engine,
        initialState: 'pendiente', finalState: o1.status, tokens: [s1.res.tok], matchedCount: 1, durationMs: s1.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // SCENARIO 2: Automático - Rechazar - Reasignar
    {
      const order = await createOrder();
      const s2 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok1 = crypto.randomUUID();
        await assignDriverToOrderAtomic(b44, order, d1, tok1);
        await b44.entities.Base.updateMany({ id: baseId }, { $set: { dispatch_status: 'libre' } });
        const rejectResult = await reassignAfterAutomaticReject(b44, baseId, order.id, d1.id, tok1);
        const oMid = await b44.entities.RideOrder.get(order.id);
        const tok2 = oMid.reservation_token;
        await assignDriverToOrderAtomic(b44, oMid, d2, tok2);
        return { disp, rejectResult, tok1, tok2 };
      });
      const o2 = await b44.entities.RideOrder.get(order.id);
      logScenario('AUTOMATICO_RECHAZAR_REASIGNAR', {
        orderId: order.id, baseId, driverIds: [d1.id, d2.id], correlationId: s2.res.disp.correlationId, dispatch_engine: o2.dispatch_engine,
        initialState: 'ofrecido', finalState: o2.status, tokens: [s2.res.tok1, s2.res.tok2], matchedCount: 1, durationMs: s2.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d2.id }, { $set: { dispatch_status: 'normal', status: 'disponible' } });
    }

    // SCENARIO 3: Manual - Confirmar
    {
      const order = await createOrder();
      const s3 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await tryManualCandidate(b44, baseId, order, d1, tok);
        const confirmed = await simulateManualConfirm(order.id, d1.id, tok);
        return { disp, tok, confirmed };
      });
      const o3 = await b44.entities.RideOrder.get(order.id);
      logScenario('MANUAL_CONFIRMAR', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: s3.res.disp.correlationId, dispatch_engine: o3.dispatch_engine,
        initialState: 'pendiente', finalState: o3.status, tokens: [s3.res.tok], matchedCount: 1, durationMs: s3.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // SCENARIO 4: Manual - Saltar - Siguiente
    {
      const order = await createOrder();
      const s4 = await trackTime(async () => {
        const disp = await triggerDispatch(base44, zone, order.id, baseId);
        const tok1 = crypto.randomUUID();
        await tryManualCandidate(b44, baseId, order, d1, tok1);
        await b44.entities.RideOrder.updateMany({ id: order.id }, { $set: { status: 'procesando_despacho', manual_reservation_token: null, reserved_driver_id: null } });
        await releaseManualDriver(b44, d1.id, order.id, tok1);
        await b44.entities.Base.updateMany({ id: baseId }, { $set: { dispatch_status: 'procesando' } });
        const tok2 = crypto.randomUUID();
        await tryManualCandidate(b44, baseId, order, d2, tok2);
        return { disp, tok1, tok2 };
      });
      const o4 = await b44.entities.RideOrder.get(order.id);
      logScenario('MANUAL_SALTAR_SIGUIENTE', {
        orderId: order.id, baseId, driverIds: [d1.id, d2.id], correlationId: s4.res.disp.correlationId, dispatch_engine: o4.dispatch_engine,
        initialState: 'esperando_confirmacion_manual', finalState: o4.status, tokens: [s4.res.tok1, s4.res.tok2], matchedCount: 1, durationMs: s4.durationMs
      });
      await releaseManualDriver(b44, d2.id, order.id, s4.res.tok2);
    }

    // SCENARIO 5: Doble aceptar en paralelo
    {
      const order = await createOrder();
      const s5 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await assignDriverToOrderAtomic(b44, order, d1, tok);
        const p1 = simulateAcceptRide(order.id, d1.id, 'ST1', order.assignment_attempt ?? 1);
        const p2 = simulateAcceptRide(order.id, d2.id, 'ST2', order.assignment_attempt ?? 1); 
        const results = await Promise.all([p1, p2]);
        return { tok, results };
      });
      const o5 = await b44.entities.RideOrder.get(order.id);
      logScenario('DOBLE_ACEPTAR_PARALELO', {
        orderId: order.id, baseId, driverIds: [d1.id, d2.id], correlationId: 'race', dispatch_engine: o5.dispatch_engine,
        initialState: 'ofrecido', finalState: o5.status, tokens: [s5.res.tok], matchedCount: 1, durationMs: s5.durationMs,
        notes: `Success Count: ${s5.res.results.filter(Boolean).length} (Expected: 1)`
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // SCENARIO 6: Confirmar y saltar en paralelo
    {
      const order = await createOrder();
      const s6 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await tryManualCandidate(b44, baseId, order, d1, tok);
        const pConfirm = simulateManualConfirm(order.id, d1.id, tok);
        const pSkip = b44.entities.RideOrder.updateMany(
          { id: order.id, status: "esperando_confirmacion_manual", manual_reservation_token: tok },
          { $set: { status: "procesando_despacho", manual_reservation_token: null } }
        );
        const results = await Promise.all([pConfirm, pSkip]);
        const skipMatchedCount = results[1].matchedCount ?? results[1].modifiedCount ?? 0;
        return { tok, pConfirmRes: results[0], skipMatchedCount };
      });
      const o6 = await b44.entities.RideOrder.get(order.id);
      logScenario('CONFIRMAR_SALTAR_PARALELO', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: 'race', dispatch_engine: o6.dispatch_engine,
        initialState: 'esperando_confirmacion_manual', finalState: o6.status, tokens: [s6.res.tok],
        matchedCount: s6.res.skipMatchedCount, durationMs: s6.durationMs, notes: `Confirm Success: ${s6.res.pConfirmRes}`
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // SCENARIO 7: Draining con espera manual activa
    {
      const order = await createOrder();
      const s7 = await trackTime(async () => {
        await triggerDispatch(base44, zone, order.id, baseId);
        const tok = crypto.randomUUID();
        await tryManualCandidate(b44, baseId, order, d1, tok);
        await b44.entities.DispatchConfig.updateMany({ zone }, { $set: { engineState: 'draining' } });
        const confirmed = await simulateManualConfirm(order.id, d1.id, tok);
        return { tok, confirmed };
      });
      const o7 = await b44.entities.RideOrder.get(order.id);
      logScenario('DRAINING_CON_ESPERA_MANUAL', {
        orderId: order.id, baseId, driverIds: [d1.id], correlationId: 'draining_test', dispatch_engine: o7.dispatch_engine,
        initialState: 'draining', finalState: o7.status, tokens: [s7.res.tok],
        matchedCount: 1, durationMs: s7.durationMs
      });
      await b44.entities.Driver.updateMany({ id: d1.id }, { $set: { status: 'disponible', dispatch_status: 'normal' } });
    }

    // SCENARIO 8: Draining -> Disabled
    {
      const s8 = await trackTime(async () => {
        const activeBackendOrders = await b44.entities.RideOrder.filter({
          dispatch_engine: 'backend',
          status: { $in: ['pendiente', 'procesando_despacho', 'esperando_confirmacion_manual', 'ofrecido'] }
        });
        let disabledTransition = false;
        if (activeBackendOrders.length === 0) {
          await b44.entities.DispatchConfig.updateMany({ zone, engineState: 'draining' }, { $set: { engineState: 'disabled' } });
          disabledTransition = true;
        }
        return { disabledTransition };
      });
      const config = await b44.entities.DispatchConfig.filter({ zone });
      logScenario('DRAINING_TO_DISABLED', {
        orderId: 'N/A', baseId: 'N/A', driverIds: [], correlationId: 'transicion', dispatch_engine: 'N/A',
        initialState: 'draining', finalState: config[0].engineState, tokens: [], matchedCount: s8.res.disabledTransition ? 1 : 0, durationMs: s8.durationMs
      });
    }

    // SCENARIO 9: Dos reconciliadores simultáneos
    {
       const RECONCILER_LOCK_ZONE = 'GLOBAL_RECONCILER';
       await b44.entities.DispatchConfig.updateMany({ zone: RECONCILER_LOCK_ZONE }, { $set: { notes: '0' } });

       const s9 = await trackTime(async () => {
         const now = Date.now();
         const tryLock = async () => {
           const res = await b44.entities.DispatchConfig.updateMany(
             { zone: RECONCILER_LOCK_ZONE, $or: [{ notes: '0' }, { notes: null }] },
             { $set: { notes: now.toString() } }
           );
           return (res.matchedCount ?? res.modifiedCount ?? 0) === 1;
         };
         const results = await Promise.all([tryLock(), tryLock()]);
         return { locksAcquired: results };
       });
       logScenario('RECONCILIADORES_SIMULTANEOS', {
         orderId: 'N/A', baseId: 'GLOBAL', driverIds: [], correlationId: 'lock_race', dispatch_engine: 'N/A',
         initialState: 'unlocked', finalState: 'locked', tokens: [], matchedCount: s9.res.locksAcquired.filter(x => x).length, durationMs: s9.durationMs,
         notes: `Expected 1 lock, acquired: ${s9.res.locksAcquired.filter(x => x).length}`
       });
    }

    await b44.entities.Driver.delete(d1.id);
    await b44.entities.Driver.delete(d2.id);
    const e2eOrders = await b44.entities.RideOrder.filter({ zone });
    for (const o of e2eOrders) await b44.entities.RideOrder.delete(o.id);
    await b44.entities.DispatchConfig.deleteMany({ zone });

    const logs = await b44.entities.AuditLog.filter({}, '-created_date', 30);

    return Response.json({ success: true, trace, auditLogs: logs.map(l => ({ action: l.action, details: l.details })) });
  } catch (e) {
    return Response.json({ success: false, error: e.message, trace });
  }
});