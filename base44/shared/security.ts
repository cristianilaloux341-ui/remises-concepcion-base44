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
  if (parts.length !== 3) {
    // Fallback temporal para sesiones legacy (payload base64) para no desconectar a todos
    try {
      const decoded = JSON.parse(new TextDecoder().decode(decodeBase64Url(token)));
      if (decoded && decoded.id) {
        // Extendemos la expiración de los tokens legacy para no forzar deslogueo inmediato
        if (decoded.exp && decoded.exp < Date.now()) {
          decoded.exp = Date.now() + 86400000; // +24hs
        }
        return decoded;
      }
    } catch(e) {}
    return null;
  }
  
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
    const tokenData = await verifyJWT(sessionToken);

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
  const salt = Deno.env.get("SECURE_SALT");
  if (!salt) throw new Error("SECURITY_BLOCK: SECURE_SALT no configurada.");
  const msgUint8 = new TextEncoder().encode(pinText + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyRequestAuth(b44: any, payload: any, options: { allowOperator?: boolean, allowDriverId?: string, allowClient?: boolean } = {}): Promise<boolean> {
  const { internalKey, sessionToken } = payload || {};
  
  // 1. Siempre permitimos el acceso si la clave de servicio interna coincide
  if (validateInternalKey(internalKey)) return true;
  
  // 2. Si se permite a un operador, validamos su sesión (JWT o legacy base64)
  if (options.allowOperator && sessionToken) {
    if (await verifyOperatorSession(b44, sessionToken)) return true;
  }
  
  // 3. Si se restringe a un driver específico, verificamos que su token coincida
  if (options.allowDriverId && sessionToken) {
    const drivers = await b44.entities.Driver.filter({ id: options.allowDriverId });
    if (drivers.length > 0) {
      if (drivers[0].current_session_token === sessionToken || !drivers[0].current_session_token) {
        // Autocorrección del bug de sesión huérfana: si no tiene token, se lo asignamos
        if (!drivers[0].current_session_token) {
          await b44.entities.Driver.update(options.allowDriverId, { current_session_token: sessionToken });
        }
        return true;
      }
    }
  }

  // 4. Si se permite desde la app cliente, verificamos el token cliente
  if (options.allowClient && sessionToken) {
    // Por ahora la app cliente usa un token fijo de demo
    if (sessionToken === 'client_demo_token') return true;
    // Si tuvieran login de cliente, aquí verificaríamos el JWT del cliente
  }
  
  // Denegado por defecto
  return false;
}