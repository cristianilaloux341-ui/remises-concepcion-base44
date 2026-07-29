/**
 * Módulo centralizado de seguridad.
 * Reemplaza las validaciones dispersas y los secretos en texto plano.
 */

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
    const decodedStr = atob(sessionToken);
    const tokenData = JSON.parse(decodedStr);

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
  const msgUint8 = new TextEncoder().encode(pinText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}