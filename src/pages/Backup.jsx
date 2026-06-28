import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Download, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ENTITIES = [
  { name: "Driver", label: "Chóferes" },
  { name: "Movil", label: "Móviles" },
  { name: "Client", label: "Clientes" },
  { name: "ClientAddress", label: "Direcciones de Clientes" },
  { name: "AddressHistory", label: "Historial de Direcciones" },
  { name: "RideOrder", label: "Órdenes de Viaje" },
  { name: "ScheduledRide", label: "Agenda (Viajes Programados)" },
  { name: "Message", label: "Mensajes" },
  { name: "Operator", label: "Operadores" },
  { name: "TarifaConfig", label: "Configuración de Tarifas" },
  { name: "ZoneMapping", label: "Mapeo de Zonas" },
  { name: "Base", label: "Bases" },
  { name: "PanicAlert", label: "Alertas de Pánico" },
];

export default function Backup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [done, setDone] = useState(false);

  const handleBackup = async () => {
    setLoading(true);
    setDone(false);
    setProgress("Iniciando backup...");

    const backup = {
      fecha: new Date().toISOString(),
      version: "1.0",
      datos: {},
    };

    for (const entity of ENTITIES) {
      setProgress(`Exportando: ${entity.label}...`);
      const records = await base44.entities[entity.name].list();
      backup.datos[entity.name] = records;
    }

    setProgress("Generando archivo...");
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup_agencia_${fecha}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setLoading(false);
    setDone(true);
    setProgress(null);
  };

  return (
    <div className="p-6 max-w-lg mx-auto space-y-4">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
      <div>
        <h1 className="text-2xl font-bold mb-1">Backup de la Agencia</h1>
      <p className="text-muted-foreground mb-8">
        Descargá un archivo JSON con todos los datos del sistema. Guardalo en un lugar seguro.
      </p>
      </div>

      <div className="bg-card border rounded-xl p-5 mb-6 space-y-2">
        <p className="text-sm font-medium mb-3">El backup incluye:</p>
        {ENTITIES.map((e) => (
          <div key={e.name} className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            {e.label}
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4 bg-muted px-4 py-3 rounded-xl">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {progress}
        </div>
      )}

      {done && !loading && (
        <div className="flex items-center gap-2 text-sm text-green-600 mb-4 bg-green-50 border border-green-200 px-4 py-3 rounded-xl">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Backup descargado correctamente.
        </div>
      )}

      <Button
        className="w-full h-11 gap-2 rounded-xl"
        onClick={handleBackup}
        disabled={loading}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {loading ? "Generando backup..." : "Descargar Backup"}
      </Button>
    </div>
  );
}