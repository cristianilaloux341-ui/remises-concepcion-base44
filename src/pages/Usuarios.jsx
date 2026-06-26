import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, UserPlus, Phone, Shield, User, Loader2, CheckCircle2, AlertCircle, Trash2, KeyRound, Pencil, PowerOff, Power, Mail, ShoppingBag, Eye } from "lucide-react";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions";

const ROLES = [
  { value: "admin",      label: "Administrador",          icon: Shield,      desc: "Acceso total" },
  { value: "supervisor", label: "Supervisor",              icon: Eye,         desc: "Ve todo, no configura" },
  { value: "operador",   label: "Operador de Despacho",   icon: User,        desc: "Despacho y clientes" },
  { value: "caja",       label: "Administrativo de Caja", icon: ShoppingBag, desc: "Caja y estadísticas" },
];

const PERMISOS_POR_ROL = {
  admin:      ["Dashboard", "Órdenes", "Mapa", "Clientes", "Agenda", "Mensajes", "Choferes", "Móviles", "Tarifas", "Zonas", "Usuarios", "Backup"],
  supervisor: ["Dashboard", "Órdenes", "Mapa", "Clientes", "Agenda", "Mensajes", "Choferes", "Móviles"],
  operador:   ["Dashboard", "Órdenes", "Mapa", "Clientes", "Agenda", "Mensajes"],
  caja:       ["Dashboard", "Clientes", "Agenda", "Estadísticas financieras"],
};

