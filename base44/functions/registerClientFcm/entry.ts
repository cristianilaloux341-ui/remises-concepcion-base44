import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { clientId, sessionToken, token } = payload || {};
    if (!clientId || !sessionToken || !token) {
      return Response.json({ success:false, reason:'missing_fields' }, { status:400 });
    }
    if (!(await verifyRequestAuth(b44, payload, { allowClient:true, allowClientId:String(clientId) }))) {
      return Response.json({ success:false, reason:'unauthorized' }, { status:401 });
    }
    await b44.entities.Client.update(String(clientId), { fcm_token:String(token) });
    return Response.json({ success:true });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
