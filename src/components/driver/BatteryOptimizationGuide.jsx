/**
 * Guía paso a paso para desactivar la optimización de batería en Android.
 * Se muestra cuando el chofer entra en servicio por primera vez.
 */
import { useState } from "react";
import { Battery, BatteryFull, X, ChevronRight, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

// Detectar fabricante a partir del User-Agent para dar instrucciones específicas
function detectBrand() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("samsung")) return "samsung";
  if (ua.includes("xiaomi") || ua.includes("miui")) return "xiaomi";
  if (ua.includes("huawei") || ua.includes("honor")) return "huawei";
  if (ua.includes("oppo") || ua.includes("realme") || ua.includes("oneplus")) return "oppo";
  if (ua.includes("motorola") || ua.includes("moto")) return "motorola";
  return "generic";
}

const BRAND_STEPS = {
  samsung: [
    "Abrí **Ajustes** → **Batería y cuidado del dispositivo**",
    "Tocá **Batería** → **Límites de uso en segundo plano**",
    "Buscá **Chrome** y cambiá a **Sin restricciones**",
    "Volvé atrás y tocá **Optimización de batería**",
    "En el menú desplegable elegí **Todas las apps**, buscá **Chrome** → **No optimizar**",
  ],
  xiaomi: [
    "Abrí **Ajustes** → **Aplicaciones** → **Gestionar apps**",
    "Buscá **Chrome** y tocalo",
    "Tocá **Ahorro de batería** → seleccioná **Sin restricciones**",
    "Volvé y activá **Inicio automático** para Chrome",
    "En **Ajustes** → **Batería y rendimiento** → desactivá **Ahorro de batería** para Chrome",
  ],
  huawei: [
    "Abrí **Ajustes** → **Batería**",
    "Tocá **Inicio de aplicaciones**",
    "Buscá **Chrome** y desactivá el interruptor automático",
    "Activá manualmente: **Inicio automático**, **Inicio secundario** y **Ejecutar en segundo plano**",
  ],
  oppo: [
    "Abrí **Ajustes** → **Batería** → **Optimización de batería**",
    "Buscá **Chrome** → **No optimizar**",
    "También en **Ajustes** → **Gestión de apps** → **Chrome** → **Uso de batería** → **Sin restricciones**",
  ],
  motorola: [
    "Abrí **Ajustes** → **Aplicaciones** → **Ver todas las apps**",
    "Buscá **Chrome** → **Batería**",
    "Seleccioná **Sin restricciones**",
  ],
  generic: [
    "Abrí **Ajustes** de tu teléfono",
    "Buscá **Batería** o **Ahorro de energía**",
    "Buscá **Optimización de apps** o **Batería adaptable**",
    "Buscá **Chrome** y seleccioná **Sin restricciones** o **No optimizar**",
  ],
};

const BRAND_NAMES = {
  samsung: "Samsung", xiaomi: "Xiaomi / MIUI", huawei: "Huawei / Honor",
  oppo: "OPPO / Realme / OnePlus", motorola: "Motorola", generic: "Android",
};

function renderStep(step) {
  // Convierte **texto** en negrita
  const parts = step.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i} className="text-gray-900">{p}</strong> : p
  );
}

export default function BatteryOptimizationGuide({ onClose, onDone }) {
  const brand = detectBrand();
  const steps = BRAND_STEPS[brand];
  const brandName = BRAND_NAMES[brand];
  const [currentStep, setCurrentStep] = useState(0);
  const [done, setDone] = useState(false);

  const handleDone = () => {
    localStorage.setItem("battery_opt_done", "1");
    setDone(true);
    setTimeout(() => onDone?.(), 1200);
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="bg-white rounded-3xl p-8 text-center space-y-4 max-w-xs w-full">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-lg font-bold text-gray-900">¡Perfecto!</p>
          <p className="text-sm text-gray-500">Tu teléfono ya está configurado para recibir viajes aunque la pantalla esté apagada.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-end justify-center p-4 pb-8" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-amber-500 px-5 pt-5 pb-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <BatteryFull className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-white text-base leading-tight">Configurar batería en segundo plano</p>
            <p className="text-amber-100 text-xs mt-0.5">Detectamos: {brandName}</p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Por qué es importante */}
        <div className="bg-amber-50 border-b border-amber-100 px-5 py-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            <strong>⚠️ Importante:</strong> Android mata Chrome para ahorrar batería. Sin esta configuración, podrías perderte viajes cuando la pantalla esté apagada.
          </p>
        </div>

        {/* Steps */}
        <div className="px-5 py-4">
          {/* Progress */}
          <div className="flex gap-1 mb-4">
            {steps.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= currentStep ? "bg-amber-500" : "bg-gray-100"}`} />
            ))}
          </div>

          <div className="space-y-3">
            {steps.map((step, i) => (
              <div key={i} className={`flex items-start gap-3 p-3 rounded-xl transition-all ${i === currentStep ? "bg-amber-50 border border-amber-200" : i < currentStep ? "opacity-50" : "opacity-30"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${i < currentStep ? "bg-green-500 text-white" : i === currentStep ? "bg-amber-500 text-white" : "bg-gray-200 text-gray-400"}`}>
                  {i < currentStep ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{renderStep(step)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-6 flex gap-3">
          {currentStep < steps.length - 1 ? (
            <>
              <Button
                variant="outline"
                className="flex-1 rounded-2xl h-12"
                onClick={onClose}
              >
                Después
              </Button>
              <Button
                className="flex-1 rounded-2xl h-12 bg-amber-500 hover:bg-amber-600 gap-2"
                onClick={() => setCurrentStep(s => s + 1)}
              >
                Entendido <ChevronRight className="w-4 h-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1 rounded-2xl h-12"
                onClick={onClose}
              >
                Saltear
              </Button>
              <Button
                className="flex-1 rounded-2xl h-12 bg-green-500 hover:bg-green-600 gap-2"
                onClick={handleDone}
              >
                <CheckCircle2 className="w-4 h-4" /> ¡Listo!
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}