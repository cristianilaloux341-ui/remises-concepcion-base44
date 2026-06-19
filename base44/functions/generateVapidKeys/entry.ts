import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  // Generar par de claves ECDH P-256 para VAPID
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  // Convertir a Base64 URL-safe (formato VAPID estándar)
  const toBase64Url = (buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  return Response.json({
    publicKey: toBase64Url(publicKeyBuffer),
    privateKey: toBase64Url(privateKeyBuffer),
    instructions: "Copiar estos valores como secrets VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY"
  });
});