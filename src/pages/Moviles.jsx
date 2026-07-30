import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Car, Plus, Edit, AlertTriangle, CheckCircle2, XCircle, Search, ClipboardList, Ban, PauseCircle, X, ArrowLeft, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format, differenceInDays, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { DocVencimientosAlert, ReinscripcionPanel } from "@/components/docs/DocAlerts";
import MovilAlertBanner from "@/components/moviles/MovilAlertBanner";
import { getDriverDisplay } from "@/lib/utils";

const EMPTY_MOVIL = {
  numero_movil: "",
  apellido_nombre: "",
  dni: "",
  fecha_nacimiento: "",
  direccion: "",
  dominio: "",
  marca: "",
  modelo: "",
  color: "",
  carnet_categoria: "",
  vtv_vencimiento: "",
  seguro_riesgos_personales_vencimiento: "",
  seguro_automotor_vencimiento: "",
  pago_semanal_al_dia: true,
  pago_semanal_fecha: "",
  deuda_monto: 0,
  deuda_notas: "",
  buena_conducta: true,
  buena_conducta_vencimiento: "",
  activo: true,
  suspension_motivo: "",
  fuera_de_servicio: false,
  fuera_de_servicio_motivo: "",
  fuera_de_servicio_detalle: "",
  notas: "",
};

function vencimientoStatus(fecha) {
  if (!fecha) return null;
  try {
    const dias = differenceInDays(parseISO(fecha), new Date());
    if (dias < 0) return { color: "text-red-600 bg-red-50 border-red-200", label: "Vencido", icon: XCircle };
    if (dias <= 30) return { color: "text-amber-600 bg-amber-50 border-amber-200", label: `Vence en ${dias}d`, icon: AlertTriangle };
    return { color: "text-green-600 bg-green-50 border-green-200", label: format(parseISO(fecha), "dd/MM/yyyy"), icon: CheckCircle2 };
  } catch (_) {
    return null;
  }
}

