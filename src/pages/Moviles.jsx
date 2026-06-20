import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Car, Plus, Edit, AlertTriangle, CheckCircle2, XCircle, Search } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { es } from "date-fns/locale";

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
  pago_mensual_al_dia: true,
  pago_mensual_fecha: "",
  buena_conducta: true,
  buena_conducta_vencimiento: "",
  activo: true,
  notas: "",
};

function vencimientoStatus(fecha) {
  if (!fecha) return null;
  const dias = differenceInDays(parseISO(fecha), new Date());
  if (dias < 0) return { color: "text-red-600 bg-red-50 border-red-200", label: "Vencido", icon: XCircle };
  if (dias <= 30) return { color: "text-amber-600 bg-amber-50 border-amber-200", label: `Vence en ${dias}d`, icon: AlertTriangle };
  return { color: "text-green-600 bg-green-50 border-green-200", label: format(parseISO(fecha), "dd/MM/yyyy"), icon: CheckCircle2 };
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

function MovilForm({ movil, onSave, onCancel, saving }) {
  const [form, setForm] = useState(movil || EMPTY_MOVIL);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">N° Móvil *</label>
          <Input type="number" value={form.numero_movil} onChange={e => set("numero_movil", e.target.value)} required className="mt-1" placeholder="Ej: 12" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</label>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={() => set("activo", !form.activo)}
              className={`w-10 h-6 rounded-full transition-colors relative ${form.activo ? "bg-green-500" : "bg-gray-300"}`}>
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.activo ? "left-5" : "left-1"}`} />
            </button>
            <span className="text-sm text-gray-600">{form.activo ? "Activo" : "Inactivo"}</span>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Apellido y Nombre del Titular *</label>
        <Input value={form.apellido_nombre} onChange={e => set("apellido_nombre", e.target.value)} required className="mt-1" placeholder="Ej: García, Juan Carlos" />
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
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Pagos y Conducta</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pago Mensual al Día</label>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => set("pago_mensual_al_dia", !form.pago_mensual_al_dia)}
                className={`w-10 h-6 rounded-full transition-colors relative ${form.pago_mensual_al_dia ? "bg-green-500" : "bg-red-400"}`}>
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.pago_mensual_al_dia ? "left-5" : "left-1"}`} />
              </button>
              <span className="text-sm text-gray-600">{form.pago_mensual_al_dia ? "Al día" : "Adeuda"}</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha Último Pago</label>
            <Input type="date" value={form.pago_mensual_fecha} onChange={e => set("pago_mensual_fecha", e.target.value)} className="mt-1" />
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

export default function Moviles() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: moviles = [] } = useQuery({
    queryKey: ["moviles"],
    queryFn: () => base44.entities.Movil.list("-numero_movil"),
  });

  const saveMutation = useMutation({
    mutationFn: (form) => {
      const data = { ...form, numero_movil: Number(form.numero_movil) };
      return editing?.id
        ? base44.entities.Movil.update(editing.id, data)
        : base44.entities.Movil.create(data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["moviles"] }); setDialogOpen(false); setEditing(null); },
  });

  const filtered = moviles.filter(m =>
    !search ||
    String(m.numero_movil).includes(search) ||
    m.apellido_nombre?.toLowerCase().includes(search.toLowerCase()) ||
    m.dni?.includes(search)
  );

  const vencidos = moviles.filter(m => {
    const campos = [m.vtv_vencimiento, m.seguro_riesgos_personales_vencimiento, m.seguro_automotor_vencimiento, m.buena_conducta_vencimiento];
    return campos.some(f => f && differenceInDays(parseISO(f), new Date()) < 0);
  });

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

      {/* Alertas de vencimientos */}
      {vencidos.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700 text-sm">Documentación vencida</p>
            <p className="text-red-600 text-sm mt-0.5">
              {vencidos.map(m => `Móvil ${m.numero_movil} (${m.apellido_nombre})`).join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por número, nombre o DNI..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tabla */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">N° Móvil</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Titular</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Vehículo</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">DNI</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">VTV/RTO</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Seg. Automotor</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Seg. Riesgos</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Buena Conducta</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Pago Mensual</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-muted-foreground">
                    No hay móviles registrados.
                  </td>
                </tr>
              )}
              {filtered.map(m => (
                <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-bold text-primary text-lg">{m.numero_movil}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{m.apellido_nombre}</p>
                    {m.direccion && <p className="text-xs text-muted-foreground">{m.direccion}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {m.dominio && <p className="font-mono font-semibold text-sm">{m.dominio}</p>}
                    {(m.marca || m.modelo) && <p className="text-xs text-muted-foreground">{[m.marca, m.modelo, m.color].filter(Boolean).join(" · ")}</p>}
                    {!m.dominio && !m.marca && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono">{m.dni || "—"}</td>
                  <td className="px-4 py-3"><VencimientoBadge fecha={m.vtv_vencimiento} /></td>
                  <td className="px-4 py-3"><VencimientoBadge fecha={m.seguro_automotor_vencimiento} /></td>
                  <td className="px-4 py-3"><VencimientoBadge fecha={m.seguro_riesgos_personales_vencimiento} /></td>
                  <td className="px-4 py-3">
                    {m.buena_conducta
                      ? <VencimientoBadge fecha={m.buena_conducta_vencimiento} />
                      : <span className="text-xs text-red-600 font-medium">Sin certificado</span>}
                  </td>
                  <td className="px-4 py-3">
                    {m.pago_mensual_al_dia
                      ? <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full font-medium"><CheckCircle2 className="w-3 h-3" />Al día</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-medium"><XCircle className="w-3 h-3" />Adeuda</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={m.activo ? "default" : "secondary"}>{m.activo ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(m); setDialogOpen(true); }}>
                      <Edit className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) { setDialogOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar Móvil ${editing.numero_movil}` : "Nuevo Móvil"}</DialogTitle>
          </DialogHeader>
          <MovilForm
            movil={editing}
            onSave={data => saveMutation.mutate(data)}
            onCancel={() => { setDialogOpen(false); setEditing(null); }}
            saving={saveMutation.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}