import { Timer } from "lucide-react";
import TiempoEsperaConfig from "@/components/tarifa/TiempoEsperaConfig";

export default function TiempoEspera() {
  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Timer className="w-6 h-6 text-orange-500" />
          Tiempo de Espera Post-Viaje
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Minutos obligatorios antes de que el chofer pueda volver a darse como libre tras completar un viaje.
        </p>
      </div>
      <TiempoEsperaConfig />
    </div>
  );
}