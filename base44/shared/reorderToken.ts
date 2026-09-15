export async function signReorderToken(driverId: string, baseName: string, authoritativeAtIso: string): Promise<string> {
  const secret = Deno.env.get('INTERNAL_SERVICE_KEY');
  if (!secret) throw new Error('SECURITY_BLOCK: INTERNAL_SERVICE_KEY no configurada.');
  
  const data = `${driverId}|${baseName}|${authoritativeAtIso}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const hashArray = Array.from(new Uint8Array(sig));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyReorderToken(token: string | null, driverId: string, baseName: string | null, authoritativeAtIso: string | null): Promise<boolean> {
  if (!token || !authoritativeAtIso || !baseName) return false;
  const secret = Deno.env.get('INTERNAL_SERVICE_KEY');
  if (!secret) return false;

  const data = `${driverId}|${baseName}|${authoritativeAtIso}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const hashArray = Array.from(new Uint8Array(sig));
  const expected = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === token;
}