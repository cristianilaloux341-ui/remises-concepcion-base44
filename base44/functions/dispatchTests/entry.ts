import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * dispatchTests/entry.ts
 * Suite de Pruebas de Concurrencia y Resiliencia para el Despacho Atómico.
 * Aislada completamente de datos de producción.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const results = [];
  let passed = 0;
  let failed = 0;

  // Garantizar Feature Flag apagado (para evitar afectar producción)
  const configs = await b44.entities.DispatchConfig.list();
  const enabledZones = configs.filter(c => c.backendDispatchEnabled);
  if (enabledZones.length > 0) {
    return Response.json({ error: "Feature Flag activado. Abortando suite para proteger la DB." });
  }

  // Helpers
  const getCount = (r) => r && typeof r === 'object' ? (r.matchedCount ?? r.updated ?? r.modifiedCount ?? 0) : 0;
  
  function createBarrier(count) {
    let current = 0;
    let resolveAll;
    const promise = new Promise(resolve => { resolveAll = resolve; });
    return {
      wait: () => {
        current++;
        if (current === count) resolveAll();
        return promise;
      }
    };
  }

  async function runTest(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, status: 'passed', durationMs: Date.now() - start });
      passed++;
    } catch (err) {
      results.push({ name, status: 'failed', durationMs: Date.now() - start, details: err.message || err });
      failed++;
    }
  }

  // --- SUITE PRIORIDAD 1: CONCURRENCIA ---

  await runTest("Dos procesos compiten por el mismo lock de Base", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "libre" });
    const barrier = createBarrier(2);
    try {
      const p1 = barrier.wait().then(() => b44.entities.Base.updateMany({ id: base.id, dispatch_status: "libre" }, { $set: { dispatch_status: "procesando", lock_token: "T1" } }));
      const p2 = barrier.wait().then(() => b44.entities.Base.updateMany({ id: base.id, dispatch_status: "libre" }, { $set: { dispatch_status: "procesando", lock_token: "T2" } }));
      
      const [r1, r2] = await Promise.allSettled([p1, p2]);
      const c1 = getCount(r1.value);
      const c2 = getCount(r2.value);
      
      if (c1 + c2 !== 1) throw new Error(`Atomicidad violada: Se esperaban 1 lock, se obtuvieron ${c1 + c2}`);
      const finalBase = await b44.entities.Base.get(base.id);
      if (!["T1", "T2"].includes(finalBase.lock_token)) throw new Error("El lock_token guardado no coincide con ningún proceso");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("Dos procesos compiten por el mismo RideOrder", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "Test", pickup_address: "T2", status: "pendiente" });
    const barrier = createBarrier(2);
    try {
      const p1 = barrier.wait().then(() => b44.entities.RideOrder.updateMany({ id: order.id, status: "pendiente" }, { $set: { status: "procesando_despacho", reservation_token: "RT1" } }));
      const p2 = barrier.wait().then(() => b44.entities.RideOrder.updateMany({ id: order.id, status: "pendiente" }, { $set: { status: "procesando_despacho", reservation_token: "RT2" } }));
      
      const [r1, r2] = await Promise.allSettled([p1, p2]);
      if (getCount(r1.value) + getCount(r2.value) !== 1) throw new Error("Violación de atomicidad en RideOrder: ambos procesos o ninguno tomaron la orden");
    } finally {
      await b44.entities.RideOrder.delete(order.id);
    }
  });

  await runTest("Dos RideOrder compiten por el mismo Driver", async () => {
    const driver = await b44.entities.Driver.create({ name: "D3", phone: "333", vehicle_plate: "P3", status: "disponible", dispatch_status: "normal" });
    const barrier = createBarrier(2);
    try {
      const p1 = barrier.wait().then(() => b44.entities.Driver.updateMany({ id: driver.id, dispatch_status: "normal" }, { $set: { dispatch_status: "automatic_pending", reserved_order_id: "O1", reservation_token: "T1" } }));
      const p2 = barrier.wait().then(() => b44.entities.Driver.updateMany({ id: driver.id, dispatch_status: "normal" }, { $set: { dispatch_status: "automatic_pending", reserved_order_id: "O2", reservation_token: "T2" } }));
      
      const [r1, r2] = await Promise.allSettled([p1, p2]);
      if (getCount(r1.value) + getCount(r2.value) !== 1) throw new Error("Violación de atomicidad en Driver: ambos viajes o ninguno reservaron al chofer");
    } finally {
      await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("Dos zonas diferentes despachan simultáneamente", async () => {
    const b1 = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "libre" });
    const b2 = await b44.entities.Base.create({ name: "2-Plaza", dispatch_status: "libre" });
    const barrier = createBarrier(2);
    try {
      const p1 = barrier.wait().then(() => b44.entities.Base.updateMany({ id: b1.id, dispatch_status: "libre" }, { $set: { dispatch_status: "procesando", lock_token: "Z1" } }));
      const p2 = barrier.wait().then(() => b44.entities.Base.updateMany({ id: b2.id, dispatch_status: "libre" }, { $set: { dispatch_status: "procesando", lock_token: "Z2" } }));
      
      const [r1, r2] = await Promise.allSettled([p1, p2]);
      if (getCount(r1.value) !== 1 || getCount(r2.value) !== 1) throw new Error("Bloqueo cruzado entre zonas: no pudieron operar en paralelo");
    } finally {
      await b44.entities.Base.delete(b1.id);
      await b44.entities.Base.delete(b2.id);
    }
  });

  await runTest("Doble Confirmar manual", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "T5", pickup_address: "T5", status: "esperando_confirmacion_manual", manual_reservation_token: "TM5" });
    const barrier = createBarrier(2);
    try {
      const p1 = barrier.wait().then(() => b44.entities.RideOrder.updateMany({ id: order.id, status: "esperando_confirmacion_manual", manual_reservation_token: "TM5" }, { $set: { status: "aceptado", manual_reservation_token: null } }));
      const p2 = barrier.wait().then(() => b44.entities.RideOrder.updateMany({ id: order.id, status: "esperando_confirmacion_manual", manual_reservation_token: "TM5" }, { $set: { status: "aceptado", manual_reservation_token: null } }));
      
      const [r1, r2] = await Promise.allSettled([p1, p2]);
      if (getCount(r1.value) + getCount(r2.value) !== 1) throw new Error("La doble confirmación procesó el viaje dos veces");
    } finally {
      await b44.entities.RideOrder.delete(order.id);
    }
  });

  await runTest("Doble Saltar manual", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "esperando_manual", manual_reservation_token: "TM6" });
    const barrier = createBarrier(2);
    try {
      const p1 = barrier.wait().then(() => b44.entities.Base.updateMany({ id: base.id, dispatch_status: "esperando_manual", manual_reservation_token: "TM6" }, { $set: { dispatch_status: "procesando", manual_reservation_token: null, lock_token: "NEW_T1" } }));
      const p2 = barrier.wait().then(() => b44.entities.Base.updateMany({ id: base.id, dispatch_status: "esperando_manual", manual_reservation_token: "TM6" }, { $set: { dispatch_status: "procesando", manual_reservation_token: null, lock_token: "NEW_T2" } }));
      
      const [r1, r2] = await Promise.allSettled([p1, p2]);
      if (getCount(r1.value) + getCount(r2.value) !== 1) throw new Error("El doble salto permitió emitir múltiples tokens (condición de carrera)");
      
      const finalBase = await b44.entities.Base.get(base.id);
      if (!finalBase.lock_token || finalBase.manual_reservation_token) throw new Error("Estado final de Base inconsistente post-salto");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("Confirmar y Saltar simultáneamente", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "esperando_manual", manual_reservation_token: "TM7" });
    const barrier = createBarrier(2);
    try {
      // Confirm intentará liberar la base. Skip intentará procesar la base emitiendo un newToken.
      const pConfirm = barrier.wait().then(() => b44.entities.Base.updateMany({ id: base.id, dispatch_status: "esperando_manual", manual_reservation_token: "TM7" }, { $set: { dispatch_status: "libre", manual_reservation_token: null } }));
      const pSkip = barrier.wait().then(() => b44.entities.Base.updateMany({ id: base.id, dispatch_status: "esperando_manual", manual_reservation_token: "TM7" }, { $set: { dispatch_status: "procesando", manual_reservation_token: null, lock_token: "SKIP_T" } }));
      
      const [r1, r2] = await Promise.allSettled([pConfirm, pSkip]);
      if (getCount(r1.value) + getCount(r2.value) !== 1) throw new Error("Confirmar y Saltar ganaron ambos la actualización de la Base");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

    // --- SUITE PRIORIDAD 2: FALLOS ENTRE OPERACIONES (Inyección Determinista) ---

  const createInjector = (targetPoint) => ({
    hit: async (point) => {
      if (point === targetPoint) throw new Error(`INJECTED_FAILURE_AT_${point}`);
    }
  });

  const { tryManualCandidate, assignDriverToOrderAtomic, reassignAfterAutomaticReject, safeAuditLog } = await import('../../shared/DispatchLogic.ts');

  await runTest("Falla después de reservar Driver manual", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "T1" });
    const order = await b44.entities.RideOrder.create({ client_name: "O1", pickup_address: "O1", status: "procesando_despacho", reservation_token: "T1" });
    const driver = await b44.entities.Driver.create({ name: "D1", phone: "1", vehicle_plate: "1", status: "disponible", dispatch_status: "normal" });
    
    try {
      await tryManualCandidate(b44, base.id, order, driver, "T1", createInjector('AFTER_DRIVER_RESERVE'));
    } catch (e) {
      if (!e.message.includes('AFTER_DRIVER_RESERVE')) throw e;
    }
    
    const dCheck = await b44.entities.Driver.get(driver.id);
    if (dCheck.dispatch_status !== "normal" || dCheck.reserved_order_id !== null) throw new Error("El Driver no fue liberado correctamente");
    
    const oCheck = await b44.entities.RideOrder.get(order.id);
    if (oCheck.status !== "procesando_despacho") throw new Error("El RideOrder no conservó su estado de procesamiento");
    
    await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla después de pasar RideOrder a espera manual, antes de actualizar Base", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "T2" });
    const order = await b44.entities.RideOrder.create({ client_name: "O2", pickup_address: "O2", status: "procesando_despacho", reservation_token: "T2" });
    const driver = await b44.entities.Driver.create({ name: "D2", phone: "2", vehicle_plate: "2", status: "disponible", dispatch_status: "normal" });
    
    try {
      await tryManualCandidate(b44, base.id, order, driver, "T2", createInjector('AFTER_RIDE_MANUAL_TRANSITION'));
    } catch (e) {
      if (!e.message.includes('AFTER_RIDE_MANUAL_TRANSITION')) throw e;
    }
    
    const oCheck = await b44.entities.RideOrder.get(order.id);
    if (oCheck.status !== "procesando_despacho" || oCheck.reserved_driver_id !== null) throw new Error("El RideOrder no hizo rollback a procesando_despacho");
    
    const dCheck = await b44.entities.Driver.get(driver.id);
    if (dCheck.dispatch_status !== "normal") throw new Error("El Driver no se liberó");

    await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla después de transferir Base a esperando_manual", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "T3" });
    const order = await b44.entities.RideOrder.create({ client_name: "O3", pickup_address: "O3", status: "procesando_despacho", reservation_token: "T3" });
    const driver = await b44.entities.Driver.create({ name: "D3", phone: "3", vehicle_plate: "3", status: "disponible", dispatch_status: "normal" });
    
    try {
      await tryManualCandidate(b44, base.id, order, driver, "T3", createInjector('AFTER_BASE_MANUAL_TRANSFER'));
    } catch (e) {
      if (!e.message.includes('AFTER_BASE_MANUAL_TRANSFER')) throw e;
    }
    
    const bCheck = await b44.entities.Base.get(base.id);
    const oCheck = await b44.entities.RideOrder.get(order.id);
    const dCheck = await b44.entities.Driver.get(driver.id);
    
    if (bCheck.dispatch_status !== "esperando_manual" || oCheck.status !== "esperando_confirmacion_manual" || dCheck.dispatch_status !== "manual_pending") {
      throw new Error("El estado no se conservó como transferencia válida pese al error post-commit");
    }
    
    await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla después de reservar Driver automático", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "O4", pickup_address: "O4", status: "procesando_despacho", reservation_token: "T4" });
    const driver = await b44.entities.Driver.create({ name: "D4", phone: "4", vehicle_plate: "4", status: "disponible", dispatch_status: "normal" });
    
    try {
      await assignDriverToOrderAtomic(b44, order, driver, "T4", createInjector('AFTER_AUTO_DRIVER_RESERVE'));
    } catch (e) {}
    
    const dCheck = await b44.entities.Driver.get(driver.id);
    if (dCheck.dispatch_status !== "normal") throw new Error("El Driver no se liberó tras fallo automático");
    const oCheck = await b44.entities.RideOrder.get(order.id);
    if (oCheck.status === "ofrecido") throw new Error("El RideOrder quedó en ofrecido pero el driver se liberó");
    
    await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla después de pasar RideOrder a ofrecido, antes del push", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "O5", pickup_address: "O5", status: "procesando_despacho", reservation_token: "T5" });
    const driver = await b44.entities.Driver.create({ name: "D5", phone: "5", vehicle_plate: "5", status: "disponible", dispatch_status: "normal" });
    
    try {
      await assignDriverToOrderAtomic(b44, order, driver, "T5", createInjector('AFTER_RIDE_OFFER'));
    } catch (e) {}
    
    const dCheck = await b44.entities.Driver.get(driver.id);
    const oCheck = await b44.entities.RideOrder.get(order.id);
    
    if (oCheck.status !== "procesando_despacho") throw new Error("El RideOrder no volvió a procesando_despacho");
    if (dCheck.dispatch_status !== "normal") throw new Error("El Driver no volvió a normal tras fallo previo a push");
    
    await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla del push", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "O6", pickup_address: "O6", status: "procesando_despacho", reservation_token: "T6" });
    const driver = await b44.entities.Driver.create({ name: "D6", phone: "6", vehicle_plate: "6", status: "disponible", dispatch_status: "normal" });
    
    try {
      await assignDriverToOrderAtomic(b44, order, driver, "T6", createInjector('BEFORE_PUSH'));
    } catch (e) {}
    
    const oCheck = await b44.entities.RideOrder.get(order.id);
    if (oCheck.status !== "procesando_despacho") throw new Error("No revirtió el viaje tras DELIVERY_ERROR simulado");
    
    await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla al liberar Driver durante rechazo automático", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "libre" });
    const order = await b44.entities.RideOrder.create({ client_name: "O7", pickup_address: "O7", status: "ofrecido", reservation_token: "T7", reserved_driver_id: "D7" });
    const driver = await b44.entities.Driver.create({ name: "D7", phone: "7", vehicle_plate: "7", status: "disponible", dispatch_status: "automatic_pending", reserved_order_id: order.id, reservation_token: "T7" });
    
    try {
      await reassignAfterAutomaticReject(b44, base.id, order.id, driver.id, "T7", createInjector('DURING_DRIVER_RELEASE'));
    } catch (e) {
      if (!e.message.includes('DRIVER_RELEASE_FAILED')) throw e;
    }
    
    const bCheck = await b44.entities.Base.get(base.id);
    if (bCheck.dispatch_status !== "libre") throw new Error("La Base no se liberó en el finally tras el INCONSISTENT_STATE");
    
    await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla al transferir RideOrder de oldToken a newToken", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "libre" });
    const order = await b44.entities.RideOrder.create({ client_name: "O8", pickup_address: "O8", status: "ofrecido", reservation_token: "T8", reserved_driver_id: "D8" });
    const driver = await b44.entities.Driver.create({ name: "D8", phone: "8", vehicle_plate: "8", status: "disponible", dispatch_status: "automatic_pending", reserved_order_id: order.id, reservation_token: "T8" });
    
    try {
      await reassignAfterAutomaticReject(b44, base.id, order.id, driver.id, "T8", createInjector('DURING_TOKEN_TRANSFER'));
    } catch (e) {}
    
    const bCheck = await b44.entities.Base.get(base.id);
    if (bCheck.dispatch_status !== "libre") throw new Error("La Base no se liberó tras fallar la transferencia de token");
    const dCheck = await b44.entities.Driver.get(driver.id);
    if (dCheck.dispatch_status !== "automatic_pending") throw new Error("El Driver se liberó indebidamente antes de transferir el token del viaje");
    
    await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
  });

  await runTest("Falla en AuditLog.create", async () => {
    let failedLog = false;
    try {
      await safeAuditLog(b44, { action: "TEST", user_name: "System" }, createInjector('DURING_AUDIT_LOG'));
    } catch (e) {
      failedLog = true; // shouldn't happen, safeAuditLog catches it
    }
    if (failedLog) throw new Error("La falla en AuditLog rompió el hilo de ejecución en vez de actuar de fallback");
  });

  return Response.json({
    passed,
    failed,
    results
  });
});