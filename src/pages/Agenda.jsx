import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Clock, Car, MapPin, Bell, BellOff, CheckCircle2, XCircle, Zap, Tag, ChevronDown } from "lucide-react";
import AddressAutocomplete from "@/components/orders/AddressAutocomplete";

const ZONES = ["1-Puerto", "2-Plaza", "3-Columna", "4-Base", "5-Cementerio", "6-Díaz Vélez", "7-Don Bosco", "8-Monumento"];
import { format, formatDistanceToNow, isPast, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { autoDispatch, assignDriverToOrder, detectZoneFromAddress } from "@/lib/dispatchLogic";
import { useTarifaConfig, calcularDistanciaRuta, calcularImporte } from "@/hooks/useTarifaConfig";

const STATUS_COLORS = {
  pendiente: "bg-amber-100 text-amber-700",
  notificado: "bg-blue-100 text-blue-700",
  despachado: "bg-purple-100 text-purple-700",
  completado: "bg-green-100 text-green-700",
  cancelado: "bg-red-100 text-red-700",
};

function ScheduledForm({ ride, drivers, onSave, onClose }) {
  const [form, setForm] = useState(ride || {
    client_name: "", client_phone: "", pickup_address: "", dropoff_address: "",
    zone: "",
    scheduled_datetime: "", notify_minutes_before: 10,
    require_specific_driver: false, preferred_driver_id: "", preferred_driver_name: "",
    fare: "", notes: ""
  });
  const [clients, setClients] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  const [filteredClients, setFilteredClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(ride?.client_id || "");
  const [calculandoTarifa, setCalculandoTarifa] = useState(false);
  const tariffConfig = useTarifaConfig();
  const debounceTimer = useRef(null);

  // Cargar clientes
  useEffect(() => {
    base44.entities.Client.list().then(data => setClients(data)).catch(() => {});
  }, []);

  // Filtrar clientes cuando cambia el nombre o teléfono
  useEffect(() => {
    const query = (form.client_name + form.client_phone).toLowerCase().trim();
    if (!query) {
      setFilteredClients([]);
      setShowClientSuggestions(false);
      return;
    }
    const filtered = clients.filter(c =>
      c.name.toLowerCase().includes(query) ||
      (c.phone && c.phone.toLowerCase().includes(query))
    ).slice(0, 5);
    setFilteredClients(filtered);
    setShowClientSuggestions(filtered.length > 0);
  }, [form.client_name, form.client_phone, clients]);

  const handleSelectClient = (client) => {
    setForm({
      ...form,
      client_name: client.name,
      client_phone: client.phone || "",
      pickup_address: client.pickup_address || form.pickup_address,
    });
    setSelectedClientId(client.id);
    setShowClientSuggestions(false);
  };

  // Auto-detect zone y calcular tarifa con debounce
  useEffect(() => {
    clearTimeout(debounceTimer.current);
    if (!form.pickup_address || !form.dropoff_address) {
      return;
    }
    
    debounceTimer.current = setTimeout(async () => {
      // Auto-detect zone
      if (form.pickup_address && !form.zone) {
        const detectedZone = await detectZoneFromAddress(form.pickup_address);
        if (detectedZone) {
          setForm(f => ({ ...f, zone: detectedZone }));
        }
      }

      // Auto-calculate fare via OSRM
      if (form.pickup_address && form.dropoff_address && tariffConfig) {
        setCalculandoTarifa(true);
        try {
          const distMetros = await calcularDistanciaRuta(form.pickup_address, form.dropoff_address);
          if (distMetros) {
            const fare = calcularImporte(distMetros, tariffConfig);
            setForm(f => ({ ...f, fare }));
          }
        } catch (_) {}
        setCalculandoTarifa(false);
      }
    }, 800);

    return () => clearTimeout(debounceTimer.current);
  }, [form.pickup_address, form.dropoff_address, tariffConfig]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 relative">
          <Label>Cliente</Label>
          <Input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} />
          {showClientSuggestions && filteredClients.length > 0 && (
            <div className="absolute top-[100%] left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 mt-1">
              {filteredClients.map(client => (
                <button
                  key={client.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 border-b last:border-b-0 transition-colors"
                  onClick={() => handleSelectClient(client)}
                >
                  <div className="font-medium">{client.name}</div>
                  <div className="text-xs text-gray-500">{client.phone || "Sin teléfono"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label>Teléfono</Label>
          <Input value={form.client_phone} onChange={e => setForm({ ...form, client_phone: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Dirección de recogida</Label>
        <AddressAutocomplete
          value={form.pickup_address}
          onChange={v => setForm({ ...form, pickup_address: v })}
          placeholder="Calle y altura..."
        />
      </div>
      <div className="space-y-1">
        <Label>Destino (opcional)</Label>
        <AddressAutocomplete
          value={form.dropoff_address}
          onChange={v => setForm({ ...form, dropoff_address: v })}
          placeholder="Destino..."
        />
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Zona</Label>
        <Select value={form.zone || ""} onValueChange={v => setForm({ ...form, zone: v })}>
          <SelectTrigger><SelectValue placeholder="Seleccionar zona..." /></SelectTrigger>
          <SelectContent>
            {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Fecha y hora del viaje</Label>
          <Input type="datetime-local" value={form.scheduled_datetime}
            onChange={e => setForm({ ...form, scheduled_datetime: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Alertar X min antes</Label>
          <Input type="number" min={1} value={form.notify_minutes_before}
            onChange={e => setForm({ ...form, notify_minutes_before: Number(e.target.value) })} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5">
            Tarifa (opcional)
            {calculandoTarifa && <span className="text-xs text-blue-500 animate-pulse">calculando...</span>}
          </Label>
          <Input type="number" value={form.fare} onChange={e => setForm({ ...form, fare: e.target.value })} placeholder={calculandoTarifa ? "..." : "0"} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.require_specific_driver}
          onCheckedChange={v => setForm({ ...form, require_specific_driver: v })} />
        <Label>Requiere móvil específico</Label>
      </div>

      {form.require_specific_driver && (
        <div className="space-y-1">
          <Label>Móvil asignado</Label>
          <Select
            value={form.preferred_driver_id || "ninguno"}
            onValueChange={v => {
              if (v === "ninguno") {
                setForm({ ...form, preferred_driver_id: "", preferred_driver_name: "" });
              } else {
                const d = drivers.find(d => d.id === v);
                setForm({ ...form, preferred_driver_id: v, preferred_driver_name: d?.name || "" });
              }
            }}
          >
            <SelectTrigger><SelectValue placeholder="Seleccionar móvil..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno">Sin preferencia</SelectItem>
              {drivers.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name} — {d.vehicle_plate}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <Label>Notas</Label>
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="h-16" />
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" onClick={() => onSave(form)}>Guardar Agenda</Button>
      </div>
    </div>
  );
}

function minutesUntil(datetime) {
  return differenceInMinutes(new Date(datetime), new Date());
}

export default function Agenda() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const notifiedRef = useRef(new Set());

  const { data: rides = [] } = useQuery({
    queryKey: ["scheduled"],
    queryFn: () => base44.entities.ScheduledRide.list("-scheduled_datetime", 200),
    refetchInterval: 10000,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
    refetchInterval: 10000,
  });

  const { data: bases = [] } = useQuery({
    queryKey: ["bases"],
    queryFn: () => base44.entities.Base.list(),
  });

  const saveMutation = useMutation({
    mutationFn: async (form) => {
      const dataToSave = { ...form };
      if (dataToSave.fare && String(dataToSave.fare).trim() !== "") {
        dataToSave.fare = Number(dataToSave.fare);
      } else {
        delete dataToSave.fare;
      }
      
      if (editing?.id) {
        await base44.entities.ScheduledRide.update(editing.id, dataToSave);
      } else {
        await base44.entities.ScheduledRide.create(dataToSave);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled"] });
      setShowForm(false);
      setEditing(null);
    }
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.ScheduledRide.update(id, { status: "cancelado" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled"] }),
  });

  const dispatchMutation = useMutation({
    mutationFn: async (ride) => {
      // Crear el pedido como pendiente
      const order = await base44.entities.RideOrder.create({
        client_name: ride.client_name,
        client_phone: ride.client_phone || "",
        pickup_address: ride.pickup_address,
        dropoff_address: ride.dropoff_address || "",
        zone: ride.zone || undefined,
        fare: ride.fare && String(ride.fare).trim() !== "" && Number(ride.fare) > 0 ? Number(ride.fare) : undefined,
        notes: ride.notes || "",
        status: "pendiente",
      });
      // Auto-asignar por zona (o broadcast si no hay nadie)
      // Si tiene móvil preferido, asignar directo
      if (ride.preferred_driver_id) {
        const prefDriver = drivers.find(d => d.id === ride.preferred_driver_id);
        if (prefDriver) await assignDriverToOrder(order, prefDriver);
      } else {
        await autoDispatch(order, drivers, bases);
      }
      await base44.entities.ScheduledRide.update(ride.id, { status: "despachado", order_id: order.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    }
  });

  const upcoming = rides.filter(r => !["cancelado", "completado"].includes(r.status))
    .sort((a, b) => new Date(a.scheduled_datetime) - new Date(b.scheduled_datetime));
  const past = rides.filter(r => ["cancelado", "completado", "despachado"].includes(r.status))
    .sort((a, b) => new Date(b.scheduled_datetime) - new Date(a.scheduled_datetime))
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Agenda</h1>
          <p className="text-muted-foreground mt-1">Viajes programados</p>
        </div>
        <Button className="rounded-xl gap-2" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Nueva Agenda
        </Button>
      </div>

      {/* Upcoming */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Próximos</h2>
        {upcoming.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground">Sin viajes programados</CardContent></Card>
        ) : upcoming.map(ride => {
          const mins = minutesUntil(ride.scheduled_datetime);
          const isUrgent = mins <= (ride.notify_minutes_before ?? 10) && mins >= 0;
          const isOverdue = mins < 0;
          return (
            <Card key={ride.id} className={`transition-all ${isUrgent ? "border-amber-400 bg-amber-50" : ""} ${isOverdue && ride.status === "notificado" ? "border-red-400 bg-red-50" : ""}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{ride.client_name}</p>
                      <Badge className={STATUS_COLORS[ride.status] + " border-0 text-xs"}>{ride.status}</Badge>
                      {isUrgent && <Badge className="bg-amber-500 text-white border-0 text-xs animate-pulse">¡{Math.max(0, mins)} min!</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{ride.client_phone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-sm">{format(new Date(ride.scheduled_datetime), "HH:mm", { locale: es })}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(ride.scheduled_datetime), "dd/MM/yy")}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />{ride.pickup_address}
                  </p>
                  {ride.dropoff_address && (
                    <p className="text-xs flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="w-3 h-3 text-red-500 shrink-0" />{ride.dropoff_address}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  {ride.zone && (
                    <>
                      <Tag className="w-3 h-3 text-purple-500" />
                      <span className="text-purple-600 font-medium">{ride.zone}</span>
                      <span>·</span>
                    </>
                  )}
                  <Bell className="w-3 h-3" />
                  <span>Alerta {ride.notify_minutes_before ?? 10} min antes</span>
                  {ride.require_specific_driver && ride.preferred_driver_name && (
                    <>
                      <span>·</span>
                      <Car className="w-3 h-3 text-blue-500" />
                      <span className="text-blue-600 font-medium">{ride.preferred_driver_name}</span>
                    </>
                  )}
                  {ride.fare && <><span>·</span><span className="font-bold text-green-600">${ride.fare}</span></>}
                </div>

                <div className="flex gap-2">
                  {["pendiente", "notificado"].includes(ride.status) && (
                    <>
                      <Button size="sm" className="flex-1 gap-1 h-8 rounded-lg"
                        onClick={() => dispatchMutation.mutate(ride)}
                        disabled={dispatchMutation.isPending}>
                        <Zap className="w-3 h-3" /> Despachar Ahora
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-3 rounded-lg"
                        onClick={() => { setEditing(ride); setShowForm(true); }}>
                        Editar
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-3 rounded-lg border-red-200 text-red-500 hover:bg-red-50"
                        onClick={() => cancelMutation.mutate(ride.id)}>
                        <XCircle className="w-3 h-3" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Past */}
      {past.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Historial reciente</h2>
          {past.map(ride => (
            <Card key={ride.id} className="opacity-70">
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{ride.client_name}</p>
                  <p className="text-xs text-muted-foreground">{ride.pickup_address}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{format(new Date(ride.scheduled_datetime), "dd/MM HH:mm")}</p>
                  <Badge className={STATUS_COLORS[ride.status] + " border-0 text-xs"}>{ride.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Agenda" : "Nueva Agenda"}</DialogTitle>
          </DialogHeader>
          <ScheduledForm
            ride={editing}
            drivers={drivers}
            onSave={(form) => saveMutation.mutate(form)}
            onClose={() => { setShowForm(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}