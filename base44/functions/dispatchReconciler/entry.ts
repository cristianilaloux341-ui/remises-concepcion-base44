import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { runReconciliation } from '../../shared/DispatchReconciler.ts';
import { verifyRequestAuth } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const b44 = base44.asServiceRole;
    const payload = await req.json().catch(() => ({}));
    
    // Requiere Internal Service Key verificada
    if (!(await verifyRequestAuth(b44, payload))) {
      return Response.json({ error: "Unauthorized. Internal Service Key missing or invalid." }, { status: 401 });
    }
    
    // 1. Exclusión Mutua para Reconciliador
    const RECONCILER_LOCK_ZONE = 'GLOBAL_RECONCILER';
    let lockConfigs = await b44.entities.DispatchConfig.filter({ zone: RECONCILER_LOCK_ZONE });
    if (lockConfigs.length === 0) {
      await b44.entities.DispatchConfig.create({ zone: RECONCILER_LOCK_ZONE, notes: '0' });
      lockConfigs = await b44.entities.DispatchConfig.filter({ zone: RECONCILER_LOCK_ZONE });
    }
    
    const lastRun = parseInt(lockConfigs[0].notes || '0', 10);
    const now = Date.now();
    
    // Límite de frecuencia: ejecutar máximo 1 vez cada 60 segundos
    if (now - lastRun < 60000) {
      return Response.json({ status: 'skipped', reason: 'locked_or_too_frequent' });
    }
    
    // Tomar el lock actualizando la fecha
    await b44.entities.DispatchConfig.updateMany(
      { zone: RECONCILER_LOCK_ZONE }, 
      { $set: { notes: now.toString() } }
    );

    // 2. Ejecutar reconciliación con período de gracia (default 60s)
    const graceMs = payload.graceMs ?? 60000;
    
    // runReconciliation ya procesa internamente un lote acotado por las entidades anómalas
    const report = await runReconciliation(b44, { graceMs });

    // 3. Alertas Globales ante anomalías sin resolución
    const manualReviews = report.results.filter(r => r.status === 'manual_review_required');
    if (manualReviews.length > 0) {
       await b44.entities.Message.create({
         from_type: 'sistema',
         from_name: 'RECONCILIADOR',
         content: `ALERTA CRÍTICA: Se requieren ${manualReviews.length} revisiones manuales por inconsistencias en los tokens atómicos. Revise AuditLog inmediatamente.`,
         read: false
       });
    }

    return Response.json({ success: true, message: "Reconciliation complete", report });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});