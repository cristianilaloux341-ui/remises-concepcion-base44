import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogIn, Loader2, Phone, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SwitchUserModal({ open, onClose, onSuccess }) {
  const [step, setStep] = useState("phone"); // 'phone' | 'pin'
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [foundOp, setFoundOp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setStep("phone");
    setPhone("");
    setPin("");
    setFoundOp(null);
    setError("");
  };

  const handleClose = () => { reset(); onClose(); };

  const handlePhoneSubmit = async () => {
    const normalized = phone.replace(/\s|-|\(|\)/g, "");
    if (!normalized) { setError("Ingresá tu número de celular"); return; }
    setLoading(true);
    setError("");
    try {
      const operators = await base44.entities.Operator.list();
      const found = operators.find(op => {
        const dp = (op.phone || "").replace(/\s|-|\(|\)/g, "");
        return dp === normalized || dp.endsWith(normalized) || normalized.endsWith(dp);
      });
      if (!found) { setError("No se encontró ningún operador con ese número."); setLoading(false); return; }
      if (found.active === false) { setError("Este usuario está deshabilitado. Consultá al administrador."); setLoading(false); return; }
      setFoundOp(found);
      setStep("pin");
    } catch (_) {
      setError("Error al buscar. Intentá de nuevo.");
    }
    setLoading(false);
  };

  const handlePinSubmit = () => {
    if (!pin) { setError("Ingresá tu PIN"); return; }
    if (pin !== foundOp.pin) { setError("PIN incorrecto"); return; }
    reset();
    onSuccess(foundOp);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-primary" />
            Cambiar de usuario
          </DialogTitle>
        </DialogHeader>

        {step === "phone" && (
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground -mt-2">Ingresá tu número de celular.</p>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={e => { setPhone(e.target.value); setError(""); }}
                onKeyDown={e => e.key === "Enter" && handlePhoneSubmit()}
                placeholder="3442 123456"
                autoFocus
                className="w-full pl-9 pr-4 py-2.5 rounded-md border border-input bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {error && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="w-4 h-4" />{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={handleClose} disabled={loading}>Cancelar</Button>
              <Button className="flex-1" onClick={handlePhoneSubmit} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continuar"}
              </Button>
            </div>
          </div>
        )}

        {step === "pin" && (
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-xl">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                <span className="text-primary-foreground font-bold text-sm">{foundOp?.name?.charAt(0)}</span>
              </div>
              <div>
                <p className="font-semibold text-sm">{foundOp?.name}</p>
                <p className="text-xs text-muted-foreground">{foundOp?.role === "admin" ? "Administrador" : "Operador"}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Ingresá tu PIN de acceso.</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
              onKeyDown={e => e.key === "Enter" && handlePinSubmit()}
              placeholder="••••"
              autoFocus
              className="w-full text-center text-2xl tracking-[0.4em] py-3 rounded-md border border-input bg-transparent focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {error && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle className="w-4 h-4" />{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setStep("phone"); setPin(""); setError(""); }}>← Volver</Button>
              <Button className="flex-1" onClick={handlePinSubmit}>Ingresar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}