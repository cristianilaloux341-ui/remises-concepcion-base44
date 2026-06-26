import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Phone, Lock, Loader2, Car } from "lucide-react";

export default function Login() {
  const [identifier, setIdentifier] = useState(""); // teléfono o email
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const val = identifier.trim();
      const isEmail = val.includes("@");

      let operators = [];
      if (isEmail) {
        operators = await base44.entities.Operator.filter({ email: val, active: true });
      } else {
        operators = await base44.entities.Operator.filter({ phone: val, active: true });
      }

      if (!operators || operators.length === 0) {
        setError("Usuario no encontrado o deshabilitado.");
        setLoading(false);
        return;
      }
      const op = operators[0];
      if (!op.pin || op.pin !== pin) {
        setError("PIN incorrecto.");
        setLoading(false);
        return;
      }
      localStorage.setItem("local_operator", JSON.stringify(op));
      window.location.href = "/";
    } catch (err) {
      setError("Error al iniciar sesión. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Car className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Central de Despacho</h1>
          <p className="text-muted-foreground text-sm mt-1">Ingresá con tu celular o email y PIN</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Celular o Email</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="identifier"
                type="text"
                autoFocus
                placeholder="3442 123456 o email@ejemplo.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pin">PIN</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="pl-10 h-12 tracking-widest"
                required
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full h-12 font-semibold" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Ingresar
          </Button>
        </form>
      </div>
    </div>
  );
}