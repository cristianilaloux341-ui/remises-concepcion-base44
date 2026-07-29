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
    
    // Función auxiliar para ordenar choferes por tiempo de espera
    const sortByQueue = (arr) => arr.sort((a, b) => {
       const tA = a.queue_entered_at ? new Date(a.queue_entered_at).getTime() : 0;
       const tB = b.queue_entered_at ? new Date(b.queue_entered_at).getTime() : 0;
       return tA - tB;
    });

    if (order.zone) {
      const zoneDrivers = sortByQueue(drivers.filter(d => d.current_base === order.zone));
      if (zoneDrivers.length > 0) {
        await b44.functions.invoke("assignRide", {
           orderId: order.id, 
           driverId: zoneDrivers[0].id, 
           sessionToken: sessionToken || 'client_demo_token'
        });
        assigned = true;
      }
    }
    
    // Si no se asignó en zona (o no tenía zona), buscar al móvil más antiguo de CUALQUIER zona (global)
    if (!assigned && drivers.length > 0) {
      const globalDrivers = sortByQueue(drivers);
      await b44.functions.invoke("assignRide", {
         orderId: order.id, 
         driverId: globalDrivers[0].id, 
         sessionToken: sessionToken || 'client_demo_token'
      });
      assigned = true;
    }

    // Como último recurso de emergencia, emitir broadcast si algo falló
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