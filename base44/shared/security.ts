/**
 * Módulo centralizado de seguridad.
 * Reemplaza las validaciones dispersas y los secretos en texto plano.
 */

function encodeBase64Url(str: string | Uint8Array): string {
  const uint8 = typeof str === 'string' ? new TextEncoder().encode(str) : str;
  let binStr = "";
  for (let i = 0; i < uint8.length; i++) binStr += String.fromCharCode(uint8[i]);
  return btoa(binStr).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeBase64Url(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binStr = atob(b64);
  const uint8 = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) uint8[i] = binStr.charCodeAt(i);
  return uint8;
}

export async function createJWT(payload: any): Promise<string> {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret) throw new Error("SECURITY_BLOCK: JWT_SECRET no configurada.");
  
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = encodeBase64Url(JSON.stringify(header));
  const encPayload = encodeBase64Url(JSON.stringify(payload));
  const dataToSign = `${encHeader}.${encPayload}`;
  
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataToSign));
  return `${dataToSign}.${encodeBase64Url(new Uint8Array(sig))}`;
}

export async function verifyJWT(token: string): Promise<any> {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret) return null;
  
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  const [header, payload, signature] = parts;
  const dataToSign = `${header}.${payload}`;
  
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const isValid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), new TextEncoder().encode(dataToSign));
  
  if (!isValid) return null;
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
}

export function validateInternalKey(providedKey?: string): boolean {
  const validKey = Deno.env.get("INTERNAL_SERVICE_KEY");
  if (!validKey || validKey.trim() === "") {
    console.error("SECURITY BLOCK: INTERNAL_SERVICE_KEY no configurada.");
    return false;
  }
  return providedKey === validKey;
}

export async function verifyOperatorSession(b44: any, sessionToken?: string): Promise<boolean> {
  if (!sessionToken) return false;
  try {
    let tokenData: any = null;
    
    // Lazy Migration: intentamos validar como JWT (3 partes) o como Base64 (legacy)
    if (sessionToken.split('.').length === 3) {
      tokenData = await verifyJWT(sessionToken);
    } else {
      const decodedStr = atob(sessionToken);
      tokenData = JSON.parse(decodedStr);
    }

    if (!tokenData || !tokenData.id || !tokenData.exp || Date.now() > tokenData.exp) {
      return false;
    }

    const ops = await b44.entities.UsuariosSistema.filter({ id: tokenData.id });
    if (ops && ops.length > 0 && ops[0].activo) {
      return true;
    }
  } catch (err) {
    console.error("SECURITY BLOCK: Invalid token format.");
  }
  return false;
}

export async function hashPin(pinText: string): Promise<string> {
  // Transición segura: usamos la nueva sal, o la vieja si la nueva falla en un entorno viejo.
  const salt = Deno.env.get("SECURE_SALT") || Deno.env.get("AUTH_SALT") || "fallback_secure_salt_2026";
  const msgUint8 = new TextEncoder().encode(pinText + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}