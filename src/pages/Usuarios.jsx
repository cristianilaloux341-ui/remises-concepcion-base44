import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Users, UserPlus, Mail, Shield, User, Loader2, CheckCircle2, AlertCircle, Trash2, RefreshCw } from "lucide-react";

const ROLES = [
  { value: "admin", label: "Administrador", description: "Acceso completo: choferes, móviles, tarifas, zonas", color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "user", label: "Operador", description: "Despacho, órdenes, clientes, agenda y mensajes", color: "bg-blue-100 text-blue-700 border-blue-200" },
];

export default function Usuarios() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["app_users"],
    queryFn: () => base44.entities.User.list(),
  });

  const inviteMutation = useMutation({
    mutationFn: () => base44.users.inviteUser(email.trim().toLowerCase(), role),
    onSuccess: () => {
      setInviteSuccess(true);
      setEmail("");
      setInviteError("");
      qc.invalidateQueries({ queryKey: ["app_users"] });
      setTimeout(() => setInviteSuccess(false), 3000);
    },
    onError: (e) => {
      setInviteError(e?.message || "No se pudo enviar la invitación. Verificá el correo.");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }) => base44.entities.User.update(id, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["app_users"] }),
  });

  const handleInvite = () => {
    if (!email.trim()) return;
    setInviteError("");
    inviteMutation.mutate();
  };

  const roleInfo = (r) => ROLES.find(x => x.value === r) || ROLES[1];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          Usuarios del Sistema
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Invitá operadores y administradores. Cada uno recibirá un email para crear su contraseña.
        </p>
      </div>

      {/* Formulario de invitación */}
      <Card>
        <CardContent className="pt-6 space-y-5">
          <h2 className="font-semibold flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" />
            Invitar nuevo usuario
          </h2>

          <div className="space-y-2">
            <Label>Correo electrónico</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="operador@empresa.com"
                className="pl-9"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setInviteError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Rol</Label>
            <div className="flex gap-3 flex-wrap">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRole(r.value)}
                  className={`flex-1 min-w-[160px] text-left p-3 rounded-xl border-2 transition-all ${
                    role === r.value
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {r.value === "admin" ? <Shield className="w-4 h-4 text-purple-500" /> : <User className="w-4 h-4 text-blue-500" />}
                    <span className="font-semibold text-sm">{r.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                </button>
              ))}
            </div>
          </div>

          {inviteError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {inviteError}
            </div>
          )}
          {inviteSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> Invitación enviada correctamente.
            </div>
          )}

          <Button
            onClick={handleInvite}
            disabled={!email.trim() || inviteMutation.isPending}
            className="gap-2"
          >
            {inviteMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <UserPlus className="w-4 h-4" />}
            Enviar invitación
          </Button>
        </CardContent>
      </Card>

      {/* Lista de usuarios */}
      <div className="space-y-3">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Usuarios registrados ({users.length})
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">No hay usuarios registrados aún.</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => {
              const ri = roleInfo(u.role);
              return (
                <Card key={u.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        {u.role === "admin"
                          ? <Shield className="w-5 h-5 text-purple-500" />
                          : <User className="w-5 h-5 text-blue-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{u.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${ri.color}`}>
                        {ri.label}
                      </Badge>
                      {/* Cambiar rol */}
                      <button
                        title="Cambiar rol"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        onClick={() => {
                          const newRole = u.role === "admin" ? "user" : "admin";
                          updateRoleMutation.mutate({ id: u.id, role: newRole });
                        }}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm delete (reserved for future, UI ready) */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" /> Eliminar usuario
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Eliminar a <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong>? Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 mt-2">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => setDeleteTarget(null)}
            >
              Eliminar
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}