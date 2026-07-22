import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Note: Ensure FIREBASE_SERVICE_ACCOUNT is set in secrets
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  const payload = await req.json();
  const { driverId, fcmToken } = payload;

  let targetToken = fcmToken;
  
  if (!targetToken && driverId) {
    const driver = await b44.entities.Driver.get(driverId);
    if (!driver) {
      return Response.json({ success: false, reason: "Driver not found" });
    }
    targetToken = driver.fcm_token;
  }

  if (!targetToken) {
    return Response.json({ success: false, reason: "No FCM token provided or found for driver" });
  }

  const tokenPrefix = targetToken.substring(0, 15) + '...';

  let firebaseProjectId = "unknown";
  let accessToken = "";
  try {
    const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "{}");
    firebaseProjectId = serviceAccount.project_id || "unknown";

    // Standard JWT generation for Firebase
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      (function(pem) {
        const b64 = pem.replace(/(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g, '');
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for(let i=0; i<bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf;
      })(serviceAccount.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const now = Math.floor(Date.now() / 1000);
    const claim = btoa(JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    }));

    const signatureBytes = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(`${header}.${claim}`)
    );
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = `${header}.${claim}.${signature}`;

    const authRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const authData = await authRes.json();
    if (!authData.access_token) {
       throw new Error("Failed to get Firebase access token");
    }
    accessToken = authData.access_token;
  } catch (err) {
    return Response.json({ success: false, reason: "Firebase auth setup failed: " + err.message });
  }

  const fcmPayload = {
    message: {
      token: targetToken,
      notification: {
        title: "Prueba Evoloux",
        body: "Notificación FCM directa"
      },
      data: {
        type: "test_push",
        timestamp: Date.now().toString()
      },
      android: {
        priority: "high",
        notification: {
          channel_id: "ride_alerts",
          sound: "default"
        }
      }
    }
  };

  await b44.entities.AuditLog.create({
    action: 'PUSH_TEST_STARTED',
    user_type: 'sistema',
    user_name: 'testFCMPush',
    details: `Iniciando test FCM a token ${tokenPrefix}`,
    metadata: {
      projectId: firebaseProjectId,
      payload: fcmPayload
    }
  }).catch(() => {});

  try {
    const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseProjectId}/messages:send`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(fcmPayload)
    });

    const status = fcmRes.status;
    const fcmData = await fcmRes.json();

    const logData = {
      action: status === 200 ? 'PUSH_TEST_SUCCEEDED' : 'PUSH_TEST_FAILED',
      user_type: 'sistema',
      user_name: 'testFCMPush',
      details: status === 200 ? `Test FCM exitoso (HTTP ${status})` : `Test FCM fallido (HTTP ${status})`,
      metadata: {
        status,
        messageId: fcmData.name || null,
        error: fcmData.error || null,
        projectId: firebaseProjectId,
        tokenPrefix
      }
    };

    await b44.entities.AuditLog.create(logData).catch(() => {});

    return Response.json({
      success: status === 200,
      status,
      projectId: firebaseProjectId,
      messageId: fcmData.name || null,
      error: fcmData.error || null,
      payloadUsed: fcmPayload,
      tokenPrefix
    });

  } catch (err) {
    return Response.json({ success: false, reason: err.message, tokenPrefix, projectId: firebaseProjectId });
  }
});