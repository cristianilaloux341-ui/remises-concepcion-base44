import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Copy, ExternalLink, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { appParams } from "@/lib/app-params";

export default function DriverLink() {
  const [copied, setCopied] = useState(false);
  const baseUrl = appParams.appBaseUrl || window.location.origin;
  const url = `${baseUrl}/driver-app`;

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">App para Chóferes</h1>
        <p className="text-muted-foreground mt-1">Compartí este link con tus chóferes para que usen la app en su celular</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="w-5 h-5 text-primary" />
            Link de la App
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-xl font-mono text-sm break-all">
            {url}
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 gap-2 rounded-xl" onClick={handleCopy}>
              {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "¡Copiado!" : "Copiar Link"}
            </Button>
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => window.open(url, "_blank")}>
              <ExternalLink className="w-4 h-4" /> Abrir
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Cómo funciona?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { n: 1, t: "El chófer abre el link en su celular" },
            { n: 2, t: "Selecciona su nombre de la lista" },
            { n: 3, t: "Elige en qué base está y entra a la cola" },
            { n: 4, t: "Cuando la base le asigna un viaje, le aparece una alerta con sonido" },
            { n: 5, t: "Acepta o rechaza el viaje desde la pantalla" },
            { n: 6, t: "Ve el mapa con recogida y destino" },
            { n: 7, t: "Al completar, vuelve automáticamente a la cola" },
          ].map(({ n, t }) => (
            <div key={n} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
              <p className="text-sm text-muted-foreground pt-0.5">{t}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}