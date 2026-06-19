import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DollarSign, Save, Loader2 } from "lucide-react";

const DEFAULTS = {
  bajada_bandera: 500,
  precio_por_metro: 2,
  precio_por_minuto_espera: 50,
  tolerancia_espera_segundos: 120,
};

export default function TarifaConfigPanel() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
  });

  const config = configs[0] || {};
  const [form, setForm] = useState(null); // null = not yet initialized

  // Initialize form from fetched config (only once)
  const currentForm = form || {
    bajada_bandera: config.bajada_bandera ?? DEFAULTS.bajada_bandera,
    precio_por_metro: config.precio_por_metro ?? DEFAULTS.precio_por_metro,
    precio_por_minuto_espera: config.precio_por_minuto_espera ?? DEFAULTS.precio_por_minuto_espera,
    tolerancia_espera_segundos: config.tolerancia_espera_segundos ?? DEFAULTS.tolerancia_espera_segundos,
  };

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const numData = {
        bajada_bandera: Number(data.bajada_bandera),
        precio_por_metro: Number(data.precio_por_metro),
        precio_por_minuto_espera: Number(data.precio_por_minuto_espera),
        tolerancia_espera_segundos: Number(data.tolerancia_espera_segundos),
      };
      if (config.id) {
        return base44.entities.TarifaConfig.update(config.id, numData);
      } else {
        return base44.entities.TarifaConfig.create(numData);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(["tarifa_config"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleChange = (field, value) => {
    setForm(prev => ({ ...(prev || currentForm), [field]: value }));
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-green-600" />
          Configuración de Tarifas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Bajada de bandera ($)</Label>
            <Input
              type="number"
              min={0}
              value={currentForm.bajada_bandera}
              onChange={(e) => handleChange("bajada_bandera", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Importe fijo al iniciar el viaje</p>
          </div>
          <div className="space-y-1.5">
            <Label>Precio por metro ($)</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={currentForm.precio_por_metro}
              onChange={(e) => handleChange("precio_por_metro", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Se cobra por cada metro recorrido</p>
          </div>
          <div className="space-y-1.5">
            <Label>Precio por minuto de espera ($)</Label>
            <Input
              type="number"
              min={0}
              value={currentForm.precio_por_minuto_espera}
              onChange={(e) => handleChange("precio_por_minuto_espera", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Cuando el auto va a menos de 5 km/h</p>
          </div>
          <div className="space-y-1.5">
            <Label>Tolerancia de espera (segundos)</Label>
            <Input
              type="number"
              min={0}
              value={currentForm.tolerancia_espera_segundos}
              onChange={(e) => handleChange("tolerancia_espera_segundos", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Segundos de gracia antes de cobrar espera</p>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
          <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Ejemplo: viaje de 3 km</p>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bajada bandera</span>
            <span className="font-mono">${Number(currentForm.bajada_bandera).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">3.000 m × ${currentForm.precio_por_metro}/m</span>
            <span className="font-mono">${(3000 * Number(currentForm.precio_por_metro)).toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-semibold border-t pt-1 mt-1">
            <span>Total estimado</span>
            <span className="text-green-600">${(Number(currentForm.bajada_bandera) + 3000 * Number(currentForm.precio_por_metro)).toLocaleString()}</span>
          </div>
        </div>

        <Button
          onClick={() => saveMutation.mutate(currentForm)}
          disabled={saveMutation.isPending}
          className={`gap-2 ${saved ? "bg-green-500 hover:bg-green-600" : ""}`}
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? "¡Guardado!" : "Guardar Tarifas"}
        </Button>
      </CardContent>
    </Card>
  );
}