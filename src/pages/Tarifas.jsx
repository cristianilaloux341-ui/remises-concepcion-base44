import { DollarSign } from "lucide-react";
import TarifaConfigPanel from "@/components/tarifa/TarifaConfig";

export default function Tarifas() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
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