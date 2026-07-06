import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── VAPID helpers (pure Web Crypto, no external libs) ─────────────────────────

const toBase64Url = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const fromBase64Url = (str) => {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
};

// Build minimal VAPID JWT (ES256) using SubtleCrypto with proper r,s serialization
async function buildVapidJwt(audience, privateKeyB64, subject) {
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: now + 12 * 3600,
    sub: subject,
  })));

  const sigInput = `${header}.${payload}`;

  const privateKeyBuf = fromBase64Url(privateKeyB64);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBuf,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );

  // ES256 signature: r and s are each 32 bytes, concatenated directly (not ASN.1 encoded)
  // Web Push expects raw concatenation of r || s (64 bytes total)
  const sig = new Uint8Array(sigBuf).slice(0, 64);

  return `${sigInput}.${toBase64Url(sig)}`;
}

// Encrypt the push payload using RFC 8188 / Web Push encryption
async function encryptPayload(plaintext, auth, p256dh) {
  const authBuf = fromBase64Url(auth);
  const p256dhBuf = fromBase64Url(p256dh);

  // Generate ephemeral key pair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const ephPubBuf = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  // Import recipient public key
  const recipientKey = await crypto.subtle.importKey(
    'raw',
    p256dhBuf,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // ECDH shared secret
  const sharedBuf = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey },
    ephemeral.privateKey,
    256
  );

  // HKDF — context strings per RFC 8291
  const enc = new TextEncoder();
  const prk = await hkdf(authBuf, new Uint8Array(sharedBuf), enc.encode('Content-Encoding: auth\0'), 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const cek = await hkdf(salt, prk,
    buildContext(enc.encode('aesgcm'), p256dhBuf, ephPubBuf), 16);
  const nonce = await hkdf(salt, prk,
    buildContext(enc.encode('nonce'), p256dhBuf, ephPubBuf), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);

  // Pad plaintext with 2-byte length prefix (per draft-ietf-webpush-encryption)
  const plaintextBytes = enc.encode(typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext));
  const padded = new Uint8Array(plaintextBytes.length + 2);
  padded[0] = 0; padded[1] = 0; // no padding
  padded.set(plaintextBytes, 2);

  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded);

  return { encrypted, salt, ephPubBuf };
}

function buildContext(label, receiverPub, senderPub) {
  const enc = new TextEncoder();
  const peerLen = new Uint8Array(2);
  const rcvLen = new Uint8Array(2);
  new DataView(peerLen.buffer).setUint16(0, receiverPub.byteLength, false);
  new DataView(rcvLen.buffer).setUint16(0, senderPub.byteLength, false);

  const ctx = new Uint8Array(
    label.length + 1 +
    enc.encode('P-256\0').length +
    2 + receiverPub.byteLength +
    2 + senderPub.byteLength
  );
  let offset = 0;
  ctx.set(label, offset); offset += label.length;
  ctx[offset++] = 0; // null terminator
  const p256label = enc.encode('P-256\0');
  ctx.set(p256label, offset); offset += p256label.length;
  ctx.set(peerLen, offset); offset += 2;
  ctx.set(new Uint8Array(receiverPub), offset); offset += receiverPub.byteLength;
  ctx.set(rcvLen, offset); offset += 2;
  ctx.set(new Uint8Array(senderPub), offset);
  return ctx;
}

async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prkBuf = await crypto.subtle.sign('HMAC', saltKey, ikm);

  const prkKey = await crypto.subtle.importKey('raw', prkBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithByte = new Uint8Array(info.length + 1);
  infoWithByte.set(info); infoWithByte[info.length] = 1;
  const okm = await crypto.subtle.sign('HMAC', prkKey, infoWithByte);
  return new Uint8Array(okm).slice(0, length);
}

// ── Send a push message to a single subscription ─────────────────────────────
async function sendWebPush(subscription, payload, vapidPublicKey, vapidPrivateKey) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await buildVapidJwt(audience, vapidPrivateKey, 'mailto:radiocab@app.com');

  const { encrypted, salt, ephPubBuf } = await encryptPayload(
    payload,
    subscription.keys.auth,
    subscription.keys.p256dh
  );

  const headers = {
    'Authorization': `vapid t=${jwt},k=${vapidPublicKey}`,
    'Content-Encoding': 'aesgcm',
    'Encryption': `salt=${toBase64Url(salt)}`,
    'Crypto-Key': `dh=${toBase64Url(ephPubBuf)}`,
    'Content-Type': 'application/octet-stream',
    'TTL': '300', // Aumentado a 5 minutos para celulares que entraron en Doze Mode
    'Urgency': 'high'
  };

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers,
    body: encrypted,
  });

  return res.status;
}

