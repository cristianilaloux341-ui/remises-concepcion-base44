Deno.serve(async (_req) => Response.json({
  success:false,
  disabled:true,
  reason:'LEGACY_EXPLICIT_REJECT_DISABLED_USE_REJECT_RIDE'
},{status:410}));