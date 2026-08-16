import { createClientFromRequest } from "npm:@base44/sdk@0.8.40";
import { verifyJWT } from "../../shared/security.ts";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const alertId = String(body.alertId || "");
    const sessionToken = String(body.sessionToken || "");

    if (!alertId) return Response.json({ success: false, error: "Falta el ID de la alerta." }, { status: 400 });

    let operator: any = null;
    if (sessionToken) {
      const tokenData = await verifyJWT(sessionToken);
      if (tokenData?.id && tokenData?.exp && Date.now() < tokenData.exp) {
        const operators = await base44.asServiceRole.entities.UsuariosSistema.filter({ id: tokenData.id });
        if (operators[0]?.activo) operator = operators[0];
      }
    } else {
      const user = await base44.auth.me().catch(() => null);
      if (user?.role === "admin") operator = { id: user.id, name: user.full_name || user.email || "Administrador" };
    }

    if (!operator) {
      return Response.json({ success: false, error: "Sesión de operador inválida o vencida." }, { status: 403 });
    }

    const alert = await base44.asServiceRole.entities.PanicAlert.get(alertId).catch(() => null);
    if (!alert) return Response.json({ success: true, idempotent: true, status: "no_encontrada" });
    if (alert.status !== "activo") {
      return Response.json({ success: true, idempotent: true, status: alert.status });
    }

    const resolvedAt = new Date().toISOString();
    const resolvedByName = operator.name || operator.nombre || operator.email || "Operador";
    const result = await base44.asServiceRole.entities.PanicAlert.updateMany(
      { id: alertId, status: "activo" },
      {
        $set: {
          status: "atendido",
          resolved_at: resolvedAt,
          resolved_by_id: operator.id,
          resolved_by_name: resolvedByName,
        }
      }
    );

    const changed = (result.matchedCount ?? result.modifiedCount ?? result.updated ?? 0) === 1;
    if (changed) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: "PANIC_ALERT_RESOLVED",
        user_type: operator.rol || operator.role || "operador",
        user_name: resolvedByName,
        details: `Alerta de pánico atendida: ${alert.driver_name || "Sin nombre"} (${alert.vehicle_plate || "sin patente"})`,
        metadata: { alert_id: alertId, driver_id: alert.driver_id, resolved_at: resolvedAt },
      }).catch(() => {});
    }

    return Response.json({ success: true, idempotent: !changed, status: "atendido" });
  } catch (error: any) {
    return Response.json({ success: false, error: error?.message || "No se pudo atender la alerta." }, { status: 500 });
  }
});
