import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInternalKey } from '../../shared/security.ts';

// Endpoint conservado para compatibilidad con llamadas/schedulers anteriores.
// No debe mutar RideOrder ni Driver: la falta de respuesta del cliente se resuelve
// manualmente desde la operación después del segundo aviso.
Deno.serve(async (req) => {
  createClientFromRequest(req);
  try {
    const payload = await req.json().catch(() => ({}));
    if (!validateInternalKey(payload?.internalKey)) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }
    return Response.json({
      success:true,
      disabled:true,
      cancelled:false,
      reason:'manual_cancellation_only',
      orderId:payload?.orderId || null
    });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
