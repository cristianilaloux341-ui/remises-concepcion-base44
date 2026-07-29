import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  
  try {
    const body = await req.json();
    const { orderData, sessionToken } = body;
    
    // 1. Crear el viaje inmediatamente
    const order = await b44.entities.RideOrder.create(orderData);
    
    // 2. Ejecutar la lógica de despacho de forma síncrona en el servidor
    const drivers = await b44.entities.Driver.filter({ status: "disponible" });
    let assigned = false;
    
    if (order.zone) {
      // Ordenar la cola de la base por orden de llegada
      const zoneDrivers = drivers.filter(d => d.current_base === order.zone).sort((a, b) => {
         const tA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
         const tB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
         return tA - tB;
      });
      
      if (zoneDrivers.length > 0) {
        // Disparar la asignación y notificación directa
        await b44.functions.invoke("assignRide", {
           orderId: order.id, 
           driverId: zoneDrivers[0].id, 
           sessionToken: sessionToken || 'client_demo_token'
        });
        assigned = true;
      }
    }
    
    // Si no había nadie en la zona, lanzar el broadcast a todos instantáneamente
    if (!assigned) {
      await b44.functions.invoke("broadcastRide", {
         orderId: order.id, 
         sessionToken: sessionToken || 'client_demo_token'
      });
    }
    
    return Response.json({ success: true, orderId: order.id });
  } catch(e) {
    console.error("Error en clientCreateAndDispatchRide", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});