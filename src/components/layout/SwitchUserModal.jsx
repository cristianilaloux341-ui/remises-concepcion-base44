import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SwitchUserModal({ open, onClose, onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      // Reload user data without full page reload
      const newUser = await base44.auth.me();
      onSuccess(newUser);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError("Credenciales incorrectas. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-primary" />
            Cambiar de usuario
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Ingresá con otra cuenta. Los datos del sistema se mantienen.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="su-email">Email</Label>
            <Input
              id="su-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@remiseria.com"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="su-pass">Contraseña</Label>
            <Input
              id="su-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Ingresar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}