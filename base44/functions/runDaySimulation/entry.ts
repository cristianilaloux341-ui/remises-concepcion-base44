import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { assignDriverToOrderAtomic, reassignAfterAutomaticReject, tryManualCandidate, cleanupExpiredTechnicalLock } from '../../shared/DispatchLogic.ts';

const BATCH_SIZE = 50;
const TOTAL_ORDERS = 1000;
const TOTAL_DRIVERS = 50;
const BASES = ["1-Puerto", "2-Plaza", "3-Columna", "4-Base", "5-Cementerio", "6-Díaz Vélez", "7-Don Bosco", "8-Monumento"];

export default async function (req) {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  const payload = await req.json();
  const { action, internalKey } = payload;
  
  let isAuthorized = false;
  if (internalKey && internalKey === Deno.env.get("INTERNAL_SERVICE_KEY")) {
    isAuthorized = true;
  } else {
    try {
      const me = await base44.auth.me();
      if (me && (me.role === 'admin' || me.role === 'supervisor')) {
        isAuthorized = true;
      }
    } catch (e) {}
  }

  if (!isAuthorized) {
    return Response.json({ success: false, reason: "Unauthorized" }, { status: 401 });
  }

  // Create a proxy b44 instance that maps real entities to test entities
  const testB44 = {
    entities: {
      RideOrder: b44.entities.TestRideOrder,
      Driver: b44.entities.TestDriver,
      Base: b44.entities.TestBase,
      AuditLog: b44.entities.AuditLog,
      DispatchConfig: b44.entities.DispatchConfig
    },
    functions: {
      invoke: async (name, payload) => {
        if (name === 'sendPushNotification') return { data: { ok: true, stub: true } };
        return b44.functions.invoke(name, payload);
      }
    }
  };

  try {
    if (action === 'start') {
      // 1. Initial validation
      const configs = await b44.entities.DispatchConfig.filter({ zone: 'SIM_DAY' });
      if (configs.length > 0 && configs[0].engineState === 'active') {
        return Response.json({ success: false, error: 'Simulation already running' });
      }

      // 2. Clean previous data
      await b44.entities.TestRideOrder.deleteMany({});
      await b44.entities.TestDriver.deleteMany({});
      await b44.entities.TestBase.deleteMany({});
      
      // 3. Seed Bases
      for (const b of BASES) {
        await b44.entities.TestBase.create({ name: b });
      }

      // 4. Seed Drivers
      const driversToCreate = [];
      for (let i = 0; i < TOTAL_DRIVERS; i++) {
        driversToCreate.push({
          name: `SimDriver ${i}`,
          phone: `SIM${i}`,
          status: "disponible",
          dispatch_status: "normal",
          current_base: BASES[i % BASES.length],
          queue_entered_at: new Date(Date.now() - Math.random() * 10000).toISOString(),
          pace_ms: 1000 + Math.random() * 5000,
          reject_rate: Math.random() < 0.1 ? 0.3 : 0.05,
          off_rate: Math.random() < 0.05 ? 0.2 : 0,
          connectivity_reliable: Math.random() > 0.05,
          base_affinity: BASES[i % BASES.length]
        });
      }
      await b44.entities.TestDriver.bulkCreate(driversToCreate);

      // 5. Create Config State
      if (configs.length === 0) {
        await b44.entities.DispatchConfig.create({
          zone: 'SIM_DAY',
          engineState: 'active',
          notes: JSON.stringify({ processedOrders: 0, time_ms: 0, status: 'running' })
        });
      } else {
        await b44.entities.DispatchConfig.updateMany(
          { zone: 'SIM_DAY' },
          { $set: { engineState: 'active', notes: JSON.stringify({ processedOrders: 0, time_ms: 0, status: 'running' }) } }
        );
      }
      
      // Trigger first block
      b44.functions.invoke('runDaySimulation', { action: 'tick', internalKey }).catch(e => console.error("Error triggering tick", e));
      
      return Response.json({ success: true, message: 'Simulation started' });
    }

    if (action === 'tick') {
      const configs = await b44.entities.DispatchConfig.filter({ zone: 'SIM_DAY' });
      if (configs.length === 0 || configs[0].engineState !== 'active') {
        return Response.json({ success: false, reason: 'Simulation not active' });
      }
      
      const state = JSON.parse(configs[0].notes || '{}');
      if (state.processedOrders >= TOTAL_ORDERS && state.status !== 'finalizing') {
        // Mark for finalization
        await b44.entities.DispatchConfig.updateMany({ zone: 'SIM_DAY' }, { $set: { notes: JSON.stringify({ ...state, status: 'finalizing' }) } });
        b44.functions.invoke('runDaySimulation', { action: 'finalize', internalKey }).catch(e => null);
        return Response.json({ success: true, status: 'finalizing' });
      }

      const ordersToGenerate = Math.min(BATCH_SIZE, TOTAL_ORDERS - state.processedOrders);
      
      // Simular un TICK de tiempo y comportamientos
      await simulateBehaviors(testB44);

      if (ordersToGenerate > 0) {
        // Generate new orders in this block
        const newOrders = [];
        for (let i = 0; i < ordersToGenerate; i++) {
          newOrders.push({
            client_name: `SimClient ${state.processedOrders + i}`,
            pickup_address: `Calle Falsa ${Math.floor(Math.random()*1000)}`,
            status: "pendiente",
            zone: BASES[Math.floor(Math.random() * BASES.length)]
          });
        }
        await b44.entities.TestRideOrder.bulkCreate(newOrders);
        
        // Simular despachos y carreras (asignaciones)
        await processPendingOrders(testB44, BASES);
      }

      // Progress state
      state.processedOrders += ordersToGenerate;
      state.time_ms += 10000; // Avanzar reloj virtual
      await b44.entities.DispatchConfig.updateMany({ zone: 'SIM_DAY' }, { $set: { notes: JSON.stringify(state) } });

      // Recursively schedule next tick
      b44.functions.invoke('runDaySimulation', { action: 'tick', internalKey }).catch(e => null);
      
      return Response.json({ success: true, processed: state.processedOrders });
    }

    if (action === 'finalize') {
      const finalOrders = await b44.entities.TestRideOrder.list();
      const finalDrivers = await b44.entities.TestDriver.list();

      let finalizados = 0;
      let cancelados = 0;
      let pendientes = 0;
      let duplicados = 0;

      finalOrders.forEach(o => {
        if (o.status === 'completado') finalizados++;
        else if (o.status === 'cancelado' || o.status === 'rechazado') cancelados++;
        else pendientes++;
      });

      const auditData = {
        total_creados: finalOrders.length,
        finalizados,
        cancelados,
        pendientes,
        duplicados,
        resultado: finalOrders.length === TOTAL_ORDERS ? 'OK' : 'FAIL'
      };

      await b44.entities.DispatchConfig.updateMany(
        { zone: 'SIM_DAY' },
        { $set: { engineState: 'disabled', notes: JSON.stringify(auditData) } }
      );

      return Response.json({ success: true, report: auditData });
    }

    if (action === 'abort') {
      await b44.entities.DispatchConfig.updateMany({ zone: 'SIM_DAY' }, { $set: { engineState: 'disabled' } });
      return Response.json({ success: true, message: 'Simulation aborted' });
    }
    
    if (action === 'status') {
      const configs = await b44.entities.DispatchConfig.filter({ zone: 'SIM_DAY' });
      return Response.json({ success: true, state: configs.length > 0 ? configs[0] : null });
    }

    return Response.json({ success: false, error: 'Unknown action' });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

// -----------------------------------------------------------------------------
// Simulators
// -----------------------------------------------------------------------------

async function processPendingOrders(testB44, BASES) {
  // Simulamos que el sistema busca despachar
  const pendings = await testB44.entities.RideOrder.filter({ status: 'pendiente' });
  const disponibles = await testB44.entities.Driver.filter({ status: 'disponible', dispatch_status: 'normal' });
  
  for (let i = 0; i < Math.min(pendings.length, 30); i++) { // Process up to 30 to not overwhelm DB
    const order = pendings[i];
    const candidate = disponibles.find(d => d.current_base === order.zone) || disponibles[i % disponibles.length];
    
    if (candidate) {
      // Usar DispatchLogic transicional atómico
      const token = crypto.randomUUID();
      try {
        await assignDriverToOrderAtomic(testB44, order, candidate, token);
      } catch (e) {
        // console.error("Sim assign fail", e);
      }
    }
  }
}

async function simulateBehaviors(testB44) {
  // 1. Choferes en estado "ofrecido" deciden aceptar o rechazar
  const ofrecidos = await testB44.entities.RideOrder.filter({ status: 'ofrecido' });
  for (const o of ofrecidos) {
    if (!o.reserved_driver_id) continue;
    const ds = await testB44.entities.Driver.filter({ id: o.reserved_driver_id });
    if (ds.length === 0) continue;
    const driver = ds[0];

    // Simular humano: % de rechazo
    if (Math.random() < driver.reject_rate) {
      // Rechazar
      const bases = await testB44.entities.Base.filter({ name: driver.current_base });
      if (bases.length > 0) {
        await reassignAfterAutomaticReject(testB44, bases[0].id, o.id, driver.id, o.reservation_token);
      }
    } else {
      // Aceptar
      const res = await testB44.entities.RideOrder.updateMany(
        { id: o.id, status: "ofrecido", reserved_driver_id: driver.id },
        { $set: { status: "aceptado", driver_id: driver.id, driver_name: driver.name, reservation_token: null } }
      );
      if ((res.matchedCount ?? res.modifiedCount ?? 0) === 1) {
        await testB44.entities.Driver.updateMany(
          { id: driver.id },
          { $set: { status: 'en_viaje', dispatch_status: 'normal', reservation_token: null, reserved_order_id: null } }
        );
      }
    }
  }

  // 2. Choferes aceptados pasan a en_camino -> en_viaje -> completado muy rápido
  const aceptados = await testB44.entities.RideOrder.filter({ status: { $in: ['aceptado', 'en_camino', 'en_viaje'] } });
  for (const o of aceptados) {
    if (o.status === 'aceptado') {
      await testB44.entities.RideOrder.updateMany({ id: o.id }, { $set: { status: 'en_camino' } });
    } else if (o.status === 'en_camino') {
      await testB44.entities.RideOrder.updateMany({ id: o.id }, { $set: { status: 'en_viaje' } });
    } else if (o.status === 'en_viaje') {
      await testB44.entities.RideOrder.updateMany({ id: o.id }, { $set: { status: 'completado' } });
      await testB44.entities.Driver.updateMany({ id: o.driver_id }, { $set: { status: 'disponible', current_base: BASES[Math.floor(Math.random() * BASES.length)] } });
    }
  }
}