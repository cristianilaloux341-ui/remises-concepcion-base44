import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { validateInternalKey } from '../../shared/security.ts';

// Compatibilidad: mantenemos la función porque puede existir un scheduler viejo
// que todavía la invoque. Ya NO busca ni cancela viajes. La política vigente es
// manual: luego del segundo aviso el chofer/base decide qué hacer.
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
      reason:'manual_cancellation_only',
      checked:0,
      expired:0,
      results:[]
    });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
