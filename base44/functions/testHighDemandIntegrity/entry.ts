import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  const payload = await req.json();
  const { internalKey } = payload;
  
  if (internalKey !== Deno.env.get("INTERNAL_SERVICE_KEY")) {
    return Response.json({ success: false, reason: "Unauthorized" }, { status: 401 });
  }

  const numOrders = 200;
  const numDrivers = 50;

  try {
    // 1. Setup Test Data
    const driverIds = [];
    const driversToCreate = [];
    for (let i = 0; i < numDrivers; i++) {
      driversToCreate.push({
        name: `Test Driver ${i}`,
        phone: `555000${i.toString().padStart(3, '0')}`,
        vehicle_plate: `TST${i.toString().padStart(3, '0')}`,
        status: i % 5 === 0 ? "no_disponible" : "disponible",
        current_base: "1-Puerto"
      });
    }
    
    const createdDrivers = await b44.entities.Driver.bulkCreate(driversToCreate);
    createdDrivers.forEach(d => driverIds.push(d.id));

    const orderIds = [];
    const ordersToCreate = [];
    for (let i = 0; i < numOrders; i++) {
      ordersToCreate.push({
        client_name: `Test Client ${i}`,
        pickup_address: `Test Street ${i}`,
        status: "pendiente"
      });
    }
    
    const createdOrders = await b44.entities.RideOrder.bulkCreate(ordersToCreate);
    createdOrders.forEach(o => orderIds.push(o.id));

    // 2. Simulate Concurrent Dispatch
    const dispatchPromises = [];
    for (let i = 0; i < numOrders; i++) {
      const orderId = orderIds[i];
      // Cada pasaje intentado asignar a 3 móviles diferentes concurrentemente
      for (let j = 0; j < 3; j++) {
        const driverId = driverIds[(i + j) % numDrivers];
        dispatchPromises.push(
          b44.functions.invoke("assignRide", {
            orderId,
            driverId,
            sessionToken: "test_token",
            internalKey: Deno.env.get("INTERNAL_SERVICE_KEY")
          }).catch(e => null)
        );
      }
    }
    
    await Promise.all(dispatchPromises);

    // 3. Validation and Counting
    const finalOrders = await b44.entities.RideOrder.filter({ id: { $in: orderIds } });
    const finalDrivers = await b44.entities.Driver.filter({ id: { $in: driverIds } });

    let pendientesCount = 0;
    let duplicadosCount = 0;
    let driversDuplicadosCount = 0;

    finalOrders.forEach(o => {
      if (o.status === "pendiente") pendientesCount++;
      // Chequear si un pasaje parece estar siendo atendido por múltiples choferes
      if (o.reserved_driver_id && o.driver_id && o.reserved_driver_id !== o.driver_id) {
          duplicadosCount++; // Inconsistencia
      }
    });

    finalDrivers.forEach(d => {
      if (d.reserved_order_id && d.active_ride_id && d.reserved_order_id !== d.active_ride_id) {
         driversDuplicadosCount++;
      }
    });
    
    const checkDupeMap = {};
    for (const d of finalDrivers) {
      const oid = d.reserved_order_id || d.active_ride_id;
      if (oid) {
        if (checkDupeMap[oid]) {
          // Más de un móvil reservó el mismo viaje
          duplicadosCount++;
        }
        checkDupeMap[oid] = true;
      }
    }

    // 4. Cleanup Test Data
    // Dividir eliminación para evitar payload too large
    for (let i = 0; i < orderIds.length; i += 50) {
      await b44.entities.RideOrder.deleteMany({ id: { $in: orderIds.slice(i, i + 50) } });
    }
    await b44.entities.Driver.deleteMany({ id: { $in: driverIds } });

    return Response.json({
      success: true,
      results: {
        totalPendientes: pendientesCount,
        pasajesDuplicados: duplicadosCount,
        movilesConViajesMultiples: driversDuplicadosCount,
        testPassed: duplicadosCount === 0 && driversDuplicadosCount === 0
      }
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});