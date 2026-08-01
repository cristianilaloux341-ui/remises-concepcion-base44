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
import { Plus, Clock, Car, MapPin, Bell, CheckCircle2, XCircle, Zap, Tag, RefreshCw, Calculator } from "lucide-react";
import AddressAutocomplete from "@/components/orders/AddressAutocomplete";

const ZONES = ["1-Puerto", "2-Plaza", "3-Columna", "4-Base", "5-Cementerio", "6-Díaz Vélez", "7-Don Bosco", "8-Monumento"];
import { useLocation, useNavigate } from "react-router-dom";
import { format, formatDistanceToNow, isPast, differenceInMinutes, addDays, addWeeks, addMonths } from "date-fns";
import { es } from "date-fns/locale";
import { autoDispatch, assignDriverToOrder, detectZoneFromAddress } from "@/lib/dispatchLogic";
import PullToRefresh from "@/components/ui/pull-to-refresh";
import { useTarifaConfig, calcularDistanciaRuta, calcularImporte } from "@/hooks/useTarifaConfig";

const STATUS_COLORS = {
  pendiente: "bg-amber-100 text-amber-700",
  notificado: "bg-blue-100 text-blue-700",
  despachado: "bg-purple-100 text-purple-700",
  completado: "bg-green-100 text-green-700",
  cancelado: "bg-red-100 text-red-700",
};

