import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  createClientFromRequest(req);
  // LEGACY DESHABILITADO 2026-09-22.
  // El broadcast global competía con la cola autoritativa por zona y podía volver
  // un viaje a Pendientes. Todo despacho debe entrar por assignRide/rejectRide.
  return Response.json({
    success:false,
    disabled:true,
    reason:'LEGACY_BROADCAST_DISABLED_USE_CANONICAL_DISPATCH'
  }, { status:410 });
});