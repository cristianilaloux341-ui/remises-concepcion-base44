import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
Deno.serve(async (req) => {
  return Response.json({
    url: req.url,
    headers: Object.fromEntries(req.headers.entries())
  });
});