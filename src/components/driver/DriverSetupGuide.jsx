// Pantalla de instrucciones para que el chofer configure correctamente su teléfono
import { useState } from "react";
import { Battery, Bell, Phone, WifiOff, CheckCircle2, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import BatteryOptimizationGuide from "@/components/driver/BatteryOptimizationGuide";

const STEPS = [
  {
    icon: Bell,
    color: "bg-amber-500",
    title: "Permitir Notificaciones",
    desc: "Cuando llegue un viaje te vamos a notificar aunque la pantalla esté apagada. Tocá \"Permitir\" cuando el teléfono lo pida.",
    tip: "Si ya lo rechazaste: Ajustes → Notificaciones → Chrome → Activar",
  },
  {
    icon: WifiOff,
    color: "bg-blue-500",
    title: "No cierres la App",
    desc: "Podés apagar la pantalla — la app sigue activa en segundo plano. Lo que NO debés hacer es cerrarla deslizando desde el administrador de tareas.",
    tip: "Pantalla apagada ✅ | App cerrada ❌",
  },
  {
    icon: Battery,
    color: "bg-green-500",
    title: "Desactivar optimización de batería",
    desc: "⚠️ Este es el paso más importante. Android mata Chrome para ahorrar batería. Si no lo desactivás, podés perderte viajes con la pantalla apagada.",
    tip: "La app va a mostrarte instrucciones paso a paso según tu teléfono (Samsung, Xiaomi, Huawei, etc.)",
  },
  {
    icon: Phone,
    color: "bg-purple-500",
    title: "Instalar como App (recomendado)",
    desc: "Instalá la app en tu pantalla de inicio para mejor rendimiento y notificaciones más confiables.",
    tip: "Chrome ☰ → Agregar a pantalla de inicio",
  },
];

export default function DriverSetupGuide({ onClose }) {
  const [step, setStep] = useState(0);
  const [showBatteryDetail, setShowBatteryDetail] = useState(false);
  const isLast = step === STEPS.length - 1;
  const s = STEPS[step];
  const Icon = s.icon;
  const isBatteryStep = step === 2; // índice 2 = batería

  if (showBatteryDetail) {
    return (
      <BatteryOptimizationGuide
        onClose={() => setShowBatteryDetail(false)}
        onDone={() => { setShowBatteryDetail(false); setStep(s => s + 1 < STEPS.length ? s + 1 : s); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center p-4 pb-8" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Configuración {step + 1} de {STEPS.length}
          </p>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-4">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 space-y-5">
          <div className={`w-16 h-16 rounded-2xl ${s.color} flex items-center justify-center shadow-lg`}>
            <Icon className="w-8 h-8 text-white" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-gray-900">{s.title}</h2>
            <p className="text-gray-600 leading-relaxed">{s.desc}</p>
          </div>

          <div className="bg-gray-50 rounded-2xl px-4 py-3 border border-gray-100">
            <p className="text-sm text-gray-500 font-medium">{s.tip}</p>
          </div>

          {isBatteryStep && (
            <Button
              className="w-full rounded-2xl h-11 bg-amber-500 hover:bg-amber-600 gap-2 font-semibold"
              onClick={() => setShowBatteryDetail(true)}
            >
              <Battery className="w-4 h-4" /> Ver instrucciones para mi teléfono
            </Button>
          )}

          <div className="flex gap-3 pt-1">
            {step > 0 && (
              <Button
                variant="outline"
                className="flex-1 rounded-2xl h-12"
                onClick={() => setStep(step - 1)}
              >
                Atrás
              </Button>
            )}
            <Button
              className={`rounded-2xl h-12 gap-2 ${isLast ? "bg-green-500 hover:bg-green-600 shadow-lg shadow-green-500/20" : "bg-blue-600 hover:bg-blue-700"} ${step === 0 ? "w-full" : "flex-1"}`}
              onClick={() => { if (isLast) onClose(); else setStep(step + 1); }}
            >
              {isLast ? (
                <><CheckCircle2 className="w-5 h-5" /> ¡Listo, entendido!</>
              ) : (
                <>Siguiente <ChevronRight className="w-5 h-5" /></>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}