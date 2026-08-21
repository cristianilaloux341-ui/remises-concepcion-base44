import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DollarSign, Save, Loader2, Lock, Moon, Sun, KeyRound, Timer } from "lucide-react";

const DEFAULTS = {
  bajada_bandera: 1700,
  valor_ficha: 100,
  metros_por_ficha: 82,
  valor_ficha_espera: 100,
  segundos_por_ficha_espera: 45,
  tolerancia_espera_segundos: 240,
  nocturna_bajada_bandera: 1900,
  nocturna_hora_inicio: 22,
  nocturna_hora_fin: 6,
  minutos_libre_post_viaje: 0,
  tiempo_maximo_respuesta_segundos: 60,
  auto_reasignacion_activa: true,
  auto_aceptar_viajes: false,
};

function CampoMoneda({ label, description, field, form, onChange }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-semibold">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
        <Input
          type="number"
          min={0}
          step={1}
          className="pl-7"
          value={form[field]}
          onChange={(e) => onChange(field, e.target.value)}
        />
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export default function TarifaConfigPanel() {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(DEFAULTS);
  const [unlocked, setUnlocked] = useState(false);
  const [claveInput, setClaveInput] = useState("");
  const [claveError, setClaveError] = useState(false);
  const [settingClave, setSettingClave] = useState(false);
  const [newClave, setNewClave] = useState("");
  const [newClaveConfirm, setNewClaveConfirm] = useState("");

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["tarifa_config"],
    queryFn: () => base44.entities.TarifaConfig.list(),
  });

  const config = configs[0];

  useEffect(() => {
    if (config) {
      setForm({
         bajada_bandera: config.bajada_bandera ?? DEFAULTS.bajada_bandera,
         valor_ficha: config.valor_ficha ?? DEFAULTS.valor_ficha,
         metros_por_ficha: config.metros_por_ficha ?? DEFAULTS.metros_por_ficha,
         valor_ficha_espera: config.valor_ficha_espera ?? config.valor_ficha ?? DEFAULTS.valor_ficha_espera,
         segundos_por_ficha_espera: config.segundos_por_ficha_espera ?? DEFAULTS.segundos_por_ficha_espera,
         tolerancia_espera_segundos: config.tolerancia_espera_segundos ?? DEFAULTS.tolerancia_espera_segundos,
         nocturna_bajada_bandera: config.nocturna_bajada_bandera ?? DEFAULTS.nocturna_bajada_bandera,
         nocturna_hora_inicio: config.nocturna_hora_inicio ?? DEFAULTS.nocturna_hora_inicio,
         nocturna_hora_fin: config.nocturna_hora_fin ?? DEFAULTS.nocturna_hora_fin,
         minutos_libre_post_viaje: config.minutos_libre_post_viaje ?? DEFAULTS.minutos_libre_post_viaje,
         tiempo_maximo_respuesta_segundos: config.tiempo_maximo_respuesta_segundos ?? DEFAULTS.tiempo_maximo_respuesta_segundos,
         auto_reasignacion_activa: config.auto_reasignacion_activa ?? DEFAULTS.auto_reasignacion_activa,
         auto_aceptar_viajes: config.auto_aceptar_viajes ?? DEFAULTS.auto_aceptar_viajes,
       });
    }
  }, [config?.id]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const numData = Object.fromEntries(
        Object.entries(data).map(([k, v]) => {
          if (typeof v === 'boolean') return [k, v];
          return [k, Number(v)];
        })
      );
      // Preservar la clave existente
      if (config?.clave_modificacion) {
        numData.clave_modificacion = config.clave_modificacion;
      }
      const res = await base44.functions.invoke('adminProxy', { 
        entity: 'TarifaConfig', 
        op: config?.id ? 'update' : 'create', 
        id: config?.id, 
        data: numData, 
        sessionToken: sessionStorage.getItem('local_operator_token') 
      });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      const localOp = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
      base44.entities.AuditLog.create({
        action: "modificar_tarifa",
        user_type: "admin",
        user_name: localOp?.name || "Administrador",
        details: `Nueva tarifa: bandera día $${form.bajada_bandera}, noche $${form.nocturna_bajada_bandera}, ficha $${form.valor_ficha} cada ${form.metros_por_ficha} m, espera $${form.valor_ficha_espera} cada ${form.segundos_por_ficha_espera} s, tolerancia ${form.tolerancia_espera_segundos} s`
      }).catch(() => {});

      qc.invalidateQueries(["tarifa_config"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const saveClaveMutation = useMutation({
    mutationFn: async (clave) => {
      const data = config?.id ? { clave_modificacion: clave } : { ...DEFAULTS, clave_modificacion: clave };
      const res = await base44.functions.invoke('adminProxy', { 
        entity: 'TarifaConfig', 
        op: config?.id ? 'update' : 'create', 
        id: config?.id, 
        data, 
        sessionToken: sessionStorage.getItem('local_operator_token') 
      });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries(["tarifa_config"]);
      setSettingClave(false);
      setNewClave("");
      setNewClaveConfirm("");
      setUnlocked(true);
    },
  });

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const positiveFields = ["bajada_bandera", "valor_ficha", "metros_por_ficha", "valor_ficha_espera", "segundos_por_ficha_espera", "nocturna_bajada_bandera"];
    if (positiveFields.some(field => !Number.isFinite(Number(form[field])) || Number(form[field]) <= 0)) {
      alert("Revisá los valores: banderas, fichas, metros y segundos deben ser mayores que cero.");
      return;
    }
    if (!Number.isFinite(Number(form.tolerancia_espera_segundos)) || Number(form.tolerancia_espera_segundos) < 0) {
      alert("La tolerancia debe ser cero o un número positivo.");
      return;
    }
    if ([form.nocturna_hora_inicio, form.nocturna_hora_fin].some(v => Number(v) < 0 || Number(v) > 23)) {
      alert("Las horas de la tarifa nocturna deben estar entre 0 y 23.");
      return;
    }
    const resumen = `Día: $${form.bajada_bandera}\nNoche: $${form.nocturna_bajada_bandera}\nDistancia: $${form.valor_ficha} cada ${form.metros_por_ficha} metros\nEspera: $${form.valor_ficha_espera} cada ${form.segundos_por_ficha_espera} segundos\nTolerancia: ${form.tolerancia_espera_segundos} segundos\n\n¿Confirmás esta nueva tarifa para los viajes que comiencen después de guardar?`;
    if (window.confirm(resumen)) saveMutation.mutate(form);
  };

  const handleUnlock = () => {
    const clave = config?.clave_modificacion;
    if (!clave) {
      // Sin clave configurada, mostrar pantalla para crear una
      setSettingClave(true);
      return;
    }
    if (claveInput === clave) {
      setUnlocked(true);
      setClaveError(false);
      setClaveInput("");
    } else {
      setClaveError(true);
    }
  };

  const handleSetClave = () => {
    if (!newClave || newClave !== newClaveConfirm) return;
    saveClaveMutation.mutate(newClave);
  };

  if (isLoading) return (
    <div className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  // Pantalla de configurar clave por primera vez
  if (settingClave || (!config?.clave_modificacion && !unlocked)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            Configurar clave de acceso
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-sm">
          <p className="text-sm text-muted-foreground">
            Definí una clave numérica para proteger la edición de tarifas. Necesitarás ingresarla cada vez que quieras modificarlas.
          </p>
          <div className="space-y-1.5">
            <Label>Nueva clave</Label>
            <Input
              type="password"
              placeholder="Ej: 1234"
              value={newClave}
              onChange={(e) => setNewClave(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmar clave</Label>
            <Input
              type="password"
              placeholder="Repetí la clave"
              value={newClaveConfirm}
              onChange={(e) => setNewClaveConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSetClave()}
            />
            {newClave && newClaveConfirm && newClave !== newClaveConfirm && (
              <p className="text-xs text-red-500">Las claves no coinciden</p>
            )}
          </div>
          <Button
            onClick={handleSetClave}
            disabled={!newClave || newClave !== newClaveConfirm || saveClaveMutation.isPending}
            className="gap-2"
          >
            {saveClaveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Guardar clave y continuar
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Pantalla de ingreso de clave
  if (!unlocked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-muted-foreground" />
            Tarifas protegidas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-sm">
          <p className="text-sm text-muted-foreground">
            Ingresá la clave para poder modificar las tarifas.
          </p>
          <div className="space-y-1.5">
            <Label>Clave de acceso</Label>
            <Input
              type="password"
              placeholder="••••"
              value={claveInput}
              onChange={(e) => { setClaveInput(e.target.value); setClaveError(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              autoFocus
            />
            {claveError && <p className="text-xs text-red-500">Clave incorrecta</p>}
          </div>
          <Button onClick={handleUnlock} className="gap-2">
            <Lock className="w-4 h-4" />
            Desbloquear
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Formulario completo (desbloqueado)
  return (
    <div className="space-y-6">

      {/* Tarifa diurna */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="w-5 h-5 text-amber-500" />
            Tarifa Diurna
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CampoMoneda label="Bajada de bandera diurna" description="Importe inicial para viajes que comienzan durante el día" field="bajada_bandera" form={form} onChange={handleChange} />
        </CardContent>
      </Card>

      {/* Fichas compartidas por día y noche */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            Fichas y espera
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            El tiempo en movimiento no se cobra. Estos valores se aplican tanto de día como de noche.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CampoMoneda label="Precio por ficha" description="Importe que suma cada ficha de distancia" field="valor_ficha" form={form} onChange={handleChange} />
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Metros por ficha</Label>
              <div className="relative">
                <Input type="number" min={1} step={1} className="pr-14" value={form.metros_por_ficha} onChange={(e) => handleChange("metros_por_ficha", e.target.value)} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">metros</span>
              </div>
              <p className="text-xs text-muted-foreground">Distancia completa necesaria para sumar una ficha</p>
            </div>
            <CampoMoneda label="Precio por ficha de espera" description="Importe que suma cada ficha mientras está detenido" field="valor_ficha_espera" form={form} onChange={handleChange} />
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Segundos por ficha de espera</Label>
              <div className="relative">
                <Input type="number" min={1} step={1} className="pr-14" value={form.segundos_por_ficha_espera} onChange={(e) => handleChange("segundos_por_ficha_espera", e.target.value)} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">seg</span>
              </div>
              <p className="text-xs text-muted-foreground">Tiempo completo detenido para sumar una ficha</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold">Tolerancia inicial de espera</Label>
              <div className="relative">
                <Input type="number" min={0} step={1} className="pr-14" value={form.tolerancia_espera_segundos} onChange={(e) => handleChange("tolerancia_espera_segundos", e.target.value)} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">seg</span>
              </div>
              <p className="text-xs text-muted-foreground">Se consume una sola vez durante todo el viaje</p>
            </div>
          </div>
          <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
            Ejemplo actual: bandera diurna <strong>${form.bajada_bandera}</strong> + <strong>${form.valor_ficha}</strong> cada <strong>{form.metros_por_ficha} m</strong>. Después de <strong>{form.tolerancia_espera_segundos} s</strong> acumulados detenido, suma <strong>${form.valor_ficha_espera}</strong> cada <strong>{form.segundos_por_ficha_espera} s</strong>.
          </div>
        </CardContent>
      </Card>

      {/* Tarifa nocturna */}
      <Card className="border-indigo-200 dark:border-indigo-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Moon className="w-5 h-5 text-indigo-500" />
            Tarifa Nocturna
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex gap-4 flex-wrap">
            <div className="space-y-1.5 w-36">
              <Label className="text-sm font-semibold">Hora inicio</Label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.nocturna_hora_inicio}
                  onChange={(e) => handleChange("nocturna_hora_inicio", e.target.value)}
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">hs</span>
              </div>
            </div>
            <div className="space-y-1.5 w-36">
              <Label className="text-sm font-semibold">Hora fin</Label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={form.nocturna_hora_fin}
                  onChange={(e) => handleChange("nocturna_hora_fin", e.target.value)}
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">hs</span>
              </div>
            </div>
            <div className="self-end pb-1">
              <p className="text-xs text-muted-foreground">
                Tarifa nocturna activa de las <strong>{form.nocturna_hora_inicio}:00</strong> a las <strong>{form.nocturna_hora_fin}:00</strong>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CampoMoneda label="Bajada de bandera" description="Es el único valor que cambia de noche" field="nocturna_bajada_bandera" form={form} onChange={handleChange} />
          </div>
        </CardContent>
      </Card>

      {/* Tiempos del sistema */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="w-5 h-5 text-orange-500" />
            Tiempos del sistema
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-800">Tiempo de espera post-viaje</p>
            <p className="text-sm text-muted-foreground">
              Minutos que debe esperar el chofer antes de poder ponerse libre luego de completar un viaje. <strong>0 = sin restricción</strong>.
            </p>
            <div className="space-y-1.5 max-w-xs">
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={60}
                  step={1}
                  className="pr-14"
                  value={form.minutos_libre_post_viaje}
                  onChange={(e) => handleChange("minutos_libre_post_viaje", e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">min</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <p className="text-sm font-semibold text-slate-800">Tiempo máximo para aceptar viaje</p>
            <p className="text-sm text-muted-foreground">
              Segundos máximos que tiene un chofer para aceptar un viaje antes de que se reasigne al próximo.
            </p>
            <div className="space-y-1.5 max-w-xs">
              <div className="relative">
                <Input
                  type="number"
                  min={10}
                  max={300}
                  step={1}
                  className="pr-14"
                  value={form.tiempo_maximo_respuesta_segundos}
                  onChange={(e) => handleChange("tiempo_maximo_respuesta_segundos", e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">seg</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">Reasignación automática de viajes</p>
                <p className="text-sm text-muted-foreground">
                  Si está activado, el sistema saltará automáticamente al siguiente móvil de la cola si el tiempo máximo se agota sin respuesta.
                </p>
              </div>
              <Switch
                checked={form.auto_reasignacion_activa}
                onCheckedChange={(val) => handleChange("auto_reasignacion_activa", val)}
              />
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">Auto-aceptar viajes al asignar (Modo Radio)</p>
                <p className="text-sm text-muted-foreground">
                  Si está activado, los viajes asignados a un chofer pasarán directamente a estado <strong>aceptado</strong> / <strong>en_viaje</strong> sin esperar confirmación desde la app.
                </p>
              </div>
              <Switch
                checked={form.auto_aceptar_viajes}
                onCheckedChange={(val) => handleChange("auto_aceptar_viajes", val)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className={`gap-2 ${saved ? "bg-green-500 hover:bg-green-600" : ""}`}
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saved ? "¡Guardado!" : "Guardar Tarifas"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => { setUnlocked(false); setSettingClave(true); }}
        >
          <KeyRound className="w-4 h-4" />
          Cambiar clave
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setUnlocked(false)}
        >
          Bloquear
        </Button>
      </div>
    </div>
  );
}