function ScheduledForm({ ride, drivers, onSave, onClose }) {
  const formatForInput = (isoString) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const [form, setForm] = useState(() => {
    if (ride) {
      return { ...ride, scheduled_datetime: formatForInput(ride.scheduled_datetime) };
    }
    return {
      client_name: "", client_phone: "", pickup_address: "", dropoff_address: "",
      zone: "",
      scheduled_datetime: "", notify_minutes_before: 10,
      require_specific_driver: false, preferred_driver_id: "", preferred_driver_name: "",
      fare: "", notes: ""
    };
  });
  
  // Estado para la recurrencia
  const [recurrence, setRecurrence] = useState({
    type: "none",
    endDate: format(addMonths(new Date(), 1), "yyyy-MM-dd"),
    days: [] // para "custom"
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

  const geocodeAddress = async (address) => {
    try {
      const sessionToken = sessionStorage.getItem('local_operator_token');
      const res = await base44.functions.invoke("geocodeRoute", { action: "autocomplete", input: address, sessionToken });
      const predictions = res.data?.predictions;
      if (!predictions || predictions.length === 0) return null;
      const details = await base44.functions.invoke("geocodeRoute", {
        action: "placedetails",
        place_id: predictions[0].place_id,
        description: predictions[0].description,
        sessionToken
      });
      if (details.data?.lat && details.data?.lng) return { lat: details.data.lat, lng: details.data.lng };
    } catch (_) {}
    return null;
  };

  // Filtrar clientes cuando cambia el nombre o teléfono
  useEffect(() => {
    const nameQ = form.client_name.toLowerCase().trim();
    const phoneQ = form.client_phone.toLowerCase().trim();
    
    if (!nameQ && !phoneQ) {
      setFilteredClients([]);
      setShowClientSuggestions(false);
      return;
    }

    const filtered = clients.filter(c => {
      const matchName = nameQ ? c.name?.toLowerCase().includes(nameQ) : false;
      const matchPhone = phoneQ ? c.phone?.toLowerCase().includes(phoneQ) : false;
      return matchName || matchPhone;
    }).slice(0, 6);
    
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

  const calcularTarifaManualmente = async () => {
    if (!form.pickup_address || !form.dropoff_address) {
      alert("Se requiere una dirección de origen y una de destino para calcular la tarifa automáticamente.");
      return;
    }
    setCalculandoTarifa(true);
    try {
      const origenCoords = await geocodeAddress(form.pickup_address);
      const destinoCoords = await geocodeAddress(form.dropoff_address);
      const distMetros = await calcularDistanciaRuta(form.pickup_address, form.dropoff_address, origenCoords, destinoCoords);
      if (distMetros) {
        const fare = calcularImporte(distMetros, tariffConfig);
        setForm(f => ({ ...f, fare }));
      } else {
        alert("No se pudo calcular la ruta. Ingrese la tarifa manualmente.");
      }
    } catch (e) {
      console.error(e);
    }
    setCalculandoTarifa(false);
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
      if (form.pickup_address && form.dropoff_address && tariffConfig && !form.fare) {
        setCalculandoTarifa(true);
        try {
          const origenCoords = await geocodeAddress(form.pickup_address);
          const destinoCoords = await geocodeAddress(form.dropoff_address);
          const distMetros = await calcularDistanciaRuta(form.pickup_address, form.dropoff_address, origenCoords, destinoCoords);
          if (distMetros) {
            const fare = calcularImporte(distMetros, tariffConfig);
            setForm(f => ({ ...f, fare }));
          }
        } catch (_) {}
        setCalculandoTarifa(false);
      }
    }, 1000);

    return () => clearTimeout(debounceTimer.current);
  }, [form.pickup_address, form.dropoff_address, tariffConfig]);

  return (
    <div className="space-y-4 pb-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 relative">
          <Label>Cliente</Label>
          <Input className="bg-white text-black font-bold" value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} />
          {showClientSuggestions && filteredClients.length > 0 && (
            <div className="absolute top-[100%] left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 mt-1">
              {filteredClients.map(client => (
                <button
                  key={client.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 border-b last:border-b-0 transition-colors"
                  onClick={() => handleSelectClient(client)}
                >
                  <div className="font-bold text-black">{client.name}</div>
                  <div className="text-xs text-gray-700">{client.phone || "Sin teléfono"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label>Teléfono</Label>
          <Input className="bg-white text-black font-bold" value={form.client_phone} onChange={e => setForm({ ...form, client_phone: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Dirección de recogida</Label>
        <AddressAutocomplete
          value={form.pickup_address}
          onChange={v => setForm({ ...form, pickup_address: v })}
          placeholder="Calle y altura..."
          className="bg-white text-black font-bold"
          autoFocus
        />
      </div>
      <div className="space-y-1">
        <Label>Destino (requerido para tarifa autom.)</Label>
        <AddressAutocomplete
          value={form.dropoff_address}
          onChange={v => setForm({ ...form, dropoff_address: v })}
          placeholder="Destino..."
          className="bg-white text-black font-bold"
        />
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Zona</Label>
        <Select value={form.zone || ""} onValueChange={v => setForm({ ...form, zone: v })}>
          <SelectTrigger className="bg-white text-black font-bold"><SelectValue placeholder="Seleccionar zona..." /></SelectTrigger>
          <SelectContent>
            {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Fecha y hora del primer viaje</Label>
          <Input className="bg-white text-black font-bold" type="datetime-local" value={form.scheduled_datetime}
            onChange={e => setForm({ ...form, scheduled_datetime: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Alertar X min antes</Label>
          <Input className="bg-white text-black font-bold" type="number" min={1} value={form.notify_minutes_before}
            onChange={e => setForm({ ...form, notify_minutes_before: Number(e.target.value) })} />
        </div>
      </div>

      {/* Recurrencia Automática (solo al crear nuevo, no al editar) */}
      {!ride && (
        <div className="space-y-3 p-3 bg-slate-100 border border-slate-300 rounded-lg">
          <Label className="flex items-center gap-1.5 font-bold text-slate-800 text-sm">
            <RefreshCw className="w-4 h-4 text-blue-600" /> Repetir Viaje (Automático)
          </Label>
          <Select value={recurrence.type} onValueChange={v => setRecurrence({ ...recurrence, type: v })}>
            <SelectTrigger className="bg-white text-black font-bold border-slate-400">
              <SelectValue placeholder="Sin repetición" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Una sola vez</SelectItem>
              <SelectItem value="daily">Todos los días (Lunes a Domingo)</SelectItem>
              <SelectItem value="weekdays">Días hábiles (Lunes a Viernes)</SelectItem>
              <SelectItem value="custom">Días específicos de la semana...</SelectItem>
              <SelectItem value="weekly">Semanalmente (mismo día)</SelectItem>
              <SelectItem value="monthly">Mensualmente (mismo día)</SelectItem>
            </SelectContent>
          </Select>

          {recurrence.type === "custom" && (
            <div className="flex gap-1.5 justify-between mt-2">
              {[{l:'D', v:0}, {l:'L', v:1}, {l:'M', v:2}, {l:'X', v:3}, {l:'J', v:4}, {l:'V', v:5}, {l:'S', v:6}].map(d => {
                const isSelected = recurrence.days.includes(d.v);
                return (
                  <Button
                    key={d.v}
                    type="button"
                    variant={isSelected ? "default" : "outline"}
                    className={`w-10 h-10 p-0 rounded-full font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-white text-black border-slate-300'}`}
                    onClick={() => {
                      setRecurrence({
                        ...recurrence,
                        days: isSelected ? recurrence.days.filter(x => x !== d.v) : [...recurrence.days, d.v]
                      });
                    }}
                  >
                    {d.l}
                  </Button>
                );
              })}
            </div>
          )}

          {recurrence.type !== "none" && (
            <div className="space-y-1 pt-2">
              <Label className="font-bold text-slate-700">Repetir hasta la fecha:</Label>
              <Input type="date" className="bg-white text-black font-bold border-slate-400" value={recurrence.endDate} onChange={e => setRecurrence({...recurrence, endDate: e.target.value})} />
              <p className="text-[10px] text-slate-500">Se generarán los viajes automáticamente hasta esta fecha.</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5 font-bold">
            Tarifa del Viaje
            {calculandoTarifa && <span className="text-xs text-blue-500 animate-pulse">calculando automática...</span>}
          </Label>
          <button type="button" onClick={calcularTarifaManualmente} className="text-xs font-bold text-blue-600 underline flex items-center gap-1">
            <Calculator className="w-3 h-3"/> Forzar Cálculo
          </button>
        </div>
        <Input className="bg-white text-black font-bold text-lg" type="number" value={form.fare} onChange={e => setForm({ ...form, fare: e.target.value })} placeholder={calculandoTarifa ? "Calculando..." : "0"} />
      </div>

      <div className="flex items-center gap-3 bg-white p-3 rounded-md border">
        <Switch checked={form.require_specific_driver}
          onCheckedChange={v => setForm({ ...form, require_specific_driver: v })} />
        <Label className="font-bold text-black">Asignar a un móvil en específico</Label>
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
            <SelectTrigger className="bg-white text-black font-bold"><SelectValue placeholder="Seleccionar móvil..." /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno">Sin preferencia</SelectItem>
              {drivers.map(d => (
                <SelectItem key={d.id} value={d.id} className="font-bold">{d.name} — {d.vehicle_plate}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <Label>Notas</Label>
        <Textarea className="bg-white text-black font-bold h-16" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
      </div>

      <div className="flex gap-2 pt-4">
        <Button variant="outline" className="flex-1 font-bold bg-white text-black" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1 font-bold" onClick={() => onSave({ form, recurrence })}>
          {ride ? "Actualizar Viaje" : "Guardar Agenda/s"}
        </Button>
      </div>
    </div>
  );
}

function minutesUntil(datetime) {
  return differenceInMinutes(new Date(datetime), new Date());
}

export default function Agenda() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "true" || location.state?.openNew) {
      setEditing(null);
      setShowForm(true);
      
      // Limpiamos la URL y el state para no reabrir por accidente al refrescar
      if (params.get("new") === "true") {
        navigate("/agenda", { replace: true, state: {} });
      } else if (location.state?.openNew) {
        navigate("/agenda", { replace: true, state: {} });
      }
    }
  }, [location.search, location.state, navigate]);

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
    mutationFn: async ({ form, recurrence }) => {
      const dataToSave = { ...form };
      
      // Aseguramos que la fecha se guarde SIEMPRE en formato ISO 8601 (UTC) absoluto
      if (dataToSave.scheduled_datetime && !dataToSave.scheduled_datetime.endsWith('Z')) {
        const d = new Date(dataToSave.scheduled_datetime);
        if (!isNaN(d.getTime())) {
          dataToSave.scheduled_datetime = d.toISOString();
        }
      }

      if (dataToSave.fare && String(dataToSave.fare).trim() !== "") {
        dataToSave.fare = Number(dataToSave.fare);
      } else {
        delete dataToSave.fare;
      }
      
      if (editing?.id) {
        return await base44.entities.ScheduledRide.update(editing.id, dataToSave);
      } else {
        const records = [dataToSave];
        
        // Lógica de recurrencia
        if (recurrence && recurrence.type !== "none" && recurrence.endDate) {
           let current = new Date(form.scheduled_datetime);
           const end = new Date(recurrence.endDate);
           end.setHours(23, 59, 59, 999);
           let count = 0;

           while (count < 90) { // Safety cap
               if (recurrence.type === "daily") {
                   current = addDays(current, 1);
               } else if (recurrence.type === "weekdays") {
                   current = addDays(current, 1);
                   if (current.getDay() === 0 || current.getDay() === 6) continue;
               } else if (recurrence.type === "weekly") {
                   current = addWeeks(current, 1);
               } else if (recurrence.type === "monthly") {
                   current = addMonths(current, 1);
               } else if (recurrence.type === "custom") {
                   current = addDays(current, 1);
                   if (!recurrence.days.includes(current.getDay())) continue;
               }

               if (current > end) break;

               records.push({
                   ...dataToSave,
                   scheduled_datetime: current.toISOString(),
                   status: "pendiente"
               });
               count++;
           }
        }
        
        if (records.length > 1) {
            return await base44.entities.ScheduledRide.bulkCreate(records);
        } else {
            return await base44.entities.ScheduledRide.create(records[0]);
        }
      }
    },
    onMutate: async ({ form }) => {
      await queryClient.cancelQueries({ queryKey: ["scheduled"] });
      const previous = queryClient.getQueryData(["scheduled"]);
      
      queryClient.setQueryData(["scheduled"], (old) => {
        if (!old) return [];
        const dataToSave = { ...form, status: form.status || "pendiente" };
        if (editing?.id) {
          return old.map(r => r.id === editing.id ? { ...r, ...dataToSave } : r);
        } else {
          return [{ id: 'temp-' + Date.now(), ...dataToSave, scheduled_datetime: form.scheduled_datetime || new Date().toISOString() }, ...old];
        }
      });
      
      setShowForm(false);
      setEditing(null);
      
      return { previous };
    },
    onError: (err, variables, context) => {
      if (context?.previous) queryClient.setQueryData(["scheduled"], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled"] });
    }
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.ScheduledRide.update(id, { status: "cancelado" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled"] }),
  });

  const handleDispatch = (ride) => {
    navigate("/orders/new", {
      state: {
        scheduled_ride_id: ride.id,
        initialData: {
          client_id: ride.client_id || "",
          client_name: ride.client_name || "",
          client_phone: ride.client_phone || "",
          pickup_address: ride.pickup_address || "",
          dropoff_address: ride.dropoff_address || "",
          zone: ride.zone || "",
          fare: ride.fare || "",
          notes: ride.notes || "",
          driver_id: ride.preferred_driver_id || "",
          driver_name: ride.preferred_driver_name || ""
        }
      }
    });
  };

  const upcoming = rides.filter(r => !["cancelado", "completado"].includes(r.status))
    .sort((a, b) => new Date(a.scheduled_datetime) - new Date(b.scheduled_datetime));
  const past = rides.filter(r => ["cancelado", "completado", "despachado"].includes(r.status))
    .sort((a, b) => new Date(b.scheduled_datetime) - new Date(a.scheduled_datetime))
    .slice(0, 20);

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["scheduled"] });
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-black">Agenda</h1>
          <p className="text-muted-foreground mt-1 font-bold">Viajes programados</p>
        </div>
        <Button className="rounded-xl gap-2 font-bold" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Nueva Agenda
        </Button>
      </div>

      {/* Upcoming */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-black uppercase tracking-wide">Próximos</h2>
        {upcoming.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-muted-foreground font-bold">Sin viajes programados</CardContent></Card>
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
                      <p className="font-bold text-black text-lg">{ride.client_name}</p>
                      <Badge className={STATUS_COLORS[ride.status] + " border-0 text-xs font-bold"}>{ride.status}</Badge>
                      {isUrgent && <Badge className="bg-amber-500 text-white border-0 text-xs animate-pulse">¡{Math.max(0, mins)} min!</Badge>}
                    </div>
                    <p className="text-sm text-black font-bold">{ride.client_phone}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-lg text-black">{format(new Date(ride.scheduled_datetime), "HH:mm", { locale: es })}</p>
                    <p className="text-sm text-black font-bold">{format(new Date(ride.scheduled_datetime), "dd/MM/yy")}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-sm flex items-center gap-1.5 font-bold text-black">
                    <div className="w-3 h-3 rounded-full bg-green-500 shrink-0" />{ride.pickup_address}
                  </p>
                  {ride.dropoff_address && (
                    <p className="text-sm flex items-center gap-1.5 font-bold text-black">
                      <MapPin className="w-4 h-4 text-red-500 shrink-0" />{ride.dropoff_address}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm text-black font-bold flex-wrap">
                  {ride.zone && (
                    <>
                      <Tag className="w-4 h-4 text-purple-600" />
                      <span className="text-purple-700 font-bold">{ride.zone}</span>
                      <span>·</span>
                    </>
                  )}
                  <Bell className="w-4 h-4" />
                  <span>Alerta {ride.notify_minutes_before ?? 10} min</span>
                  {ride.require_specific_driver && ride.preferred_driver_name && (
                    <>
                      <span>·</span>
                      <Car className="w-4 h-4 text-blue-600" />
                      <span className="text-blue-700 font-bold">{ride.preferred_driver_name}</span>
                    </>
                  )}
                  {ride.fare && <><span>·</span><span className="font-bold text-green-700 text-base">${ride.fare}</span></>}
                </div>

                <div className="flex gap-2">
                  {["pendiente", "notificado"].includes(ride.status) && (
                    <>
                      <Button size="sm" className="flex-1 gap-1 h-10 rounded-lg font-bold"
                        onClick={() => handleDispatch(ride)}>
                        <Zap className="w-4 h-4" /> Abrir Pasaje
                      </Button>
                      <Button size="sm" variant="outline" className="h-10 px-4 rounded-lg font-bold text-black bg-white"
                        onClick={() => { setEditing(ride); setShowForm(true); }}>
                        Editar
                      </Button>
                      <Button size="sm" variant="outline" className="h-10 px-3 rounded-lg border-red-300 text-red-600 hover:bg-red-50 bg-white"
                        onClick={() => cancelMutation.mutate(ride.id)}>
                        <XCircle className="w-5 h-5" />
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
          <h2 className="text-sm font-bold text-black uppercase tracking-wide mt-6">Historial reciente</h2>
          {past.map(ride => (
            <Card key={ride.id} className="opacity-80">
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-black">{ride.client_name}</p>
                  <p className="text-xs text-black font-medium">{ride.pickup_address}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-black font-bold">{format(new Date(ride.scheduled_datetime), "dd/MM HH:mm")}</p>
                  <Badge className={STATUS_COLORS[ride.status] + " border-0 text-xs font-bold"}>{ride.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditing(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-bold text-black text-xl">{editing ? "Editar Agenda" : "Nueva Agenda"}</DialogTitle>
          </DialogHeader>
          <ScheduledForm
            ride={editing}
            drivers={drivers}
            onSave={(payload) => saveMutation.mutate(payload)}
            onClose={() => { setShowForm(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>
      </div>
    </PullToRefresh>
  );
}