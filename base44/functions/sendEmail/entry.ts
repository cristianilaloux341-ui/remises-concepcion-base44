import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { to, subject, body, from_name } = payload;
    
    let isAuthorized = await verifyRequestAuth(base44.asServiceRole, payload, { allowOperator: true });
    if (!isAuthorized && await base44.auth.isAuthenticated()) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return Response.json({ error: "Unauthorized. Se requiere sessionToken o internalKey." }, { status: 401 });
    }

    if (!to || !subject || !body) {
      return Response.json({ error: "Faltan campos: to, subject, body" }, { status: 400 });
    }

    // Validar destino contra whitelist (Relé de correo abierto)
    const operadores = await base44.asServiceRole.entities.Operator.filter({ email: to });
    if (operadores.length === 0) {
      const systemUsers = await base44.asServiceRole.entities.User.filter({ email: to });
      if (systemUsers.length === 0) {
        return Response.json({ error: "DESTINO_NO_AUTORIZADO" }, { status: 403 });
      }
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return Response.json({ error: "RESEND_API_KEY no configurada" }, { status: 500 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${from_name || "Central de Despacho"} <onboarding@resend.dev>`,
        to: [to],
        subject,
        text: body,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return Response.json({ error: data.message || "Error al enviar email" }, { status: res.status });
    }

    return Response.json({ success: true, id: data.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});