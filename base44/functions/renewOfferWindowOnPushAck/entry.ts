import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Ruta legacy retirada.
 * ACK/PUSH_RECEIVED entra exclusivamente por handleNativePushAction.
 * La ventana comercial nace exclusivamente en ALERT_PRESENTED.
 */
Deno.serve(async (req) => {
  createClientFromRequest(req);
  return Response.json(
    { success:false, reason:'LEGACY_ACK_ROUTE_DISABLED_USE_HANDLE_NATIVE_PUSH_ACTION' },
    { status:410 }
  );
});
