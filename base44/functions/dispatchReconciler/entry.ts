import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { runReconciliation } from '../../shared/DispatchReconciler.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Feature Flag Check - Do not run if legacy or live dispatch is active in ways that prevent safe reconciliation
    const configs = await base44.asServiceRole.entities.DispatchConfig.list();
    if (configs.some(c => c.backendDispatchEnabled)) {
       return Response.json({ error: "Reconciliation aborted: backendDispatchEnabled is active." }, { status: 403 });
    }

    const payload = await req.json().catch(() => ({}));
    const graceMs = payload.graceMs ?? 30000;

    const report = await runReconciliation(base44.asServiceRole, { graceMs });

    return Response.json({
      success: true,
      message: "Reconciliation complete",
      report
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});