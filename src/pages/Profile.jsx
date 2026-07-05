import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserCircle, LogOut, Trash2, AlertTriangle } from "lucide-react";

export default function Profile() {
  const { user, logout } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const localOperator = (() => {
    try { return JSON.parse(localStorage.getItem("local_operator") || "null"); } catch { return null; }
  })();
  const displayUser = localOperator || user;

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      // Clear local data
      localStorage.clear();
      // Logout and redirect
      await logout(false);
      window.location.href = "/login";
    } catch (e) {
      setDeleteError("No se pudo eliminar la cuenta. Contactá al administrador.");
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 py-4">
      <h1 className="text-2xl font-bold">Perfil y Ajustes</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCircle className="w-5 h-5" /> Mi Cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-primary font-bold text-lg">{(displayUser?.name || displayUser?.full_name || "U").charAt(0)}</span>
            </div>
            <div>
              <p className="font-semibold">{displayUser?.name || displayUser?.full_name || "Usuario"}</p>
              <p className="text-sm text-muted-foreground">{displayUser?.email || displayUser?.phone || ""}</p>
              <p className="text-xs text-muted-foreground capitalize">{localOperator?.role === "admin" || localOperator?.role === "Administrador General" ? "Directivo" : localOperator ? "Operador" : user?.role === "admin" ? "Directivo" : "Operador"}</p>
            </div>
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={() => {
            localStorage.removeItem("local_operator");
            localStorage.removeItem("admin_bypass");
            logout(false);
            window.location.href = "/login";
          }}>
            <LogOut className="w-4 h-4" /> Cerrar Sesión
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="w-5 h-5" /> Eliminación de Cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Al eliminar tu cuenta, se borrará toda tu sesión local y serás desconectado de la aplicación. Los datos operativos del sistema no son eliminados automáticamente — contactá al administrador para la baja definitiva.
          </p>
          {!showDeleteConfirm ? (
            <Button variant="destructive" className="w-full gap-2" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="w-4 h-4" /> Solicitar Eliminación de Cuenta
            </Button>
          ) : (
            <div className="space-y-3 p-4 bg-destructive/10 rounded-xl border border-destructive/30">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-semibold">¿Confirmás la eliminación?</p>
              </div>
              <p className="text-xs text-muted-foreground">Esta acción cerrará tu sesión y borrará todos los datos locales del dispositivo.</p>
              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                  Cancelar
                </Button>
                <Button variant="destructive" className="flex-1 gap-2" onClick={handleDeleteAccount} disabled={deleting}>
                  {deleting ? "Eliminando..." : "Confirmar"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}