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

  return Response.json({
    passed,
    failed,
    results
  });
});