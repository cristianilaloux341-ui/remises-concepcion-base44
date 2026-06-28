import { Timer, ArrowLeft } from "lucide-react";
import TiempoEsperaConfig from "@/components/tarifa/TiempoEsperaConfig";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function TiempoEspera() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
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