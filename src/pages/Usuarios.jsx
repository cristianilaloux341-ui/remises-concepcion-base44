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
import { Users, UserPlus, Phone, Shield, User, Loader2, CheckCircle2, AlertCircle, Trash2, KeyRound, Pencil, PowerOff, Power, Mail } from "lucide-react";

const ROLES = [
  { value: "admin", label: "Administrador", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "operador", label: "Operador", color: "bg-blue-100 text-blue-700 border-blue-200" },
];

function OperatorForm({ initial, onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    phone: initial?.phone || "",
    email: initial?.email || "",
    pin: "",
    role: initial?.role || "operador",
    notes: initial?.notes || "",
  });
  const [error, setError] = useState("");

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(""); };

  const handleSubmit = () => {
    if (!form.name.trim()) { setError("El nombre es obligatorio"); return; }
    if (!form.phone.trim()) { setError("El teléfono es obligatorio"); return; }
    if (!initial && (!form.pin || form.pin.length < 4)) { setError("El PIN debe tener al menos 4 dígitos"); return; }
    if (!initial && !/^\d+$/.test(form.pin)) { setError("El PIN solo puede contener números"); return; }
    const data = { name: form.name.trim(), phone: form.phone.trim(), role: form.role, notes: form.notes };
    if (form.email.trim()) data.email = form.email.trim();
    if (form.pin) data.pin = form.pin;
    onSubmit(data);
  };

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
        <Label>Email (para envío de acceso)</Label>
        <Input type="email" placeholder="ejemplo@correo.com" value={form.email} onChange={e => set("email", e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>{initial ? "Nuevo PIN (dejar vacío para no cambiar)" : "PIN de acceso (4-6 dígitos)"}</Label>
        <Input type="password" inputMode="numeric" maxLength={6} placeholder="••••" value={form.pin} onChange={e => set("pin", e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="space-y-1">
        <Label>Rol</Label>
        <div className="flex gap-2">
          {ROLES.map(r => (
            <button
              key={r.value}
              type="button"
              onClick={() => set("role", r.value)}
              className={`flex-1 py-2.5 rounded-xl border-2 font-semibold text-sm transition-all flex items-center justify-center gap-2 ${form.role === r.value ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
            >
              {r.value === "admin" ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
              {r.label}
            </button>
          ))}
        </div>
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOp, setEditingOp] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
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
          body: `Hola ${data.name},\n\nTu cuenta de acceso a la Central de Despacho fue creada.\n\n📱 Celular: ${data.phone}\n🔑 PIN: ${data.pin}\n\nIngresá desde:\n${appUrl}\n\nPor seguridad, te recomendamos no compartir tu PIN con nadie.\n\nSaludos,\nEquipo de la Central`
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

  const roleInfo = (r) => ROLES.find(x => x.value === r) || ROLES[1];

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Operadores y Admins
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Ingresarán con su número de celular y PIN.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Agregar
        </Button>
      </div>

      {/* Dialog crear */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuevo operador</DialogTitle></DialogHeader>
          <OperatorForm onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Dialog editar */}
      <Dialog open={!!editingOp} onOpenChange={(v) => !v && setEditingOp(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar — {editingOp?.name}</DialogTitle></DialogHeader>
          <OperatorForm initial={editingOp} onSubmit={(data) => editMutation.mutate({ id: editingOp.id, data })} isSubmitting={editMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Lista */}
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
        <div className="space-y-2">
          {operators.map((op) => {
            const ri = roleInfo(op.role);
            return (
              <Card key={op.id} className={`transition-shadow ${op.active === false ? "opacity-60" : "hover:shadow-sm"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      {op.role === "admin" ? <Shield className="w-5 h-5 text-purple-500" /> : <User className="w-5 h-5 text-blue-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{op.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {op.phone}
                        {op.pin ? <span className="ml-2 text-green-600 font-medium">· PIN creado</span> : <span className="ml-2 text-amber-500 font-medium">· Sin PIN</span>}
                      </p>
                      {op.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> {op.email}</p>}
                    </div>
                    <Badge variant="outline" className={`text-xs shrink-0 ${ri.color}`}>{ri.label}</Badge>
                    <div className="flex items-center gap-1">
                      <button
                        title="Editar"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        onClick={() => setEditingOp(op)}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        title="Resetear PIN"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        onClick={() => { setResetPinTarget(op); setResetPinSuccess(null); }}
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button
                        title={op.active === false ? "Habilitar" : "Deshabilitar"}
                        className={`p-1.5 rounded-lg transition-colors ${op.active === false ? "text-green-600 hover:bg-green-50" : "text-muted-foreground hover:text-orange-600 hover:bg-orange-50"}`}
                        onClick={() => toggleMutation.mutate({ id: op.id, active: op.active === false ? true : false })}
                      >
                        {op.active === false ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      </button>
                      <button
                        title="Eliminar"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                        onClick={() => setDeleteTarget(op)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {op.notes && <p className="mt-2 text-xs text-muted-foreground pl-13 ml-[52px]">{op.notes}</p>}
                </CardContent>
              </Card>
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
              Se generará un PIN temporal de 4 dígitos. Dáselo al operador para que ingrese.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {resetPinSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-sm text-green-700">PIN temporal generado:</p>
              <p className="text-3xl font-mono font-black text-green-800 tracking-[0.3em] mt-1">{resetPinSuccess}</p>
              <p className="text-xs text-green-600 mt-1">Entregáselo al operador en persona.</p>
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