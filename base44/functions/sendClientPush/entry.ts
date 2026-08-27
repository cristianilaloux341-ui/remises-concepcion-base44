import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyRequestAuth } from '../../shared/security.ts';

const toBase64Url = (input: string | Uint8Array) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

async function getFirebaseAccessToken(sa:any) {
  const now = Math.floor(Date.now()/1000);
  const header = toBase64Url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const claims = toBase64Url(JSON.stringify({ iss:sa.client_email, scope:'https://www.googleapis.com/auth/firebase.messaging', aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600 }));
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'');
  const der = Uint8Array.from(atob(pem), c=>c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${toBase64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('firebase_auth_failed');
  return data.access_token;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const payload = await req.json();
    const { clientId, orderId, driverId, sessionToken, noticeNumber = 1, type = 'client_arrival' } = payload || {};
    if (!clientId || !orderId) return Response.json({success:false,reason:'missing_fields'},{status:400});

    const internalOk = payload.internalKey && payload.internalKey === Deno.env.get('INTERNAL_SERVICE_KEY');
    const driverOk = driverId && sessionToken && await verifyRequestAuth(b44, payload, {allowDriverId:String(driverId)});
    if (!internalOk && !driverOk) return Response.json({success:false,reason:'unauthorized'},{status:401});

    const client = await b44.entities.Client.get(String(clientId)).catch(()=>null);
    if (!client) return Response.json({success:false,reason:'client_not_found'},{status:404});
    if (!client.fcm_token) return Response.json({success:false,reason:'client_has_no_fcm_token'},{status:409});

    const order = await b44.entities.RideOrder.get(String(orderId)).catch(()=>null);
    if (!order || String(order.client_id||'') !== String(clientId)) return Response.json({success:false,reason:'order_client_mismatch'},{status:403});
    if (driverId && String(order.driver_id||'') !== String(driverId)) return Response.json({success:false,reason:'order_driver_mismatch'},{status:403});

    const saRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
    if (!saRaw) return Response.json({success:false,reason:'firebase_not_configured'},{status:500});
    const sa = JSON.parse(saRaw);
    const accessToken = await getFirebaseAccessToken(sa);

    const isArrival = type === 'client_arrival' || type === 'arrival' || type === 'bocina';
    const pushType = isArrival ? 'client_arrival' : String(type);
    const title = isArrival ? 'Tu móvil está afuera' : 'Remises Concepción';
    const body = isArrival ? (Number(noticeNumber) >= 2 ? 'Segundo aviso: tu móvil te está esperando.' : 'Tu móvil llegó. Tocá YA VOY para avisarle al chofer.') : 'Tenés una actualización de tu viaje.';
    const arrivalTag = `client_arrival_${String(orderId)}_${String(noticeNumber)}`;
    const message = {
      message: {
        token: client.fcm_token,
        notification: { title, body },
        data: { type:pushType, orderId:String(orderId), clientId:String(clientId), noticeNumber:String(noticeNumber), title, body },
        android: {
          priority:'high',
          notification: isArrival
            ? { channel_id:'client_arrival_v2', sound:'horn', tag:arrivalTag, default_vibrate_timings:true, visibility:'PUBLIC' }
            : { sound:'default', default_vibrate_timings:true, visibility:'PUBLIC' }
        }
      }
    };
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(message)});
    const result = await response.json().catch(()=>({}));
    if (!response.ok) return Response.json({success:false,reason:'fcm_send_failed',status:response.status,detail:result},{status:502});
    return Response.json({success:true,messageId:result.name||null});
  } catch(e:any) {
    return Response.json({success:false,reason:e?.message||'error'},{status:500});
  }
});