function OperatorForm({ initial, onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    name:  initial?.name  || "",
    phone: initial?.phone || "",
    email: initial?.email || "",
    pin:   "",
    role:  initial?.role  || "operador",
    notes: initial?.notes || "",
  });
  const [error, setError] = useState("");

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(""); };

  const handleSubmit = () => {
    if (!form.name.trim())  { setError("El nombre es obligatorio"); return; }
    if (!form.phone.trim()) { setError("El teléfono es obligatorio"); return; }
    if (!initial && (!form.pin || form.pin.length < 4)) { setError("El PIN debe tener al menos 4 dígitos"); return; }
    if (!initial && !/^\d+$/.test(form.pin)) { setError("El PIN solo puede contener números"); return; }
    const data = { name: form.name.trim(), phone: form.phone.trim(), role: form.role, notes: form.notes };
    if (form.email.trim()) data.email = form.email.trim();
    if (form.pin) data.pin = form.pin;
    onSubmit(data);
  };

  const selectedRole = ROLES.find(r => r.value === form.role);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Nombre completo</Label>
        <Input placeholder="Juan Pérez" value={form.name} onChange={e => set("name", e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Teléfono</Label>
        <Input type="tel" inputMode="numeric" placeholder="3442 123456" value={form.phone} onChange={e => set("phone", e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Email (para login y envío de acceso)</Label>
        <Input type="email" placeholder="ejemplo@correo.com" value={form.email} onChange={e => set("email", e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>{initial ? "Nuevo PIN (dejar vacío para no cambiar)" : "PIN de acceso (4-6 dígitos)"}</Label>
        <Input type="password" inputMode="numeric" maxLength={6} placeholder="••••" value={form.pin} onChange={e => set("pin", e.target.value.replace(/\D/g, ""))} />
      </div>

      {/* Selector de rol */}
      <div className="space-y-2">
        <Label>Rol y permisos</Label>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map(r => {
            const Icon = r.icon;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => set("role", r.value)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${form.role === r.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${form.role === r.value ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`font-semibold text-xs ${form.role === r.value ? "text-primary" : "text-foreground"}`}>{r.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{r.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Permisos del rol seleccionado */}
        {selectedRole && (
          <div className="bg-muted/50 rounded-xl p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Acceso del rol seleccionado:</p>
            <div className="flex flex-wrap gap-1">
              {(PERMISOS_POR_ROL[form.role] || []).map(p => (
                <span key={p} className="text-xs bg-background border border-border rounded-full px-2 py-0.5">{p}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label>Notas (opcional)</Label>
        <Input placeholder="Turno mañana, etc." value={form.notes} onChange={e => set("notes", e.target.value)} />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      <Button onClick={handleSubmit} disabled={isSubmitting} className="w-full gap-2">
        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        {initial ? "Guardar cambios" : "Crear operador"}
      </Button>
    </div>
  );
}

export default function Usuarios() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen]       = useState(false);
  const [editingOp, setEditingOp]         = useState(null);
  const [deleteTarget, setDeleteTarget]   = useState(null);
  const [resetPinTarget, setResetPinTarget] = useState(null);
  const [resetPinSuccess, setResetPinSuccess] = useState(null);
  const [resetPinLoading, setResetPinLoading] = useState(false);

  const { data: operators = [], isLoading } = useQuery({
    queryKey: ["operators"],
    queryFn: () => base44.entities.Operator.list(),
  });

  const appUrl = window.location.origin;

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const op = await base44.entities.Operator.create(data);
      if (data.email && data.pin) {
        await base44.integrations.Core.SendEmail({
          to: data.email,
          subject: "Tus datos de acceso — Central de Despacho",
          body: `Hola ${data.name},\n\nTu cuenta de acceso a la Central de Despacho fue creada.\n\n📱 Celular: ${data.phone}\n📧 Email: ${data.email}\n🔑 PIN: ${data.pin}\n👤 Rol: ${ROLE_LABELS[data.role] || data.role}\n\nPodés ingresar con tu celular o email desde:\n${appUrl}\n\nPor seguridad, no compartas tu PIN.\n\nSaludos,\nEquipo de la Central`
        });
      }
      return op;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operators"] }); setDialogOpen(false); },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Operator.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operators"] }); setEditingOp(null); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }) => base44.entities.Operator.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operators"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Operator.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operators"] }); setDeleteTarget(null); },
  });

  // Agrupar por rol
  const grouped = ROLES.map(r => ({
    ...r,
    ops: operators.filter(op => op.role === r.value),
  })).filter(g => g.ops.length > 0);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Operadores y Roles
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Hasta 6 usuarios trabajando en simultáneo. Login por celular o email + PIN.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Agregar
        </Button>
      </div>

      {/* Dialog crear */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuevo operador</DialogTitle></DialogHeader>
          <OperatorForm onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Dialog editar */}
      <Dialog open={!!editingOp} onOpenChange={(v) => !v && setEditingOp(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar — {editingOp?.name}</DialogTitle></DialogHeader>
          <OperatorForm initial={editingOp} onSubmit={(data) => editMutation.mutate({ id: editingOp.id, data })} isSubmitting={editMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Lista agrupada por rol */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : operators.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          No hay operadores registrados aún.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(group => {
            const Icon = group.icon;
            return (
              <div key={group.value}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">{group.label}</h3>
                  <span className="text-xs text-muted-foreground">({group.ops.length})</span>
                </div>
                <div className="space-y-2">
                  {group.ops.map((op) => (
                    <Card key={op.id} className={`transition-shadow ${op.active === false ? "opacity-60" : "hover:shadow-sm"}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Icon className="w-5 h-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-sm">{op.name}</p>
                              {op.active === false && <span className="text-xs text-orange-500 font-medium">Deshabilitado</span>}
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {op.phone}
                              {op.pin
                                ? <span className="ml-2 text-green-600 font-medium">· PIN creado</span>
                                : <span className="ml-2 text-amber-500 font-medium">· Sin PIN</span>}
                            </p>
                            {op.email && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Mail className="w-3 h-3" /> {op.email}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className={`text-xs shrink-0 ${ROLE_COLORS[op.role] || ""}`}>
                            {ROLE_LABELS[op.role] || op.role}
                          </Badge>
                          <div className="flex items-center gap-1">
                            <button title="Editar" className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" onClick={() => setEditingOp(op)}>
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button title="Resetear PIN" className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors" onClick={() => { setResetPinTarget(op); setResetPinSuccess(null); }}>
                              <KeyRound className="w-4 h-4" />
                            </button>
                            <button
                              title={op.active === false ? "Habilitar" : "Deshabilitar"}
                              className={`p-1.5 rounded-lg transition-colors ${op.active === false ? "text-green-600 hover:bg-green-50" : "text-muted-foreground hover:text-orange-600 hover:bg-orange-50"}`}
                              onClick={() => toggleMutation.mutate({ id: op.id, active: op.active === false ? true : false })}
                            >
                              {op.active === false ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                            </button>
                            <button title="Eliminar" className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors" onClick={() => setDeleteTarget(op)}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {op.notes && <p className="mt-2 text-xs text-muted-foreground ml-[52px]">{op.notes}</p>}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal resetear PIN */}
      <AlertDialog open={!!resetPinTarget} onOpenChange={(v) => !v && setResetPinTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              Resetear PIN — {resetPinTarget?.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se generará un PIN temporal de 4 dígitos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {resetPinSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-sm text-green-700">PIN temporal generado:</p>
              <p className="text-3xl font-mono font-black text-green-800 tracking-[0.3em] mt-1">{resetPinSuccess}</p>
              <p className="text-xs text-green-600 mt-1">Entregáselo al operador en persona o fue enviado por email.</p>
            </div>
          )}
          <div className="flex gap-3 mt-2">
            <AlertDialogCancel onClick={() => { setResetPinTarget(null); setResetPinSuccess(null); }}>Cerrar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-white hover:bg-amber-600"
              disabled={resetPinLoading}
              onClick={async (e) => {
                e.preventDefault();
                const tempPin = String(Math.floor(1000 + Math.random() * 9000));
                setResetPinLoading(true);
                await base44.entities.Operator.update(resetPinTarget.id, { pin: tempPin });
                if (resetPinTarget.email) {
                  await base44.integrations.Core.SendEmail({
                    to: resetPinTarget.email,
                    subject: "Tu PIN fue reseteado — Central de Despacho",
                    body: `Hola ${resetPinTarget.name},\n\nTu PIN de acceso fue reseteado.\n\n📱 Celular: ${resetPinTarget.phone}\n🔑 Nuevo PIN: ${tempPin}\n\nIngresá desde:\n${window.location.origin}\n\nSaludos,\nEquipo de la Central`
                  });
                }
                setResetPinSuccess(tempPin);
                setResetPinLoading(false);
              }}
            >
              {resetPinLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Generar PIN temporal
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" /> Eliminar operador
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar a <strong>{deleteTarget?.name}</strong>? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 mt-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate(deleteTarget.id)}
            >
              Eliminar
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}