// ── Entity to store push subscriptions ───────────────────────────────────────
// We store subscriptions on the Driver entity under push_subscriptions field.
// This function is called from the frontend when a driver registers their SW.

Deno.serve(async (req) => {
  console.log("=> sendPushNotification INVOCADO");
  const base44 = createClientFromRequest(req);

  const body = await req.json();
  console.log("=> BODY:", JSON.stringify(body));
  
  // Interceptar payload de automación de entidad (RideOrder)
  if (body.event && body.event.entity_name === "RideOrder" && body.data) {
    console.log("=> INTERCEPT RIDE ORDER AUTOMATION:", body.data.id, "STATUS:", body.data.status);
    // Cuando pasa a ofrecido
    const isStatusChanged = !body.old_data || body.changed_fields?.includes("status");
    console.log("=> isStatusChanged:", isStatusChanged, "old_status:", body.old_data?.status);
    if (body.data.status === "ofrecido" && body.data.driver_id && isStatusChanged) {
      console.log("=> AUTOMATION SETTING ACTION TO SEND FOR DRIVER:", body.data.driver_id);
      body.action = "send";
      body.driverId = body.data.driver_id;
      body.orderId = body.data.id;
      body.orderData = {
        pickup_address: body.data.pickup_address,
        dropoff_address: body.data.dropoff_address,
        fare: body.data.fare
      };
      body.isBroadcast = false;
    }
    // Cuando pasa a pendiente y no tiene chofer (broadcast)
    else if (body.data.status === "pendiente" && !body.data.driver_id && body.data.notes?.includes("[BROADCAST]") && isStatusChanged) {
      console.log("=> AUTOMATION SETTING ACTION TO BROADCAST");
      body.action = "broadcast_trigger"; // Nuevo action para manejar el broadcast desde el backend
      body.orderId = body.data.id;
      body.orderData = {
        pickup_address: body.data.pickup_address,
        dropoff_address: body.data.dropoff_address,
        fare: body.data.fare
      };
    }
  }

  const { action, driverId, subscription, orderId, orderData, token, userId, fromName, messageContent, isBroadcast, targetDriverId } = body;

  if (action === 'native_accept') {
    const { driverName, base } = body;
    await base44.asServiceRole.entities.RideOrder.update(orderId, { 
       status: "aceptado", 
       driver_id: driverId,
       driver_name: driverName,
       assigned_base: base
    });
    await base44.asServiceRole.entities.Driver.update(driverId, { status: "en_viaje" });
    return Response.json({ ok: true });
  }

  if (action === 'native_reject') {
    const order = await base44.asServiceRole.entities.RideOrder.get(orderId);
    if (order) {
      const offered = order.offered_driver_ids || [];
      if (!offered.includes(driverId)) offered.push(driverId);
      
      await base44.asServiceRole.entities.RideOrder.update(orderId, { 
         status: "pendiente",
         driver_id: null,
         offered_driver_ids: offered
      });
    }
    
    await base44.asServiceRole.entities.AuditLog.create({
      action: "rechazar_viaje",
      user_type: "chofer",
      user_name: "App Nativa",
      details: `Rechazó el viaje nativamente (ID: ${orderId})`
    });

    return Response.json({ ok: true });
  }

  const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');

  // ── Register FCM Token (Native Android) ──────────────────────────────────
  if (action === 'subscribe_fcm') {
    if (!driverId || !token) {
      return Response.json({ error: 'Missing driverId or token' }, { status: 400 });
    }
    await base44.asServiceRole.entities.Driver.update(driverId, {
      fcm_token: token,
    });
    return Response.json({ ok: true });
  }

  // ── Register subscription ─────────────────────────────────────────────────
  if (action === 'subscribe') {
    if (!driverId || !subscription) {
      return Response.json({ error: 'Missing driverId or subscription' }, { status: 400 });
    }
    // Store on driver record
    await base44.asServiceRole.entities.Driver.update(driverId, {
      push_subscription: JSON.stringify(subscription),
    });
    return Response.json({ ok: true });
  }

  // ── Register operator push subscription ──────────────────────────────────
  if (action === 'subscribe_operator') {
    if (!userId || !subscription) {
      return Response.json({ error: 'Missing userId or subscription' }, { status: 400 });
    }
    // Store on User record
    await base44.asServiceRole.entities.User.update(userId, {
      push_subscription: JSON.stringify(subscription),
    });
    return Response.json({ ok: true });
  }

  // ── Send push to all operators (new driver message) ───────────────────────
  if (action === 'send_to_operators') {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return Response.json({ error: 'VAPID keys not configured' }, { status: 500 });
    }
    try {
      const users = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      const results = [];
      for (const u of users) {
        if (!u.push_subscription) continue;
        let sub;
        try { sub = JSON.parse(u.push_subscription); } catch (_) { continue; }
        const payload = JSON.stringify({
          type: 'NEW_MESSAGE',
          title: `📩 Mensaje de ${fromName || 'Móvil'}`,
          body: messageContent || 'Nuevo mensaje en el chat',
          url: '/messages',
          tag: 'msg-' + Date.now(),
        });
        const status = await sendWebPush(sub, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        if (status === 410 || status === 404) {
          await base44.asServiceRole.entities.User.update(u.id, { push_subscription: null });
        }
        results.push({ userId: u.id, status });
      }
      return Response.json({ ok: true, results });
    } catch (err) {
      return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  // ── Send push to a driver ─────────────────────────────────────────────────
  
  if (action === 'broadcast_trigger') {
    try {
      const availableDrivers = await base44.asServiceRole.entities.Driver.filter({ status: 'disponible' });
      const title = '📢 Viaje a todos los móviles';
      const bodyStr = orderData ? `${orderData.pickup_address}${orderData.dropoff_address ? ' → ' + orderData.dropoff_address : ''}` : 'Viaje a todos los móviles';
      
      const saStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
      let tokenRes = null;
      let sa = null;

      if (saStr) {
        sa = JSON.parse(saStr);
        if (sa.private_key) {
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
          const rsaKey = await crypto.subtle.importKey("pkcs8", binaryDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
          const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsaKey, new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`));
          const jwt = `${jwtHeader}.${jwtPayload}.${toBase64Url(signature)}`;
          
          tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
          }).then(r => r.json());
        }
      }

      for (const driver of availableDrivers) {
        if (!driver.current_base) continue;

        let sentViaFcm = false;
        if (driver.fcm_token && tokenRes && tokenRes.access_token) {
          const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenRes.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: {
                token: driver.fcm_token,
                android: { priority: "high" },
                data: { 
                  orderId: String(orderId), 
                  driverId: String(driver.id),
                  driverName: String(driver.name || ""),
                  base: String(driver.current_base || ""),
                  apiUrl: `https://base44.app/api/apps/${Deno.env.get('BASE44_APP_ID')}/functions/sendPushNotification/invoke`,
                  action: "open_ride",
                  title: String(title),
                  body: String(bodyStr),
                  type: "broadcast"
                }
              }
            })
          });
          if (fcmRes.ok) sentViaFcm = true;
        }

        if (!sentViaFcm && driver.push_subscription && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
          let sub;
          try { sub = JSON.parse(driver.push_subscription); } catch (_) { continue; }
          const payload = JSON.stringify({
            type: 'NEW_RIDE',
            orderId,
            driverId: driver.id,
            title,
            body: bodyStr,
            actions: [
              { action: 'accept', title: '✅ Tomar' },
              { action: 'reject', title: '❌ Ignorar' }
            ]
          });
          const status = await sendWebPush(sub, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
          if (status === 410 || status === 404) {
            await base44.asServiceRole.entities.Driver.update(driver.id, { push_subscription: null });
          }
        }
      }
      return Response.json({ ok: true, broadcast: true });
    } catch (err) {
      console.error("Broadcast trigger error:", err);
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  // ── Send push to a driver for a MESSAGE ──────────────────────────────────
  if (action === 'send_message') {
    if (!messageContent) {
      return Response.json({ error: 'Missing messageContent' }, { status: 400 });
    }

    try {
      const filter = targetDriverId ? { id: targetDriverId } : {};
      const drivers = await base44.asServiceRole.entities.Driver.filter(filter);
      
      const title = targetDriverId ? '💬 Mensaje Privado' : '📡 Mensaje de la Base';
      const body = messageContent;

      const results = [];
      let sa = null;
      let tokenRes = null;
      
      const saStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
      if (saStr) {
        try {
          sa = JSON.parse(saStr);
          if (sa.private_key) {
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
            const rsaKey = await crypto.subtle.importKey("pkcs8", binaryDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
            const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsaKey, new TextEncoder().encode(`${jwtHeader}.${jwtPayload}`));
            const jwt = `${jwtHeader}.${jwtPayload}.${toBase64Url(signature)}`;
            
            tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
            }).then(r => r.json());
          }
        } catch(e) {}
      }

      for (const driver of drivers) {
        let sentViaFcm = false;
        if (driver.fcm_token && tokenRes && tokenRes.access_token) {
          const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${tokenRes.access_token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              message: {
                token: driver.fcm_token,
                notification: { title: String(title), body: String(body) },
                android: { priority: "high", notification: { channel_id: "ride-alerts-urgent" } },
                data: { 
                  action: "open_messages",
                  title: String(title),
                  body: String(body),
                  type: "message"
                }
              }
            })
          });
          if (fcmRes.ok) {
            results.push({ driverId: driver.id, ok: true, via: 'fcm' });
            sentViaFcm = true;
          }
        }

        if (!sentViaFcm && driver.push_subscription && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
          let sub;
          try { sub = JSON.parse(driver.push_subscription); } catch (_) { continue; }
          const payload = JSON.stringify({
            type: 'NEW_MESSAGE',
            title,
            body,
            url: '/driver-app',
            tag: 'msg-' + Date.now(),
          });
          const status = await sendWebPush(sub, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
          if (status === 410 || status === 404) {
            await base44.asServiceRole.entities.Driver.update(driver.id, { push_subscription: null });
          }
          results.push({ driverId: driver.id, ok: status >= 200 && status < 300, via: 'webpush', status });
        }
      }

      return Response.json({ ok: true, results });
    } catch (err) {
      return Response.json({ ok: false, reason: 'send_error', error: err.message });
    }
  }

  if (action === 'send') {
    if (!driverId || !orderId) {
      return Response.json({ error: 'Missing driverId or orderId' }, { status: 400 });
    }

    try {
      const drivers = await base44.asServiceRole.entities.Driver.filter({ id: driverId });
      const driver = drivers[0];
      
      const title = '🚖 ¡NUEVO VIAJE!';
      const body = orderData ? `${orderData.pickup_address}${orderData.dropoff_address ? ' → ' + orderData.dropoff_address : ''}${orderData.fare ? ' · $' + orderData.fare : ''}` : 'Tenés un viaje asignado';

      // 1. Intentar FCM nativo primero (Garantiza despertar a Samsung)
      if (driver?.fcm_token) {
        const saStr = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
        if (saStr) {
          const sa = JSON.parse(saStr);
          if (!sa.private_key) {
            console.error("Error: FIREBASE_SERVICE_ACCOUNT no contiene private_key. Parece google-services.json en lugar de un Service Account Key.");
          } else {
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

            if (tokenRes.access_token) {
              const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${tokenRes.access_token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  message: {
                    token: driver.fcm_token,
                    android: { priority: "high" },
                    data: { 
                      orderId: String(orderId), 
                      driverId: String(driverId),
                      driverName: String(driver.name || ""),
                      base: String(driver.current_base || ""),
                      apiUrl: `https://base44.app/api/apps/${Deno.env.get('BASE44_APP_ID')}/functions/sendPushNotification/invoke`,
                      action: "open_ride",
                      title: String(title),
                      body: String(body),
                      type: isBroadcast ? "broadcast" : "ofrecido"
                    }
                  }
                })
              });
              if (fcmRes.ok) return Response.json({ ok: true, via: 'fcm' });
            }
          }
        }
      }

      // 2. Fallback a Web Push
      if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return Response.json({ error: 'VAPID keys not configured' }, { status: 500 });
      }

      if (!driver?.push_subscription) return Response.json({ ok: false, reason: 'no_subscription' });

      let sub;
      try { sub = JSON.parse(driver.push_subscription); } catch (_) {
        return Response.json({ ok: false, reason: 'invalid_subscription' });
      }

      const payload = JSON.stringify({
        type: 'NEW_RIDE',
        orderId,
        driverId,
        title,
        body,
        actions: [
          { action: 'accept', title: '✅ Aceptar' },
          { action: 'reject', title: '❌ Rechazar' }
        ]
      });

      const status = await sendWebPush(sub, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

      // If subscription is expired/invalid, clean it
      if (status === 410 || status === 404) {
        await base44.asServiceRole.entities.Driver.update(driverId, { push_subscription: null });
        return Response.json({ ok: false, reason: 'subscription_expired', status });
      }

      const success = status >= 200 && status < 300;
      if (!success) {
        console.warn(`Push failed for driver ${driverId}: status ${status}`);
      }
      return Response.json({ ok: success, status });
    } catch (err) {
      console.error(`Push error for driver ${driverId}:`, err.message);
      return Response.json({ ok: false, reason: 'send_error', error: err.message });
    }
  }

  // ── Get VAPID public key (for frontend subscription) ─────────────────────
  if (action === 'vapid_public_key') {
    return Response.json({ publicKey: VAPID_PUBLIC_KEY });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});