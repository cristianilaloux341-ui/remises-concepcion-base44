import { DollarSign, ArrowLeft } from "lucide-react";
import TarifaConfigPanel from "@/components/tarifa/TarifaConfig";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Tarifas() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-green-600" />
          Configuración de Tarifas
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Editá los valores de bajada de bandera, precio por metro y tiempos de espera. Guardá una vez y quedan activos hasta el próximo aumento.
        </p>
      </div>

      <TarifaConfigPanel />
    </div>
  );
}