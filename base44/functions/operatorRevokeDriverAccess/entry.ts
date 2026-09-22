import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const { driverId, sessionToken, operatorName } = await req.json();
    if (!driverId) return Response.json({ success:false, reason:'DRIVER_ID_REQUIRED' }, { status:400 });

    // Validar sesión operativa reutilizando la autoridad existente sin modificar viajes.
    const auth = await b44.functions.invoke('authSystem', {
      action:'validate_session',
      payload:{ sessionToken },
      sessionToken
    }).catch(() => null);
    if (auth?.data && auth.data.success === false) {
      return Response.json({ success:false, reason:'UNAUTHORIZED' }, { status:401 });
    }

    const driver = await b44.entities.Driver.get(driverId).catch(() => null);
    if (!driver) return Response.json({ success:false, reason:'DRIVER_NOT_FOUND' }, { status:404 });

    // Desvincular equipo no puede alterar una oferta/viaje activo ni reordenar la cola.
    // Si está trabajando, sólo se revoca la sesión/dispositivo.
    const busy = Boolean(driver.active_order_id || driver.active_ride_id || driver.reserved_order_id || driver.dispatch_status === 'reserved');
    const patch:any = { current_session_token:null, device_id:null };
    if (!busy) patch.status = 'no_disponible';

    await b44.entities.Driver.update(driverId, patch);
    await b44.entities.AuditLog.create({
      action:'revocar_acceso',
      user_type:'operador',
      user_name:operatorName || 'Central',
      details:`Desvinculó el equipo del chofer ${driver.name || driverId}`,
      metadata:{ driverId, busy, queueUntouched:true }
    }).catch(() => {});

    return Response.json({ success:true, busy, statusChanged:!busy });
  } catch (e) {
    console.error('operatorRevokeDriverAccess error', e);
    return Response.json({ success:false, reason:e?.message || 'REVOKE_FAILED' }, { status:500 });
  }
});