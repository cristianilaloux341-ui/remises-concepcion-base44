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
    const allAvailable = await b44.entities.Driver.filter({ status: "disponible" });
    // Misma regla que Central: estar en servicio/libre alcanza; la cola/base solo
    // ordena prioridad y nunca es requisito. Excluir cualquier vínculo activo.
    const drivers = allAvailable.filter(d =>
      !d.active_order_id && !d.active_ride_id && !d.reserved_order_id &&
      (d.dispatch_status == null || d.dispatch_status === "normal")
    );
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
        const res = await b44.functions.invoke("assignRide", {
           orderId: order.id,
           driverId: zoneDrivers[0].id,
           sessionToken: sessionToken || 'client_demo_token'
        });
        assigned = res?.data?.success === true;
      }
    }
    
    // Si no se asignó en zona (o no tenía zona), buscar al móvil más antiguo de CUALQUIER zona (global)
    if (!assigned && drivers.length > 0) {
      const globalDrivers = sortByQueue(drivers);
      const res = await b44.functions.invoke("assignRide", {
         orderId: order.id,
         driverId: globalDrivers[0].id,
         sessionToken: sessionToken || 'client_demo_token'
      });
      assigned = res?.data?.success === true;
    }

    // Si no hay móviles no hacemos broadcast, lo dejamos en pendiente para que el operador lo gestione
    if (!assigned) {
       await b44.entities.RideOrder.update(order.id, { status: "pendiente" });
    }
    
    return Response.json({ success: true, orderId: order.id });
  } catch(e) {
    console.error("Error en clientCreateAndDispatchRide", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
});