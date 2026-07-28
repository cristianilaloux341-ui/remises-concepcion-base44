import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const toBase64Url = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const INTERNAL_KEY = Deno.env.get("INTERNAL_SERVICE_KEY");
    if (!body.internalKey || !INTERNAL_KEY || body.internalKey !== INTERNAL_KEY) {
      return Response.json({ error: "Unauthorized. Internal Service Key missing." }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const saStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
    const sa = JSON.parse(saStr);

    const jwtHeader = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = toBase64Url(new TextEncoder().encode(JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    })));

    const pemContents = sa.private_key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\s/g, "");
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    const rsaKey = await crypto.subtle.importKey(
      "pkcs8", binaryDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5", rsaKey, new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`)
    );
    const jwt = `${jwtHeader}.${jwtPayload}.${toBase64Url(signature)}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    }).then(r => r.json());

    if (!tokenRes.access_token) return Response.json({ error: "No access token", response: tokenRes });

    const driver = await base44.asServiceRole.entities.Driver.get(body.driverId || '6a427f8c4c0142e2217a1987');

    const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenRes.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token: driver.fcm_token,
          notification: { title: "Test", body: "Waking up phone" },
          android: {
            priority: "high",
            notification: {
              channel_id: "ride-alerts-urgent",
              sound: "default",
              click_action: "FCM_PLUGIN_ACTIVITY"
            }
          },
          data: { orderId: "123", action: "open_ride" }
        }
      })
    });

    const text = await fcmRes.text();
    return Response.json({ status: fcmRes.status, response: text, token: driver.fcm_token.substring(0, 15) });
  } catch(e) {
    return Response.json({ error: e.message });
  }
});