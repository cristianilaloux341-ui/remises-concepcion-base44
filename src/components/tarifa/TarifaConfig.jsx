import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DollarSign, Save, Loader2 } from "lucide-react";

const DEFAULTS = {
  bajada_bandera: 500,
  precio_por_km: 2000,
  precio_por_minuto_corrido: 30,
  precio_por_minuto_espera: 50,
  tolerancia_espera_segundos: 120,
};

export default function TarifaConfigPanel() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(DEFAULTS);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
  });

  const config = configs[0];

  useEffect(() => {
    if (config) {
      setForm({
        bajada_bandera: config.bajada_bandera ?? DEFAULTS.bajada_bandera,
        precio_por_km: config.precio_por_km ?? DEFAULTS.precio_por_km,
        precio_por_minuto_corrido: config.precio_por_minuto_corrido ?? DEFAULTS.precio_por_minuto_corrido,
        precio_por_minuto_espera: config.precio_por_minuto_espera ?? DEFAULTS.precio_por_minuto_espera,
        tolerancia_espera_segundos: config.tolerancia_espera_segundos ?? DEFAULTS.tolerancia_espera_segundos,
      });
    }
  }, [config?.id]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const numData = {
        bajada_bandera: Number(data.bajada_bandera),
        precio_por_km: Number(data.precio_por_km),
        precio_por_minuto_corrido: Number(data.precio_por_minuto_corrido),
        precio_por_minuto_espera: Number(data.precio_por_minuto_espera),
        tolerancia_espera_segundos: Number(data.tolerancia_espera_segundos),
      };
      if (config?.id) {
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
    setForm(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) return (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  // Preview: 3km, 10 min corrido, 2 min espera
  const previewKm = 3;
  const previewMinCorrido = 10;
  const previewMinEspera = 2;
  const previewTotal =
    Number(form.bajada_bandera) +
    previewKm * Number(form.precio_por_km) +
    previewMinCorrido * Number(form.precio_por_minuto_corrido) +
    previewMinEspera * Number(form.precio_por_minuto_espera);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          Tarifas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Grid de campos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Bajada de bandera */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Bajada de bandera</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                className="pl-7"
                value={form.bajada_bandera}
                onChange={(e) => handleChange("bajada_bandera", e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Importe fijo al iniciar el viaje</p>
          </div>

          {/* Precio por km */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Precio por kilómetro</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                className="pl-7"
                value={form.precio_por_km}
                onChange={(e) => handleChange("precio_por_km", e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Por cada kilómetro recorrido</p>
          </div>

          {/* Tiempo corrido */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Tiempo corrido (por minuto)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                className="pl-7"
                value={form.precio_por_minuto_corrido}
                onChange={(e) => handleChange("precio_por_minuto_corrido", e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Por cada minuto en movimiento</p>
          </div>

          {/* Tiempo de espera */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Tiempo de espera (por minuto)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                min={0}
                step={1}
                className="pl-7"
                value={form.precio_por_minuto_espera}
                onChange={(e) => handleChange("precio_por_minuto_espera", e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Cuando el auto va a menos de 5 km/h</p>
          </div>

          {/* Tolerancia de espera */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold">Tolerancia de espera</Label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                step={1}
                className="pr-16"
                value={form.tolerancia_espera_segundos}
                onChange={(e) => handleChange("tolerancia_espera_segundos", e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">seg</span>
            </div>
            <p className="text-xs text-muted-foreground">Segundos de gracia antes de cobrar espera</p>
          </div>

        </div>

        {/* Preview */}
        <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1.5">
          <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">
            Ejemplo: 3 km · 10 min en ruta · 2 min espera
          </p>
          <div className="flex justify-between text-muted-foreground">
            <span>Bajada de bandera</span>
            <span className="font-mono text-foreground">${Number(form.bajada_bandera).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>3 km × ${Number(form.precio_por_km).toLocaleString()}/km</span>
            <span className="font-mono text-foreground">${(3 * Number(form.precio_por_km)).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>10 min corrido × ${Number(form.precio_por_minuto_corrido).toLocaleString()}/min</span>
            <span className="font-mono text-foreground">${(10 * Number(form.precio_por_minuto_corrido)).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>2 min espera × ${Number(form.precio_por_minuto_espera).toLocaleString()}/min</span>
            <span className="font-mono text-foreground">${(2 * Number(form.precio_por_minuto_espera)).toLocaleString()}</span>
          </div>
          <div className="flex justify-between font-bold border-t pt-2 mt-1 text-base">
            <span>Total estimado</span>
            <span className="text-green-600">${previewTotal.toLocaleString()}</span>
          </div>
        </div>

        <Button
          onClick={() => saveMutation.mutate(form)}
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