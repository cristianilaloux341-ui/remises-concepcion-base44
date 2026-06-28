import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, Copy, ExternalLink, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function DriverLink() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  // Detectar la URL base correcta:
  // - Si estamos en el editor de Base44, window.location.origin es la URL del builder, no la app publicada
  // - Guardamos la URL publicada en localStorage si el usuario la ingresa manualmente
  const getPublishedUrl = () => {
    const saved = localStorage.getItem("published_app_url");
    if (saved) return saved;
    // Si la URL contiene "base44.app" o "localhost", probablemente estamos en el editor
    const origin = window.location.origin;
    if (origin.includes("base44.app") || origin.includes("localhost")) return null;
    return origin;
  };

  const [publishedUrl, setPublishedUrl] = useState(getPublishedUrl() || "");
  const [editingUrl, setEditingUrl] = useState(!getPublishedUrl());

  const driverUrl = publishedUrl ? `${publishedUrl.replace(/\/$/, "")}/driver-app` : "";

  const handleSaveUrl = () => {
    if (publishedUrl) {
      localStorage.setItem("published_app_url", publishedUrl.replace(/\/$/, ""));
      setEditingUrl(false);
    }
  };

  const handleCopy = () => {
    if (!driverUrl) return;
    navigator.clipboard.writeText(driverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">App para Chóferes</h1>
        <p className="text-muted-foreground mt-1">Compartí este link con tus chóferes para que usen la app en su celular</p>
      </div>

      {/* Configurar URL publicada */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            URL de tu app publicada
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ingresá la URL de tu app publicada (la que te dio Base44 al publicar, ej: <span className="font-mono text-xs">https://mi-app.base44.app</span>)
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={publishedUrl}
              onChange={e => setPublishedUrl(e.target.value)}
              placeholder="https://tu-app.base44.app"
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button size="sm" onClick={handleSaveUrl} disabled={!publishedUrl}>
              Guardar
            </Button>
          </div>
          {!editingUrl && publishedUrl && (
            <button className="text-xs text-muted-foreground underline" onClick={() => setEditingUrl(true)}>
              Cambiar URL
            </button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="w-5 h-5 text-primary" />
            Link de la App para Chóferes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {driverUrl ? (
            <>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-xl font-mono text-sm break-all">
                {driverUrl}
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 gap-2 rounded-xl" onClick={handleCopy}>
                  {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "¡Copiado!" : "Copiar Link"}
                </Button>
                <Button variant="outline" className="gap-2 rounded-xl" onClick={() => window.open(driverUrl, "_blank")}>
                  <ExternalLink className="w-4 h-4" /> Abrir
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Guardá la URL de tu app arriba para generar el link.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Cómo funciona?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { n: 1, t: "El chófer abre el link en su celular" },
            { n: 2, t: "Ingresa su número de celular y PIN" },
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