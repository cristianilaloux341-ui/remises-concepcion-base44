import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const isAuth = await base44.auth.isAuthenticated();
    const origin = req.headers.get("origin") || "";
    const appOrigin = Deno.env.get("BASE44_APP_ID") ? true : false;

    if (!isAuth && !origin.includes("base44")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { to, subject, body, from_name } = await req.json();
    if (!to || !subject || !body) {
      return Response.json({ error: "Faltan campos: to, subject, body" }, { status: 400 });
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