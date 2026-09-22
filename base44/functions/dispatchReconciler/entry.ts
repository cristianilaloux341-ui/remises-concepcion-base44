import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  createClientFromRequest(req);
  // LEGACY DESHABILITADO 2026-09-22.
  // No reconciliar estados/colas desde un segundo motor. El estado operativo
  // pertenece a las transiciones canónicas de despacho.
  return Response.json({
    success:false,
    disabled:true,
    reason:'LEGACY_DISPATCH_RECONCILER_DISABLED'
  }, { status:410 });
});