import { differenceInDays, parseISO } from "date-fns";
import { AlertTriangle, XCircle, Ban, DollarSign, StickyNote } from "lucide-react";

function fechaAlerta(fecha) {
  if (!fecha) return "vencida";
  const dias = differenceInDays(parseISO(fecha), new Date());
  if (dias < 0) return "vencida";
  if (dias <= 30) return "proxima";
  return "ok";
}

export default function MovilAlertBanner({ movil }) {
  if (!movil) return null;

  const alerts = [];

  // 1. VTV
  const vtvSt = fechaAlerta(movil.vtv_vencimiento);
  if (!movil.vtv_vencimiento || vtvSt !== "ok") {
    alerts.push({
      nivel: vtvSt === "vencida" || !movil.vtv_vencimiento ? "error" : "warn",
      texto: `⚠️ VTV ${!movil.vtv_vencimiento ? "sin fecha" : vtvSt === "vencida" ? "vencida" : "por vencer (próx. 30 días)"}`,
    });
  }

  // 2. Seguro automotor
  const segAutoSt = fechaAlerta(movil.seguro_automotor_vencimiento);
  if (!movil.seguro_automotor_vencimiento || segAutoSt !== "ok") {
    alerts.push({
      nivel: segAutoSt === "vencida" || !movil.seguro_automotor_vencimiento ? "error" : "warn",
      texto: `⚠️ Seguro automotor ${!movil.seguro_automotor_vencimiento ? "sin fecha" : segAutoSt === "vencida" ? "vencido" : "por vencer (próx. 30 días)"}`,
    });
  }

  // 3. Seguro riesgos personales
  const segRpSt = fechaAlerta(movil.seguro_riesgos_personales_vencimiento);
  if (!movil.seguro_riesgos_personales_vencimiento || segRpSt !== "ok") {
    alerts.push({
      nivel: segRpSt === "vencida" || !movil.seguro_riesgos_personales_vencimiento ? "error" : "warn",
      texto: `⚠️ Seguro de riesgos personales ${!movil.seguro_riesgos_personales_vencimiento ? "sin fecha" : segRpSt === "vencida" ? "vencido" : "por vencer (próx. 30 días)"}`,
    });
  }

  // 4. Buena conducta
  const bcSt = fechaAlerta(movil.buena_conducta_vencimiento);
  if (!movil.buena_conducta || !movil.buena_conducta_vencimiento || bcSt !== "ok") {
    alerts.push({
      nivel: (!movil.buena_conducta || bcSt === "vencida" || !movil.buena_conducta_vencimiento) ? "error" : "warn",
      texto: `⚠️ Certificado de buena conducta ${!movil.buena_conducta ? "no vigente" : !movil.buena_conducta_vencimiento ? "sin fecha" : bcSt === "vencida" ? "vencido" : "por vencer (próx. 30 días)"}`,
    });
  }

  // 5. Pago semanal
  if (movil.pago_semanal_al_dia === false) {
    alerts.push({ nivel: "danger", texto: "🔴 Pago semanal pendiente" });
  }

  // 6. Deuda
  if ((movil.deuda_monto || 0) > 0) {
    alerts.push({
      nivel: "danger",
      texto: `🔴 Deuda pendiente: $${Number(movil.deuda_monto).toLocaleString("es-AR")}${movil.deuda_notas ? ` — ${movil.deuda_notas}` : ""}`,
    });
  }

  // 7. Suspendido
  if (movil.suspension_motivo) {
    alerts.push({ nivel: "danger", texto: `🚫 Móvil suspendido: ${movil.suspension_motivo}` });
  }

  // 8. Fuera de servicio
  if (movil.fuera_de_servicio) {
    const motivos = {
      falta_de_pago: "Falta de pago",
      falta_de_papeles: "Falta de papeles",
      baja_voluntaria: "Baja voluntaria",
      sancion_disciplinaria: "Sanción disciplinaria",
      otro: "Otro",
    };
    const motivoLabel = motivos[movil.fuera_de_servicio_motivo] || movil.fuera_de_servicio_motivo || "";
    alerts.push({
      nivel: "danger",
      texto: `🚫 Fuera de servicio${motivoLabel ? `: ${motivoLabel}` : ""}${movil.fuera_de_servicio_detalle ? ` — ${movil.fuera_de_servicio_detalle}` : ""}`,
    });
  }

  // 9. Notas
  if (movil.notas?.trim()) {
    alerts.push({ nivel: "info", texto: `📌 Nota: ${movil.notas.trim()}` });
  }

  if (alerts.length === 0) return null;

  const styles = {
    danger: "bg-red-600 text-white border-red-700",
    error:  "bg-red-100 text-red-800 border-red-300",
    warn:   "bg-amber-50 text-amber-800 border-amber-300",
    info:   "bg-blue-50 text-blue-800 border-blue-200",
  };

  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 overflow-hidden mb-4">
      <div className="flex items-center gap-2 bg-red-600 px-4 py-2">
        <AlertTriangle className="w-4 h-4 text-white shrink-0" />
        <p className="text-white font-bold text-sm uppercase tracking-wide">
          {alerts.length} alerta{alerts.length > 1 ? "s" : ""} pendiente{alerts.length > 1 ? "s" : ""}
        </p>
      </div>
      <div className="divide-y divide-red-100">
        {alerts.map((a, i) => (
          <div key={i} className={`px-4 py-2.5 text-sm font-medium border-l-4 ${
            a.nivel === "danger" ? "border-l-red-600 bg-red-100 text-red-900" :
            a.nivel === "error"  ? "border-l-red-500 bg-red-50 text-red-800" :
            a.nivel === "warn"   ? "border-l-amber-400 bg-amber-50 text-amber-800" :
                                   "border-l-blue-400 bg-blue-50 text-blue-800"
          }`}>
            {a.texto}
          </div>
        ))}
      </div>
    </div>
  );
}