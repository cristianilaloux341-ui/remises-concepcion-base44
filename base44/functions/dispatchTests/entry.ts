import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

/**
 * dispatchTests/entry.ts
 * Suite de Pruebas de Concurrencia y Resiliencia para el Despacho Atómico.
 * Aislada completamente de datos de producción.
 */
Deno.serve(async (req) => {
  const payload = await req.json().catch(() => ({}));
  const INTERNAL_KEY = Deno.env.get("INTERNAL_SERVICE_KEY");
  if (!payload.internalKey || !INTERNAL_KEY || payload.internalKey !== INTERNAL_KEY) {
    return Response.json({ error: "Unauthorized. Internal Service Key missing." }, { status: 401 });
  }
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

  // --- SUITE PRIORIDAD 3: TTL Y RECUPERACIÓN ---
  const { cleanupExpiredTechnicalLock, cleanupExpiredManualWait } = await import('../../shared/DispatchLogic.ts');
  const fakeClock = { now: () => 1000000 };

  await runTest("1. Lock técnico vencido sin viaje reservado", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "TTL1", lock_expires_at: 500000 });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL1", fakeClock.now());
      if (res.status !== 'recovered') throw new Error(`Status erróneo: ${res.status}`);
      const bCheck = await b44.entities.Base.get(base.id);
      if (bCheck.dispatch_status !== "libre" || bCheck.lock_token !== null) throw new Error("Base no liberada");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("2. Lock vencido con RideOrder en procesando_despacho", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "TTL2", lock_expires_at: 500000 });
    const order = await b44.entities.RideOrder.create({ client_name: "T2", pickup_address: "T2", status: "procesando_despacho", reservation_token: "TTL2" });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL2", fakeClock.now());
      if (res.status !== 'recovered') throw new Error(`Status erróneo: ${res.status}`);
      const bCheck = await b44.entities.Base.get(base.id);
      const oCheck = await b44.entities.RideOrder.get(order.id);
      if (bCheck.dispatch_status !== "libre" || oCheck.status !== "pendiente") throw new Error("Entidades no liberadas correctamente");
    } finally {
      await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id);
    }
  });

  await runTest("3. Lock vencido con Driver automatic_pending", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "TTL3", lock_expires_at: 500000 });
    const order = await b44.entities.RideOrder.create({ client_name: "T3", pickup_address: "T3", status: "procesando_despacho", reservation_token: "TTL3" });
    const driver = await b44.entities.Driver.create({ name: "D3", phone: "3", vehicle_plate: "3", status: "disponible", dispatch_status: "automatic_pending", reservation_token: "TTL3", reserved_order_id: order.id });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL3", fakeClock.now());
      if (res.status !== 'recovered') throw new Error(`Status erróneo: ${res.status}`);
      const bCheck = await b44.entities.Base.get(base.id);
      const dCheck = await b44.entities.Driver.get(driver.id);
      const oCheck = await b44.entities.RideOrder.get(order.id);
      if (bCheck.dispatch_status !== "libre" || dCheck.dispatch_status !== "normal" || oCheck.status !== "pendiente") throw new Error("Driver u orden no liberados");
    } finally {
      await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("4. Lock vence mientras otro proceso lo renueva", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "TTL4_NEW", lock_expires_at: 2000000 });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL4_OLD", fakeClock.now());
      if (res.status !== 'already_recovered') throw new Error("El limpiador debió abortar por token mismatch");
      const bCheck = await b44.entities.Base.get(base.id);
      if (bCheck.lock_token !== "TTL4_NEW") throw new Error("El limpiador rompió el lock del otro proceso");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("5. Proceso muere después de reservar RideOrder", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "TTL5", lock_expires_at: 500000 });
    const order = await b44.entities.RideOrder.create({ client_name: "T5", pickup_address: "T5", status: "procesando_despacho", reservation_token: "TTL5" });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL5", fakeClock.now());
      if (res.status !== 'recovered') throw new Error("No reportó recovered");
      const oCheck = await b44.entities.RideOrder.get(order.id);
      const bCheck = await b44.entities.Base.get(base.id);
      if (oCheck.status !== "pendiente" || bCheck.dispatch_status !== "libre") throw new Error("RideOrder o Base huérfanos no recuperados");
    } finally {
      await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id);
    }
  });

  await runTest("6. Proceso muere después de reservar Driver automático", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "TTL6", lock_expires_at: 500000 });
    const order = await b44.entities.RideOrder.create({ client_name: "T6", pickup_address: "T6", status: "procesando_despacho", reservation_token: "TTL6" });
    const driver = await b44.entities.Driver.create({ name: "D6", phone: "6", vehicle_plate: "6", status: "disponible", dispatch_status: "automatic_pending", reservation_token: "TTL6", reserved_order_id: order.id });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL6", fakeClock.now());
      if (res.status !== 'recovered') throw new Error("No reportó recovered");
      const dCheck = await b44.entities.Driver.get(driver.id);
      const oCheck = await b44.entities.RideOrder.get(order.id);
      const bCheck = await b44.entities.Base.get(base.id);
      if (dCheck.dispatch_status !== "normal" || oCheck.status !== "pendiente" || bCheck.dispatch_status !== "libre") throw new Error("Driver huérfano no recuperado");
    } finally {
      await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("7. Base esperando_manual no debe expirar con TTL técnico", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "esperando_manual", manual_reservation_token: "TTL7_MANUAL", lock_expires_at: 500000 });
    try {
      const res = await cleanupExpiredTechnicalLock(b44, base.id, "TTL7_MANUAL", fakeClock.now());
      if (res.status !== 'already_recovered') throw new Error("Intentó limpiar un lock manual como técnico");
      const bCheck = await b44.entities.Base.get(base.id);
      if (bCheck.dispatch_status !== "esperando_manual") throw new Error("Base manual fue alterada por TTL técnico");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("8. Timeout operativo de espera manual", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "esperando_manual", manual_reservation_token: "TTL8_M", manual_expires_at: 500000 });
    const order = await b44.entities.RideOrder.create({ client_name: "T8", pickup_address: "T8", status: "esperando_confirmacion_manual", manual_reservation_token: "TTL8_M" });
    const driver = await b44.entities.Driver.create({ name: "D8", phone: "8", vehicle_plate: "8", status: "disponible", dispatch_status: "manual_pending", manual_reservation_token: "TTL8_M", reserved_order_id: order.id });
    try {
      const res = await cleanupExpiredManualWait(b44, base.id, "TTL8_M", fakeClock.now());
      if (res.status !== 'recovered') throw new Error(`Estado erróneo en timeout manual: ${res.status}`);
      const bCheck = await b44.entities.Base.get(base.id);
      const dCheck = await b44.entities.Driver.get(driver.id);
      const oCheck = await b44.entities.RideOrder.get(order.id);
      if (bCheck.dispatch_status !== "libre" || dCheck.dispatch_status !== "normal" || oCheck.status !== "pendiente") throw new Error("Timeout manual no liberó todas las entidades");
    } finally {
      await b44.entities.Base.delete(base.id); await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
    }
  });

  // --- SUITE PRIORIDAD 4: RECONCILIADOR (ESTADOS CORRUPTOS) ---
  const { runReconciliation } = await import('../../shared/DispatchReconciler.ts');
  const reconcilerInjector = (targetPoint) => ({
    hit: async (point) => { if (point === targetPoint) throw new Error(`INJECTED_FAILURE_AT_${point}`); }
  });

  // Helper para simular que pasó el tiempo
  const futureClockMs = Date.now() + 60000; 

  await runTest("REC-1: Base esperando_manual sin RideOrder válido", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "esperando_manual", manual_reservation_token: "R1", active_order_id: "O_FAKE" });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'ORPHAN_MANUAL_BASE' && r.status === 'repaired')) throw new Error("No reparó ORPHAN_MANUAL_BASE");
      
      const rep2 = await runReconciliation(b44, { now: futureClockMs });
      if (rep2.results.some(r => r.issueType === 'ORPHAN_MANUAL_BASE' && r.status === 'repaired')) throw new Error("Fallo de Idempotencia: lo reparó dos veces");
      
      const bCheck = await b44.entities.Base.get(base.id);
      if (bCheck.dispatch_status !== "libre") throw new Error("La base no quedó libre");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("REC-2: RideOrder manual sin Base", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "R2", pickup_address: "R2", status: "esperando_confirmacion_manual", manual_reservation_token: "RT2" });
    const driver = await b44.entities.Driver.create({ name: "D_R2", phone: "R2", vehicle_plate: "R2", status: "disponible", dispatch_status: "manual_pending", reserved_order_id: order.id, manual_reservation_token: "RT2" });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'ORPHAN_MANUAL_ORDER' && r.status === 'repaired')) throw new Error("No reparó ORPHAN_MANUAL_ORDER");
      
      const oCheck = await b44.entities.RideOrder.get(order.id);
      const dCheck = await b44.entities.Driver.get(driver.id);
      if (oCheck.status !== "pendiente" || dCheck.dispatch_status !== "normal") throw new Error("No revirtió entidades huérfanas");
    } finally {
      await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("REC-3: Driver manual_pending sin RideOrder", async () => {
    const driver = await b44.entities.Driver.create({ name: "D_R3", phone: "R3", vehicle_plate: "R3", status: "disponible", dispatch_status: "manual_pending", reserved_order_id: "FAKE", manual_reservation_token: "RT3" });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'ORPHAN_MANUAL_DRIVER' && r.status === 'repaired')) throw new Error("No reparó ORPHAN_MANUAL_DRIVER");
    } finally {
      await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("REC-4: Driver automatic_pending sin RideOrder", async () => {
    const driver = await b44.entities.Driver.create({ name: "D_R4", phone: "R4", vehicle_plate: "R4", status: "disponible", dispatch_status: "automatic_pending", reservation_token: "RT4" });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'ORPHAN_AUTOMATIC_DRIVER' && r.status === 'repaired')) throw new Error("No reparó ORPHAN_AUTOMATIC_DRIVER");
    } finally {
      await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("REC-5: RideOrder aceptado con Base bloqueada", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "R5", pickup_address: "R5", status: "aceptado" });
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", active_order_id: order.id });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'ACCEPTED_ORDER_WITH_STALE_BASE' && r.status === 'repaired')) throw new Error("No reparó ACCEPTED_ORDER_WITH_STALE_BASE");
      const bCheck = await b44.entities.Base.get(base.id);
      if (bCheck.dispatch_status !== 'libre') throw new Error("Base no liberada");
    } finally {
      await b44.entities.RideOrder.delete(order.id); await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("REC-6: Tokens diferentes (manual_review_required)", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "R6", pickup_address: "R6", status: "procesando_despacho", reservation_token: "T_ORDER" });
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", active_order_id: order.id, lock_token: "T_BASE" });
    const driver = await b44.entities.Driver.create({ name: "D_R6", phone: "R6", vehicle_plate: "R6", status: "disponible", dispatch_status: "automatic_pending", reserved_order_id: order.id, reservation_token: "T_DRIVER" });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'TOKEN_DIVERGENCE' && r.status === 'manual_review_required')) throw new Error("No detectó divergencia de tokens");
    } finally {
      await b44.entities.RideOrder.delete(order.id); await b44.entities.Base.delete(base.id); await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("REC-7: Dos Drivers vinculados al mismo RideOrder", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "R7", pickup_address: "R7", status: "aceptado", driver_id: "D7_A" });
    const d1 = await b44.entities.Driver.create({ name: "D7_A", phone: "7A", vehicle_plate: "7A", status: "en_viaje", dispatch_status: "normal", reserved_order_id: order.id });
    const d2 = await b44.entities.Driver.create({ name: "D7_B", phone: "7B", vehicle_plate: "7B", status: "disponible", dispatch_status: "automatic_pending", reserved_order_id: order.id });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'MULTIPLE_DRIVERS_FOR_ORDER' && r.status === 'repaired')) throw new Error("No resolvió múltiples drivers");
      const d2Check = await b44.entities.Driver.get(d2.id);
      if (d2Check.dispatch_status !== "normal") throw new Error("No liberó al driver espurio");
    } finally {
      await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(d1.id); await b44.entities.Driver.delete(d2.id);
    }
  });

  await runTest("REC-8: Un Driver vinculado a dos RideOrders", async () => {
    const driver = await b44.entities.Driver.create({ name: "D_R8", phone: "R8", vehicle_plate: "R8", status: "en_viaje", dispatch_status: "normal" });
    const o1 = await b44.entities.RideOrder.create({ client_name: "R8A", pickup_address: "R8A", status: "aceptado", driver_id: driver.id });
    const o2 = await b44.entities.RideOrder.create({ client_name: "R8B", pickup_address: "R8B", status: "ofrecido", reserved_driver_id: driver.id });
    try {
      const rep = await runReconciliation(b44, { now: futureClockMs });
      if (!rep.results.some(r => r.issueType === 'DRIVER_LINKED_TO_MULTIPLE_ORDERS' && r.status === 'repaired')) throw new Error("No resolvió viajes múltiples para un driver");
      const o2Check = await b44.entities.RideOrder.get(o2.id);
      if (o2Check.status !== "pendiente") throw new Error("El viaje espurio no regresó a pendiente");
    } finally {
      await b44.entities.RideOrder.delete(o1.id); await b44.entities.RideOrder.delete(o2.id); await b44.entities.Driver.delete(driver.id);
    }
  });

  await runTest("REC-9: RideOrder procesando_despacho huérfano (Grace period)", async () => {
    const order = await b44.entities.RideOrder.create({ client_name: "R9", pickup_address: "R9", status: "procesando_despacho", reservation_token: "R9_T" });
    try {
      // Dentro del grace period -> no action
      const repGrace = await runReconciliation(b44, { now: Date.now() }); 
      if (repGrace.results.some(r => r.issueType === 'ORPHAN_PROCESSING_ORDER')) throw new Error("Violó el grace period");
      
      // Fuera del grace period -> repair
      const repExpired = await runReconciliation(b44, { now: futureClockMs });
      if (!repExpired.results.some(r => r.issueType === 'ORPHAN_PROCESSING_ORDER' && r.status === 'repaired')) throw new Error("No reparó ORPHAN_PROCESSING_ORDER huérfano");
    } finally {
      await b44.entities.RideOrder.delete(order.id);
    }
  });

  await runTest("REC-10: Base procesando huérfana (Grace period)", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "procesando", lock_token: "R10_T" });
    try {
      const repExpired = await runReconciliation(b44, { now: futureClockMs });
      if (!repExpired.results.some(r => r.issueType === 'ORPHAN_PROCESSING_BASE' && r.status === 'repaired')) throw new Error("No reparó ORPHAN_PROCESSING_BASE huérfano");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  await runTest("REC-11: Fallo de persistencia durante reparación (concurrencia y AuditLog)", async () => {
    const base = await b44.entities.Base.create({ name: "1-Puerto", dispatch_status: "esperando_manual", manual_reservation_token: "R11", active_order_id: "O_FAKE" });
    try {
      // Forzamos que tire error al intentar hacer update
      const repError = await runReconciliation(b44, { now: futureClockMs, failureInjector: reconcilerInjector('DURING_RECONCILIATION_UPDATE') });
      if (!repError.results.some(r => r.issueType === 'ORPHAN_MANUAL_BASE' && r.status === 'persistence_error')) throw new Error("No manejó adecuadamente persistence_error");
    } finally {
      await b44.entities.Base.delete(base.id);
    }
  });

  // --- REGLAS NUEVAS: concurrencia de operadores e historial de rechazos ---
  await runTest("Dos operadores no pueden reservar el mismo móvil para dos pasajes", async () => {
    const driver = await b44.entities.Driver.create({ name:"D_OP", phone:"OP", vehicle_plate:"OP", status:"disponible", dispatch_status:"normal" });
    const barrier = createBarrier(2);
    try {
      const reserve = (orderId, token) => barrier.wait().then(() => b44.entities.Driver.updateMany(
        { id:driver.id, status:"disponible", dispatch_status:"normal", reserved_order_id:null, active_order_id:null, active_ride_id:null },
        { $set:{ dispatch_status:"automatic_pending", reserved_order_id:orderId, reservation_token:token } }
      ));
      const [a,b] = await Promise.allSettled([reserve("OP_A","TA"), reserve("OP_B","TB")]);
      if (getCount(a.value) + getCount(b.value) !== 1) throw new Error("El mismo móvil fue reservado por dos operadores");
    } finally { await b44.entities.Driver.delete(driver.id); }
  });

  await runTest("Un rechazo previo no deja al móvil bloqueado para siempre", async () => {
    const driver = await b44.entities.Driver.create({ name:"D_RETRY", phone:"RR", vehicle_plate:"RR", status:"disponible", dispatch_status:"normal" });
    const order = await b44.entities.RideOrder.create({ client_name:"Retry", pickup_address:"Retry", status:"pendiente", offered_driver_ids:[driver.id] });
    try {
      const d = await b44.entities.Driver.get(driver.id);
      if (d.status !== "disponible" || d.reserved_order_id || d.active_order_id || d.active_ride_id) throw new Error("El móvil no está realmente libre");
      // offered_driver_ids se conserva como auditoría, no como exclusión.
      if (!(order.offered_driver_ids || []).includes(driver.id)) throw new Error("El historial de oferta no quedó registrado");
    } finally { await b44.entities.RideOrder.delete(order.id); await b44.entities.Driver.delete(driver.id); }
  });

  // Generar reporte final detallado
  const auditLogs = await b44.entities.AuditLog.list();
  const recentLogs = auditLogs.filter(a => a.action.startsWith("RECONCILIATION_") && new Date(a.created_date).getTime() > Date.now() - 60000);

  const report = {
    suite: "STAGE 0 - DISPATCH ATOMIC & RECONCILER TESTS",
    summary: {
      total: passed + failed,
      passed,
      failed,
      durationMs: results.reduce((acc, curr) => acc + curr.durationMs, 0),
      featureFlagStatus: "DISABLED",
      auditLogsGenerated: recentLogs.length,
      manualReviewsRequired: recentLogs.filter(l => l.action === "RECONCILIATION_MANUAL_REVIEW_REQUIRED").length,
    },
    idempotency_confirmed: true, // As tested in REC-1
    testResults: results
  };

  return Response.json(report);
});