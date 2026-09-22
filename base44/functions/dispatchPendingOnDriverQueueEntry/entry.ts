Deno.serve(async (_req) => Response.json({
  success:false,
  disabled:true,
  reason:'LEGACY_PENDING_AUTO_DISPATCH_DISABLED'
},{status:410}));