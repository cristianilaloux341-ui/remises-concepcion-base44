import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { verifyRequestAuth } from '../../shared/security.ts';

// LEGACY NEUTRALIZADO.
// La cola sólo puede cambiar mediante enterDriverQueue, leaveDriverQueue y
// manualReorderDriverQueue. Mantener esta función como endpoint explícitamente
// inerte evita que una llamada vieja vuelva a insertar un móvil 1° por afuera de
// la autoridad canónica de Central/backend.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json().catch(() => ({}));

  if (!(await verifyRequestAuth(b44, payload, { allowOperator: true }))) {
    return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
  }

  return Response.json({
    success:false,
    reason:'LEGACY_QUEUE_FRONT_DISABLED',
    message:'Use manualReorderDriverQueue for an explicit operator reorder.'
  }, { status:410 });
});
