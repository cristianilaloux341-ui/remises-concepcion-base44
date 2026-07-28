import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
Deno.serve(async (req) => {
  const payload = await req.json().catch(() => ({}));
  const INTERNAL_KEY = Deno.env.get("INTERNAL_SERVICE_KEY");
  if (!payload.internalKey || !INTERNAL_KEY || payload.internalKey !== INTERNAL_KEY) {
    return Response.json({ error: "Unauthorized. Internal Service Key missing." }, { status: 401 });
  }
  return Response.json({
    url: req.url,
    headers: Object.fromEntries(req.headers.entries())
  });
});