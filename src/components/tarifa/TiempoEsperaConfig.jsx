import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Save, Loader2, Timer, CheckCircle2 } from "lucide-react";

export default function TiempoEsperaConfig() {
  const qc = useQueryClient();
  const [minutos, setMinutos] = useState(0);
  const [saved, setSaved] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
  });

  const config = configs[0];

  useEffect(() => {
    if (config) {
      setMinutos(config.minutos_libre_post_viaje ?? 0);
    }
  }, [config?.id]);

  const saveMutation = useMutation({
    mutationFn: async (value) => {
      if (config?.id) {
        return base44.entities.TarifaConfig.update(config.id, { minutos_libre_post_viaje: Number(value) });
      } else {
        return base44.entities.TarifaConfig.create({ minutos_libre_post_viaje: Number(value) });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(["tarifa_config"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (isLoading) return (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start gap-3 p-3 bg-orange-50 border border-orange-200 rounded-xl">
          <Timer className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
          <p className="text-sm text-orange-800">
            Al completar un viaje, el chofer deberá esperar este tiempo antes de poder ponerse libre.
            Poner <strong>0</strong> deshabilita la restricción.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Minutos de espera obligatoria</Label>
          <div className="flex items-center gap-3">
            <div className="relative w-36">
              <Input
                type="number"
                min={0}
                max={60}
                step={1}
                className="pr-12 text-lg font-bold text-center"
                value={minutos}
                onChange={(e) => setMinutos(e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-medium">min</span>
            </div>
            <div className="flex gap-2">
              {[0, 5, 10, 15, 20].map((v) => (
                <button
                  key={v}
                  onClick={() => setMinutos(v)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    Number(minutos) === v
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-200"
                  }`}
                >
                  {v === 0 ? "Off" : `${v}m`}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {Number(minutos) === 0
              ? "Sin restricción — el chofer puede ponerse libre al instante."
              : `El chofer deberá esperar ${minutos} minuto${Number(minutos) !== 1 ? "s" : ""} antes de poder volver a la cola.`}
          </p>
        </div>

        <Button
          onClick={() => saveMutation.mutate(minutos)}
          disabled={saveMutation.isPending}
          className={`gap-2 ${saved ? "bg-green-500 hover:bg-green-600" : ""}`}
        >
          {saveMutation.isPending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : saved
              ? <CheckCircle2 className="w-4 h-4" />
              : <Save className="w-4 h-4" />}
          {saved ? "¡Guardado!" : "Guardar"}
        </Button>
      </CardContent>
    </Card>
  );
}