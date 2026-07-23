import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  // Limpiamos entidades de prueba
  await b44.entities.ProtocolTrace.deleteMany({});
  await b44.entities.TestRideOrder.deleteMany({});
  await b44.entities.TestDriver.deleteMany({});

  const COUNT = 10;
  const orders = [];
  
  for (let i = 0; i < COUNT; i++) {
    const driver = await b44.entities.TestDriver.create({ status: "disponible", dispatch_status: "normal", driver_reservation_version: 0 });
    const order = await b44.entities.TestRideOrder.create({ status: "ofrecido", assignment_attempt: 1, driver_id: driver.id, processingLeaseVersion: 0 });
    orders.push({ orderId: order.id, driverId: driver.id });
  }

  const promises = [];
  for (const o of orders) {
     promises.push(
       b44.functions.invoke("testAcceptV2", {
         rideOrderId: o.orderId,
         driverId: o.driverId,
         operationKey: `OP_${o.orderId}`,
         assignmentAttempt: 1,
         injectFailureAtCommit: false
       })
     );
  }
  
  const results = await Promise.allSettled(promises);
  
  const traces = await b44.entities.ProtocolTrace.filter({}, '+timestamp', 500);

  const byCorrelation = {};
  for (const t of traces) {
    if (!byCorrelation[t.correlationId]) byCorrelation[t.correlationId] = [];
    byCorrelation[t.correlationId].push(t);
  }

  return Response.json({ 
    summary: {
      totalExecuted: COUNT,
      successes: results.filter(r => r.status === 'fulfilled' && r.value?.status === 'SUCCESS').length,
      tracesRecorded: traces.length
    },
    sampleTraceSteps: Object.values(byCorrelation)[0]?.map(t => ({
      sequence: t.traceSequence,
      step: t.step,
      executionResult: t.executionResult,
      updated: t.casUpdatedCount
    })) || [],
    sampleFullTrace: Object.values(byCorrelation)[0] || null,
    rawResults: results.map(r => r.status === 'fulfilled' ? r.value : r.reason)
  });
});