function VencimientoBadge({ fecha, label }) {
  const st = vencimientoStatus(fecha);
  if (!st) return <span className="text-gray-400 text-xs">—</span>;
  const Icon = st.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${st.color}`}>
      <Icon className="w-3 h-3" />
      {st.label}
    </span>
  );
}

function MovilForm({ movil, onSave, onCancel, saving, drivers = [] }) {
  const [form, setForm] = useState(() => {
    if (!movil) return EMPTY_MOVIL;
    // Migrar campo legacy driver_id a driver_ids si es necesario
    const base = { ...movil };
    if (!Array.isArray(base.driver_ids) || base.driver_ids.length === 0) {
      base.driver_ids = base.driver_id ? [base.driver_id] : [];
      base.driver_names = base.driver_name ? [base.driver_name] : [];
    }
    return base;
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-5">
      <MovilAlertBanner movil={form} />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">N° Móvil *</label>
          <Input type="number" value={form.numero_movil} onChange={e => set("numero_movil", e.target.value)} required className="mt-1" placeholder="Ej: 12" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Habilitado</label>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={() => set("activo", !form.activo)}
              className={`w-10 h-6 rounded-full transition-colors relative ${form.activo ? "bg-green-500" : "bg-gray-300"}`}>
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.activo ? "left-5" : "left-1"}`} />
            </button>
            <span className="text-sm text-gray-600">{form.activo ? "Habilitado" : "Suspendido"}</span>
          </div>
          {!form.activo && (
            <div className="mt-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Motivo de suspensión</label>
              <Input value={form.suspension_motivo || ""} onChange={e => set("suspension_motivo", e.target.value)} className="mt-1" placeholder="Ej: Falta de documentación, solicitud del titular..." />
            </div>
          )}
        </div>
      </div>

      {/* Fuera de servicio — solo comisión (admin) */}
      <div className="border-t pt-4">
        <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Ban className="w-3.5 h-3.5" /> Fuera de Servicio (Comisión)
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fuera de Servicio</label>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => set("fuera_de_servicio", !form.fuera_de_servicio)}
                className={`w-10 h-6 rounded-full transition-colors relative ${form.fuera_de_servicio ? "bg-red-600" : "bg-gray-300"}`}>
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.fuera_de_servicio ? "left-5" : "left-1"}`} />
              </button>
              <span className="text-sm text-gray-600">{form.fuera_de_servicio ? "Fuera de servicio" : "En servicio"}</span>
            </div>
          </div>
          {form.fuera_de_servicio && (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Motivo</label>
                <Select value={form.fuera_de_servicio_motivo || ""} onValueChange={v => set("fuera_de_servicio_motivo", v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar motivo..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="falta_de_pago">Falta de pago</SelectItem>
                    <SelectItem value="falta_de_papeles">Falta de papeles</SelectItem>
                    <SelectItem value="baja_voluntaria">Baja voluntaria</SelectItem>
                    <SelectItem value="sancion_disciplinaria">Sanción disciplinaria</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Detalle adicional</label>
                <Input value={form.fuera_de_servicio_detalle || ""} onChange={e => set("fuera_de_servicio_detalle", e.target.value)} className="mt-1" placeholder="Descripción adicional..." />
              </div>
            </>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Apellido y Nombre del Titular</label>
        <Input value={form.apellido_nombre} onChange={e => set("apellido_nombre", e.target.value)} className="mt-1" placeholder="Ej: García, Juan Carlos" />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Choferes Asignados</label>
        <div className="mt-2 space-y-2">
          {drivers.map(d => {
            const ids = Array.isArray(form.driver_ids) ? form.driver_ids : (form.driver_id ? [form.driver_id] : []);
            const checked = ids.includes(d.id);
            return (
              <label key={d.id} className="flex items-center gap-2 cursor-pointer select-none text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const newIds = checked ? ids.filter(x => x !== d.id) : [...ids, d.id];
                    const newNames = newIds.map(id => drivers.find(x => x.id === id)?.name).filter(Boolean);
                    set("driver_ids", newIds);
                    set("driver_names", newNames);
                    // mantener campo legacy con el primer chofer
                    set("driver_id", newIds[0] || "");
                    set("driver_name", newNames[0] || "");
                  }}
                  className="w-4 h-4 rounded"
                />
                <span>{d.name}{d.vehicle_plate ? ` · ${d.vehicle_plate}` : ""}</span>
              </label>
            );
          })}
          {drivers.length === 0 && <p className="text-xs text-muted-foreground">No hay choferes registrados.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">DNI</label>
          <Input value={form.dni} onChange={e => set("dni", e.target.value)} className="mt-1" placeholder="Ej: 28.345.678" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha de Nacimiento</label>
          <Input type="date" value={form.fecha_nacimiento} onChange={e => set("fecha_nacimiento", e.target.value)} className="mt-1" />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dirección</label>
        <Input value={form.direccion} onChange={e => set("direccion", e.target.value)} className="mt-1" placeholder="Ej: San Martín 1234, Concepción del Uruguay" />
      </div>

      <div className="border-t pt-4">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Datos del Vehículo</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dominio (Patente)</label>
            <Input value={form.dominio} onChange={e => set("dominio", e.target.value.toUpperCase())} className="mt-1 font-mono" placeholder="Ej: AB 123 CD" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Marca</label>
            <Input value={form.marca} onChange={e => set("marca", e.target.value)} className="mt-1" placeholder="Ej: Chevrolet" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Modelo</label>
            <Input value={form.modelo} onChange={e => set("modelo", e.target.value)} className="mt-1" placeholder="Ej: Aveo" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Color</label>
            <Input value={form.color} onChange={e => set("color", e.target.value)} className="mt-1" placeholder="Ej: Blanco" />
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Carnet Categoría</label>
        <Select value={form.carnet_categoria} onValueChange={v => set("carnet_categoria", v)}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Seleccionar categoría..." />
          </SelectTrigger>
          <SelectContent>
            {["A","B","C","D","E","F","G"].map(c => <SelectItem key={c} value={c}>Categoría {c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border-t pt-4">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Documentación y Vencimientos</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">VTV / RTO — Vencimiento</label>
            <Input type="date" value={form.vtv_vencimiento} onChange={e => set("vtv_vencimiento", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Seg. Riesgos Personales — Venc.</label>
            <Input type="date" value={form.seguro_riesgos_personales_vencimiento} onChange={e => set("seguro_riesgos_personales_vencimiento", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Seguro Automotor — Vencimiento</label>
            <Input type="date" value={form.seguro_automotor_vencimiento} onChange={e => set("seguro_automotor_vencimiento", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Buena Conducta — Vencimiento</label>
            <Input type="date" value={form.buena_conducta_vencimiento} onChange={e => set("buena_conducta_vencimiento", e.target.value)} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="border-t pt-4">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Pagos y Deudas</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pago Semanal al Día</label>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => set("pago_semanal_al_dia", !form.pago_semanal_al_dia)}
                className={`w-10 h-6 rounded-full transition-colors relative ${form.pago_semanal_al_dia ? "bg-green-500" : "bg-red-400"}`}>
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.pago_semanal_al_dia ? "left-5" : "left-1"}`} />
              </button>
              <span className="text-sm text-gray-600">{form.pago_semanal_al_dia ? "Al día" : "Adeuda"}</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha Último Pago</label>
            <Input type="date" value={form.pago_semanal_fecha} onChange={e => set("pago_semanal_fecha", e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Deuda ($ pesos)</label>
            <Input type="number" min="0" value={form.deuda_monto || 0} onChange={e => set("deuda_monto", Number(e.target.value))} className="mt-1" placeholder="0" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Detalle de Deuda</label>
            <Input value={form.deuda_notas || ""} onChange={e => set("deuda_notas", e.target.value)} className="mt-1" placeholder="Ej: 3 semanas impago" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Buena Conducta Vigente</label>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => set("buena_conducta", !form.buena_conducta)}
                className={`w-10 h-6 rounded-full transition-colors relative ${form.buena_conducta ? "bg-green-500" : "bg-red-400"}`}>
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.buena_conducta ? "left-5" : "left-1"}`} />
              </button>
              <span className="text-sm text-gray-600">{form.buena_conducta ? "Sí" : "No"}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notas / Observaciones</label>
        <textarea
          value={form.notas}
          onChange={e => set("notas", e.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm h-20 resize-none"
          placeholder="Observaciones adicionales..."
        />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={saving} className="flex-1">
          {saving ? "Guardando..." : "Guardar"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// Construye la lista de campos de vencimiento de un móvil para DocVencimientosAlert
function getCamposMovil(m) {
  return [
    { key: "vtv_vencimiento",                       label: "VTV / RTO",                     fecha: m.vtv_vencimiento },
    { key: "seguro_automotor_vencimiento",           label: "Seguro Automotor",              fecha: m.seguro_automotor_vencimiento },
    { key: "seguro_riesgos_personales_vencimiento",  label: "Seg. Riesgos Personales",       fecha: m.seguro_riesgos_personales_vencimiento },
    { key: "buena_conducta_vencimiento",             label: "Buena Conducta",                fecha: m.buena_conducta_vencimiento },
    { key: "pago_semanal_al_dia",                    label: "Pago semanal al día",           boolean: true, valor: m.pago_semanal_al_dia },
  ];
}

export default function Moviles() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [soloConProblemas, setSoloConProblemas] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reinscripcionMovil, setReinscripcionMovil] = useState(null);
  const [alertMovil, setAlertMovil] = useState(null); // móvil cuyas alertas se muestran en popup previo
  const [deleteConfirmMovil, setDeleteConfirmMovil] = useState(null);

  const { data: moviles = [], error: errorMoviles } = useQuery({
    queryKey: ["moviles"],
    queryFn: () => base44.entities.Movil.list(),
  });

  const { data: drivers = [], isSuccess: driversLoaded, error: errorDrivers } = useQuery({
    queryKey: ["drivers-list"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const res = await base44.functions.invoke('adminProxy', { 
        entity: 'Movil', op: 'delete', id, 
        sessionToken: sessionStorage.getItem('local_operator_token') 
      });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      const localOp = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
      base44.entities.AuditLog.create({
        action: "eliminar_movil",
        user_type: localOp?.role || "operador",
        user_name: localOp?.name || "Operador",
        details: `Eliminó el móvil N° ${deleteConfirmMovil?.numero_movil || ""}`
      }).catch(() => {});
      qc.invalidateQueries({ queryKey: ["moviles"] });
      setDeleteConfirmMovil(null);
    },
    onError: (err) => alert("Error al eliminar: " + (err?.response?.data?.error || err?.message || JSON.stringify(err)))
  });

  const saveMutation = useMutation({
    mutationFn: async (form) => {
      const { id, created_date, updated_date, created_by_id, ...cleanData } = form;
      const data = { ...cleanData, numero_movil: Number(cleanData.numero_movil) };
      
      // Eliminar campos vacíos para que no rompan la validación de fechas o números
      Object.keys(data).forEach(k => { 
        if (data[k] === "" || data[k] === null || data[k] === undefined) {
          delete data[k];
        }
      });

      const res = await base44.functions.invoke('adminProxy', { 
        entity: 'Movil', 
        op: editing?.id ? 'update' : 'create', 
        id: editing?.id, 
        data, 
        sessionToken: sessionStorage.getItem('local_operator_token') 
      });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => { 
      const localOp = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
      base44.entities.AuditLog.create({
        action: editing ? "editar_movil" : "alta_movil",
        user_type: localOp?.role || "operador",
        user_name: localOp?.name || "Operador",
        details: editing ? `Editó el móvil N° ${editing?.numero_movil || ""}` : `Dio de alta un nuevo móvil`
      }).catch(() => {});

      qc.invalidateQueries({ queryKey: ["moviles"] }); 
      setDialogOpen(false); 
      setEditing(null); 
    },
    onError: (err) => alert("Error al guardar el móvil: " + (err?.response?.data?.error || err?.message || JSON.stringify(err)))
  });

  // Build a map: movil_id -> drivers that have this movil assigned (by driver_ids or legacy driver_id)
  const driversByMovil = {};
  for (const d of drivers) {
    // Check if driver is linked to this movil via its own vehicle_plate or vehicle_model field
    // The link is stored on the Movil entity (driver_ids array). We invert it here.
    // Also support drivers who have vehicle_plate matching the movil's dominio
  }
  // Primary: group by driver_ids stored on each movil
  const driversByMovilId = {};
  for (const m of moviles) {
    const ids = Array.isArray(m.driver_ids) ? m.driver_ids : (m.driver_id ? [m.driver_id] : []);
    driversByMovilId[m.id] = drivers.filter(d => ids.includes(d.id));
    // Also auto-match by vehicle_plate if driver has the same plate and isn't already listed
    if (m.dominio) {
      const plate = m.dominio.replace(/\s/g, "").toUpperCase();
      const autoMatched = drivers.filter(d => {
        const dp = (d.vehicle_plate || "").replace(/\s/g, "").toUpperCase();
        return dp && dp === plate && !ids.includes(d.id);
      });
      driversByMovilId[m.id] = [...driversByMovilId[m.id], ...autoMatched];
    }
  }

  const filtered = moviles.filter(m => {
    const matchSearch = !search ||
      String(m.numero_movil).includes(search) ||
      m.apellido_nombre?.toLowerCase().includes(search.toLowerCase()) ||
      m.dni?.includes(search);
    
    if (!matchSearch) return false;

    if (soloConProblemas) {
      const tieneProblemas = 
        (m.vtv_vencimiento && differenceInDays(parseISO(m.vtv_vencimiento), new Date()) < 0) ||
        (m.seguro_automotor_vencimiento && differenceInDays(parseISO(m.seguro_automotor_vencimiento), new Date()) < 0) ||
        (m.seguro_riesgos_personales_vencimiento && differenceInDays(parseISO(m.seguro_riesgos_personales_vencimiento), new Date()) < 0) ||
        (m.buena_conducta && m.buena_conducta_vencimiento && differenceInDays(parseISO(m.buena_conducta_vencimiento), new Date()) < 0) ||
        m.pago_semanal_al_dia === false ||
        m.deuda_monto > 0 ||
        m.fuera_de_servicio ||
        (!m.activo && m.suspension_motivo);
      
      if (!tieneProblemas) return false;
    }
    
    return true;
  }).sort((a, b) => Number(a.numero_movil) - Number(b.numero_movil));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Car className="w-6 h-6 text-primary" />
            Móviles
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">{moviles.length} móviles registrados</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Nuevo Móvil
        </Button>
      </div>

      {(errorMoviles || errorDrivers) && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          <strong className="font-bold">Error de conexión: </strong>
          <span className="block sm:inline">{errorMoviles?.message || errorDrivers?.message || "No se pudo conectar con el servidor."}</span>
        </div>
      )}

      {/* Panel de reinscripción si está abierto */}
      {reinscripcionMovil && (
        <ReinscripcionPanel
          nombre={`Móvil ${reinscripcionMovil.numero_movil} — ${reinscripcionMovil.apellido_nombre}`}
          campos={getCamposMovil(reinscripcionMovil)}
          onClose={() => setReinscripcionMovil(null)}
        />
      )}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número, nombre o DNI..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
        <Button
          variant={soloConProblemas ? "destructive" : "outline"}
          onClick={() => setSoloConProblemas(!soloConProblemas)}
          className="gap-2 shrink-0 bg-card"
        >
          <AlertTriangle className="w-4 h-4" />
          {soloConProblemas ? "Mostrando problemas" : "Filtrar vencidos"}
        </Button>
      </div>

      {/* Fichas de Móviles en Lista Fija de 1 a 100 */}
      <div className="flex flex-col gap-3">
        {(() => {
          const allNumbers = new Set(Array.from({ length: 100 }, (_, i) => i + 1));
          moviles.forEach(m => allNumbers.add(Number(m.numero_movil)));
          const slots = Array.from(allNumbers).sort((a, b) => a - b);

          let hasResults = false;

          const elements = slots.map(numero => {
            const movilesEnSlot = filtered.filter(m => Number(m.numero_movil) === numero);
            
            if (movilesEnSlot.length === 0) {
              if (search || soloConProblemas) return null; // No mostrar vacíos si hay filtros
              hasResults = true;
              return (
                <div key={`empty-${numero}`} className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-muted/10 border border-dashed border-border rounded-xl hover:bg-muted/20 transition-colors gap-3">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-muted/30 rounded-xl flex items-center justify-center text-muted-foreground font-bold text-lg border border-border shrink-0">
                      {numero}
                    </div>
                    <span className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">Vacante</span>
                  </div>
                  <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={() => { setEditing({ ...EMPTY_MOVIL, numero_movil: numero }); setDialogOpen(true); }}>
                    <Plus className="w-4 h-4" /> Añadir a este número
                  </Button>
                </div>
              );
            }

            hasResults = true;
            return movilesEnSlot.map((m, idx) => {
              const problemas = [];
              if (m.vtv_vencimiento && differenceInDays(parseISO(m.vtv_vencimiento), new Date()) < 0) problemas.push("VTV Vencida");
              if (m.seguro_automotor_vencimiento && differenceInDays(parseISO(m.seguro_automotor_vencimiento), new Date()) < 0) problemas.push("Seguro Automotor Vencido");
              if (m.seguro_riesgos_personales_vencimiento && differenceInDays(parseISO(m.seguro_riesgos_personales_vencimiento), new Date()) < 0) problemas.push("Seg. Riesgos Vencido");
              if (m.buena_conducta && m.buena_conducta_vencimiento && differenceInDays(parseISO(m.buena_conducta_vencimiento), new Date()) < 0) problemas.push("Buena Conducta Vencida");
              if (!m.buena_conducta) problemas.push("Sin Buena Conducta");
              if (m.pago_semanal_al_dia === false) problemas.push("Deuda Semanal");
              if (m.deuda_monto > 0) problemas.push(`Deuda: $${m.deuda_monto}`);
              if (m.fuera_de_servicio) problemas.push(`Fuera de Servicio (${m.fuera_de_servicio_motivo || 'Comisión'})`);
              if (!m.activo && !m.fuera_de_servicio) problemas.push(`Suspendido (${m.suspension_motivo || 'Operador'})`);

              const choferes = driversByMovilId[m.id] || [];
              const primerChofer = choferes[0] ? choferes[0].name : m.apellido_nombre;

              return (
                <div key={m.id} className={`bg-card rounded-xl border flex flex-col md:flex-row transition-shadow hover:shadow-md ${problemas.length > 0 ? 'border-red-300' : 'border-border'}`}>
                  
                  <div className={`p-4 md:w-72 flex shrink-0 items-center gap-4 border-b md:border-b-0 md:border-r ${problemas.length > 0 ? 'bg-red-50/50' : 'bg-muted/10'}`}>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xl shrink-0 ${problemas.length > 0 ? 'bg-red-100 text-red-700' : 'bg-primary/10 text-primary'}`}>
                      {m.numero_movil}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-foreground truncate" title={primerChofer}>{primerChofer}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.dominio || 'Sin patente'} • {m.marca}</p>
                      {idx > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest mt-1 inline-block">Mismo N°</span>}
                    </div>
                  </div>
                  
                  <div className="p-4 flex-1 flex flex-col justify-center min-w-0">
                    {problemas.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {problemas.map((p, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-red-700 text-xs font-semibold bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-100">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                            {p}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center text-green-700 text-sm font-semibold gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-600" /> Todo al día
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex items-center justify-end gap-2 shrink-0 border-t md:border-t-0 bg-muted/5 md:bg-transparent">
                    <Button variant="ghost" size="icon" className="text-primary hover:bg-primary/10" title="Editar" onClick={() => { setAlertMovil(m); setEditing(m); }}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-blue-600 hover:bg-blue-50" title="Lista de reinscripción" onClick={() => setReinscripcionMovil(prev => prev?.id === m.id ? null : m)}>
                      <ClipboardList className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600 hover:bg-red-50" title="Eliminar" onClick={() => setDeleteConfirmMovil(m)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            });
          });

          if (!hasResults) {
            return (
              <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                No hay móviles que coincidan con la búsqueda.
              </div>
            );
          }
          return elements;
        })()}
      </div>

      {/* Popup de alertas previo — se muestra al abrir un móvil con problemas */}
      {alertMovil && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between bg-red-600 px-5 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-white" />
                <span className="text-white font-bold text-base uppercase tracking-wide">
                  Alertas — Móvil {alertMovil.numero_movil}
                </span>
              </div>
              <button onClick={() => { setAlertMovil(null); setEditing(null); }} className="text-white/80 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <MovilAlertBanner movil={alertMovil} />
              {!alertMovil.vtv_vencimiento && !alertMovil.seguro_automotor_vencimiento && !alertMovil.seguro_riesgos_personales_vencimiento && !alertMovil.buena_conducta_vencimiento && alertMovil.pago_semanal_al_dia !== false && !alertMovil.deuda_monto && !alertMovil.suspension_motivo && !alertMovil.fuera_de_servicio && !alertMovil.notas?.trim() && (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  ✅ Sin alertas pendientes para este móvil.
                </p>
              )}
            </div>
            <div className="px-4 pb-4 flex gap-3">
              <button
                onClick={() => { setAlertMovil(null); setDialogOpen(true); }}
                className="flex-1 bg-primary text-white rounded-lg py-2.5 font-semibold text-sm hover:bg-primary/90 transition-colors"
              >
                Continuar a edición
              </button>
              <button
                onClick={() => { setAlertMovil(null); setEditing(null); }}
                className="flex-1 border border-border rounded-lg py-2.5 font-semibold text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) { setDialogOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar Móvil ${editing.numero_movil}` : "Nuevo Móvil"}</DialogTitle>
          </DialogHeader>
          {driversLoaded ? (
            <MovilForm
              key={editing?.id || "nuevo"}
              movil={editing}
              onSave={data => saveMutation.mutate(data)}
              onCancel={() => { setDialogOpen(false); setEditing(null); }}
              saving={saveMutation.isPending}
              drivers={drivers}
            />
          ) : (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmMovil} onOpenChange={(v) => !v && setDeleteConfirmMovil(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Eliminar Móvil
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar el móvil <strong>N° {deleteConfirmMovil?.numero_movil}</strong>? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 mt-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate(deleteConfirmMovil.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}