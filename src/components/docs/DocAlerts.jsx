import { useState } from "react";
import { differenceInDays, parseISO, format } from "date-fns";
import { AlertTriangle, CheckSquare, Square, ChevronDown, ChevronUp, XCircle, Clock } from "lucide-react";

// Evalúa una fecha de vencimiento: retorna null si no hay fecha, o { dias, vencido, porVencer }
export function evalVencimiento(fecha) {
  if (!fecha) return null;
  const dias = differenceInDays(parseISO(fecha), new Date());
  return { dias, vencido: dias < 0, porVencer: dias >= 0 && dias <= 30 };
}

// Documentos requeridos para reinscripción (Móvil)
const DOCS_REINSCRIPCION_MOVIL = [
  { key: "vtv_vencimiento",                        label: "VTV / RTO vigente" },
  { key: "seguro_automotor_vencimiento",            label: "Seguro Automotor vigente" },
  { key: "seguro_riesgos_personales_vencimiento",   label: "Seguro de Riesgos Personales vigente" },
  { key: "buena_conducta_vencimiento",              label: "Certificado de Buena Conducta" },
  { key: "pago_semanal_al_dia",                     label: "Pago semanal al día", boolean: true },
];

// ─── Componente de alerta detallada de vencimientos ───────────────────────────
// Muestra banner rojo/amarillo con lista de documentos vencidos o por vencer
export function DocVencimientosAlert({ nombre, campos }) {
  // campos: [{ label: "VTV", fecha: "2025-01-10" }, ...]
  const vencidos = campos.filter(c => c.fecha && evalVencimiento(c.fecha)?.vencido);
  const proximos = campos.filter(c => c.fecha && evalVencimiento(c.fecha)?.porVencer);
  const boolFalsos = campos.filter(c => c.boolean && c.valor === false);

  const problemas = [...vencidos, ...proximos, ...boolFalsos];
  if (problemas.length === 0) return null;

  const tieneVencidos = vencidos.length > 0 || boolFalsos.length > 0;

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${tieneVencidos
      ? "bg-red-50 border-red-300"
      : "bg-amber-50 border-amber-300"
    }`}>
      <AlertTriangle className={`w-5 h-5 shrink-0 mt-0.5 ${tieneVencidos ? "text-red-500" : "text-amber-500"}`} />
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${tieneVencidos ? "text-red-700" : "text-amber-700"}`}>
          {nombre} — Documentación con problemas
        </p>
        <ul className="mt-1 space-y-0.5">
          {vencidos.map(c => (
            <li key={c.label} className="flex items-center gap-1.5 text-xs text-red-700">
              <XCircle className="w-3 h-3 shrink-0" />
              <span><strong>{c.label}</strong> — Vencido hace {Math.abs(evalVencimiento(c.fecha).dias)} días ({format(parseISO(c.fecha), "dd/MM/yyyy")})</span>
            </li>
          ))}
          {boolFalsos.map(c => (
            <li key={c.label} className="flex items-center gap-1.5 text-xs text-red-700">
              <XCircle className="w-3 h-3 shrink-0" />
              <span><strong>{c.label}</strong></span>
            </li>
          ))}
          {proximos.map(c => (
            <li key={c.label} className="flex items-center gap-1.5 text-xs text-amber-700">
              <Clock className="w-3 h-3 shrink-0" />
              <span><strong>{c.label}</strong> — Vence en {evalVencimiento(c.fecha).dias} días ({format(parseISO(c.fecha), "dd/MM/yyyy")})</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Panel de reinscripción con checklist tildable ────────────────────────────
export function ReinscripcionPanel({ nombre, campos, onClose }) {
  const [checked, setChecked] = useState({});
  const [open, setOpen] = useState(true);

  const toggle = (key) => setChecked(p => ({ ...p, [key]: !p[key] }));
  const completados = DOCS_REINSCRIPCION_MOVIL.filter(d => checked[d.key]).length;
  const total = DOCS_REINSCRIPCION_MOVIL.length;
  const pct = Math.round((completados / total) * 100);

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-sm text-blue-800">
            Reinscripción — {nombre}
          </span>
          <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full font-medium">
            {completados}/{total}
          </span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-blue-500" /> : <ChevronDown className="w-4 h-4 text-blue-500" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Barra de progreso */}
          <div className="w-full bg-blue-200 rounded-full h-1.5">
            <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>

          <ul className="space-y-2">
            {DOCS_REINSCRIPCION_MOVIL.map(doc => {
              const done = !!checked[doc.key];
              // Estado actual del campo
              let estadoActual = null;
              if (doc.boolean) {
                const val = campos.find(c => c.key === doc.key)?.valor;
                if (val === false) estadoActual = <span className="text-xs text-red-600 ml-1">⚠ pendiente</span>;
              } else {
                const campo = campos.find(c => c.key === doc.key);
                if (campo?.fecha) {
                  const ev = evalVencimiento(campo.fecha);
                  if (ev?.vencido) estadoActual = <span className="text-xs text-red-600 ml-1">Vencido</span>;
                  else if (ev?.porVencer) estadoActual = <span className="text-xs text-amber-600 ml-1">Por vencer</span>;
                } else {
                  estadoActual = <span className="text-xs text-gray-400 ml-1">Sin fecha</span>;
                }
              }

              return (
                <li key={doc.key}>
                  <button
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all ${
                      done
                        ? "bg-green-50 border-green-200"
                        : "bg-white border-gray-200 hover:border-blue-300"
                    }`}
                    onClick={() => toggle(doc.key)}
                  >
                    {done
                      ? <CheckSquare className="w-4 h-4 text-green-500 shrink-0" />
                      : <Square className="w-4 h-4 text-gray-400 shrink-0" />
                    }
                    <span className={`text-sm flex-1 ${done ? "line-through text-gray-400" : "text-gray-700"}`}>
                      {doc.label}
                    </span>
                    {!done && estadoActual}
                  </button>
                </li>
              );
            })}
          </ul>

          {completados === total && (
            <div className="text-center py-2 text-green-700 font-semibold text-sm bg-green-50 rounded-lg border border-green-200">
              ✅ Reinscripción completa
            </div>
          )}
        </div>
      )}
    </div>
  );
}