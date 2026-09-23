import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const { orderId, sessionToken, operatorName } = await req.json();
    if (!orderId) return Response.json({ success:false, reason:'ORDER_ID_REQUIRED' }, { status:400 });

    // Misma autenticación operativa que el resto de comandos de Central:
    // la sesión se valida por la función de acción antes de tocar estado.
    const cancel = await b44.functions.invoke('operatorOrderAction', {
      action: 'cancel',
      orderId,
      sessionToken
    });
    if (!cancel?.data?.success) {
      return Response.json({ success:false, reason: cancel?.data?.reason || 'CANCEL_FAILED' }, { status:409 });
    }

    const fresh = await b44.entities.RideOrder.get(orderId).catch(() => null);
    if (!fresh) return Response.json({ success:true, alreadyDeleted:true });

    // operatorOrderAction es la única autoridad que libera/promueve slots del móvil.
    // Esta función ya no vuelve a escribir Driver después de cancelar: hacerlo acá
    // abría un segundo mandato y podía pisar una promoción/asignación concurrente.
    // Tras el commit terminal canónico, eliminar sólo el registro de la orden.
    await b44.entities.RideOrder.delete(orderId);
    await b44.entities.AuditLog.create({
      action:'eliminar_viaje',
      user_type:'operador',
      user_name: operatorName || 'Central',
      details:`Eliminó la orden de viaje ID ${orderId}`,
      metadata:{ orderId, canonical:true }
    }).catch(() => {});

    return Response.json({ success:true });
  } catch (e) {
    console.error('operatorDeleteRide error', e);
    return Response.json({ success:false, reason:e?.message || 'DELETE_FAILED' }, { status:500 });
  }
});