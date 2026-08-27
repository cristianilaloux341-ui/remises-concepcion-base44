import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { createJWT } from '../../shared/security.ts';

async function legacyClientHash(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password + 'CLIENT_SALT_44');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const b44 = base44.asServiceRole;
  try {
    const { phone, password } = await req.json();
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone || !password) return Response.json({ success:false, reason:'missing_credentials' }, { status:400 });

    const clients = await b44.entities.Client.filter({ phone: cleanPhone });
    if (!clients?.length) return Response.json({ success:false, reason:'invalid_credentials' }, { status:401 });
    const client = clients[0];
    const inputHash = await legacyClientHash(String(password));
    if (!client.password_hash || client.password_hash !== inputHash) return Response.json({ success:false, reason:'invalid_credentials' }, { status:401 });

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const sessionToken = await createJWT({ id: client.id, role:'client', exp:expiresAt });
    return Response.json({ success:true, client:{ id:client.id, name:client.name, phone:client.phone }, sessionToken, expiresAt });
  } catch (e:any) {
    return Response.json({ success:false, reason:e?.message || 'error' }, { status:500 });
  }
});
