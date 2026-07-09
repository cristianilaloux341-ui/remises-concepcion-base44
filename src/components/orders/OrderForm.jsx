import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, User, Phone, DollarSign, Loader2, Plus, X, Zap, Car, UserPlus, Wand2, Calculator } from "lucide-react";
import { findBestDriver, detectZoneFromAddress, detectZoneFromCoords, learnZoneMapping, parseAddress, getBaseQueue } from "@/lib/dispatchLogic";
import PickupAutocomplete from "@/components/orders/PickupAutocomplete";
import AddressAutocomplete from "@/components/orders/AddressAutocomplete";
import { recordAddressUsage } from "@/hooks/useAddressSuggestions";
import { useTarifaConfig, calcularDistanciaRuta, calcularImporte } from "@/hooks/useTarifaConfig";

const ZONES = ["1-Puerto", "2-Plaza", "3-Columna", "4-Base", "5-Cementerio", "6-Díaz Vélez", "7-Don Bosco", "8-Monumento"];

export default function OrderForm({ order, onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    client_name: "",
    client_phone: "",
    client_id: "",
    pickup_address: "",
    dropoff_address: "",
    dropoff_addresses: [],
    zone: "",
    driver_id: "",
    driver_name: "",
    fare: "",
    notes: "",
    status: "pendiente",
    ...order,
  });

  const [autoAssigning, setAutoAssigning] = useState(false);
  const queryClient = useQueryClient();
  const [suggestedDriver, setSuggestedDriver] = useState(null);
  const [detectedZone, setDetectedZone] = useState(null);
  const [detectingZone, setDetectingZone] = useState(false);
  const [calculandoTarifa, setCalculandoTarifa] = useState(false);
  const [distanciaCalculada, setDistanciaCalculada] = useState(null);
  const tarifa = useTarifaConfig();

  // Geocodifica una dirección de texto si no tiene coords, usando Google Places
  const geocodeAddress = async (address) => {
    try {
      const res = await base44.functions.invoke("geocodeRoute", { action: "autocomplete", input: address });
      const predictions = res.data?.predictions;
      if (!predictions || predictions.length === 0) return null;
      const details = await base44.functions.invoke("geocodeRoute", {
        action: "placedetails",
        place_id: predictions[0].place_id,
        description: predictions[0].description,
      });
      if (details.data?.lat && details.data?.lng) return { lat: details.data.lat, lng: details.data.lng };
    } catch (_) {}
    return null;
  };

  // Auto-calcular tarifa cuando ambas direcciones estén completas
  useEffect(() => {
    const pickup = form.pickup_address?.trim();
    const dropoff = form.dropoff_address?.trim();
    if (!pickup || pickup.length < 4 || !dropoff || dropoff.length < 4) return;

    const timeout = setTimeout(async () => {
      setCalculandoTarifa(true);

      // Usar coords del form si están disponibles, si no geocodificar
      let origenCoords = (form.pickup_lat && form.pickup_lng) ? { lat: form.pickup_lat, lng: form.pickup_lng } : await geocodeAddress(pickup);
      let destinoCoords = (form.dropoff_lat && form.dropoff_lng) ? { lat: form.dropoff_lat, lng: form.dropoff_lng } : await geocodeAddress(dropoff);

      // Guardar coords en el form si las obtuvimos por geocodificación
      if (origenCoords || destinoCoords) {
        setForm(prev => ({
          ...prev,
          pickup_lat: origenCoords?.lat ?? prev.pickup_lat,
          pickup_lng: origenCoords?.lng ?? prev.pickup_lng,
          dropoff_lat: destinoCoords?.lat ?? prev.dropoff_lat,
          dropoff_lng: destinoCoords?.lng ?? prev.dropoff_lng,
        }));
      }

      const metros = await calcularDistanciaRuta(pickup, dropoff, origenCoords, destinoCoords);
      setCalculandoTarifa(false);
      if (metros) {
        setDistanciaCalculada(metros);
        const importe = calcularImporte(metros, tarifa);
        setForm(prev => ({
          ...prev,
          fare: importe,
          distancia_teorica_metros: metros,
          importe_estimado: importe,
          importe_real_actual: importe,
        }));
      } else {
        setDistanciaCalculada(-1);
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [form.pickup_address, form.dropoff_address]);

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => base44.entities.Client.list(),
  });

  const { data: bases = [] } = useQuery({
    queryKey: ["bases"],
    queryFn: () => base44.entities.Base.list(),
  });

  const { data: clientAddresses = [] } = useQuery({
    queryKey: ["client_addresses"],
    queryFn: () => base44.entities.ClientAddress.list("-usage_count", 500),
    staleTime: 30_000,
  });

  const availableDrivers = drivers.filter(d => d.status === "disponible" && d.current_base);

  // Auto-detect zone when pickup address changes
  useEffect(() => {
    if (!form.pickup_address || form.pickup_address.length < 3) { setDetectedZone(null); return; }
    const timeout = setTimeout(async () => {
      setDetectingZone(true);
      let zone = null;
      
      // 1. Intentar SIEMPRE por coordenadas primero (Geofencing con los polígonos del mapa)
      let coords = (form.pickup_lat && form.pickup_lng) 
        ? { lat: form.pickup_lat, lng: form.pickup_lng } 
        : await geocodeAddress(form.pickup_address);
        
      if (coords) {
        zone = await detectZoneFromCoords(coords.lat, coords.lng);
        // Guardar las coordenadas geocodificadas si no las teníamos
        if (!form.pickup_lat || !form.pickup_lng) {
          setForm(prev => ({ ...prev, pickup_lat: coords.lat, pickup_lng: coords.lng }));
        }
      }

      // 2. Fallback al diccionario de texto (nombres de calles) si no cayó en ningún polígono del mapa
      if (!zone) {
        zone = await detectZoneFromAddress(form.pickup_address);
      }

      setDetectingZone(false);
      if (zone) {
        setDetectedZone(zone);
        // Auto-fill zone always, overriding any previous value
        setForm(prev => ({ ...prev, zone }));
      } else {
        setDetectedZone(null);
      }
    }, 600);
    return () => clearTimeout(timeout);
  }, [form.pickup_address, form.pickup_lat, form.pickup_lng]);

  // Auto-suggest best driver when zone or pickup changes
  useEffect(() => {
    if (!form.pickup_address || availableDrivers.length === 0) { setSuggestedDriver(null); return; }
    findBestDriver({ zone: form.zone, pickup_address: form.pickup_address, pickup_lat: form.pickup_lat, pickup_lng: form.pickup_lng }, drivers, bases)
      .then(d => setSuggestedDriver(d));
  }, [form.zone, form.pickup_address, drivers.length]);

  const handleAddressClientSelect = (clientData) => {
    // Force unconditional update — use the exact row's data (identified by addressId)
    setForm(prev => ({
      ...prev,
      client_id: clientData.client_id,
      client_name: clientData.client_name,
      client_phone: clientData.client_phone,
    }));
  };

  const [manualDriverInput, setManualDriverInput] = useState("");

  useEffect(() => {
    if (order?.driver_id && order?.driver_name && !manualDriverInput) {
      setManualDriverInput(order.driver_name);
    }
  }, [order]);

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleDriverChange = (driverId) => {
    if (driverId === "none" || !driverId) {
      setForm(prev => ({ ...prev, driver_id: "", driver_name: "", status: "pendiente" }));
      setManualDriverInput("");
      return;
    }
    const driver = drivers.find(d => d.id === driverId);
    if (driver) {
      setForm(prev => ({ ...prev, driver_id: driverId, driver_name: driver.name, status: "aceptado" }));
      setManualDriverInput(driver.name);
    }
  };

  const handleAutoAssign = async () => {
    setAutoAssigning(true);
    const driver = await findBestDriver({ zone: form.zone, pickup_address: form.pickup_address }, drivers, bases);
    if (driver) {
      setForm(prev => ({ ...prev, driver_id: driver.id, driver_name: driver.name, status: "aceptado" }));
      setSuggestedDriver(driver);
    }
    setAutoAssigning(false);
  };

  const addDestination = () => {
    setForm(prev => ({ ...prev, dropoff_addresses: [...(prev.dropoff_addresses || []), ""] }));
  };

  const updateDestination = (idx, value) => {
    setForm(prev => {
      const arr = [...(prev.dropoff_addresses || [])];
      arr[idx] = value;
      return { ...prev, dropoff_addresses: arr };
    });
  };

  const removeDestination = (idx) => {
    setForm(prev => ({
      ...prev,
      dropoff_addresses: (prev.dropoff_addresses || []).filter((_, i) => i !== idx),
    }));
  };

  const handleCalcularTarifa = async () => {
    if (!form.pickup_address || !form.dropoff_address) return;
    setCalculandoTarifa(true);
    setDistanciaCalculada(null);
    let origenCoords = (form.pickup_lat && form.pickup_lng) ? { lat: form.pickup_lat, lng: form.pickup_lng } : await geocodeAddress(form.pickup_address.trim());
    let destinoCoords = (form.dropoff_lat && form.dropoff_lng) ? { lat: form.dropoff_lat, lng: form.dropoff_lng } : await geocodeAddress(form.dropoff_address.trim());
    const metros = await calcularDistanciaRuta(form.pickup_address, form.dropoff_address, origenCoords, destinoCoords);
    setCalculandoTarifa(false);
    if (metros) {
      setDistanciaCalculada(metros);
      const importe = calcularImporte(metros, tarifa);
      setForm(prev => ({
        ...prev,
        fare: importe,
        distancia_teorica_metros: metros,
        importe_estimado: importe,
        importe_real_actual: importe,
      }));
    } else {
      setDistanciaCalculada(-1);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = { ...form };
    if (distanciaCalculada) {
      data.distancia_teorica_metros = distanciaCalculada;
      data.importe_estimado = data.fare ? Number(data.fare) : undefined;
      data.importe_real_actual = data.importe_estimado;
      data.segundos_espera_acumulados = 0;
    }
    if (data.fare && String(data.fare).trim() !== "") data.fare = Number(data.fare);
    else delete data.fare;
    if (!data.driver_id && manualDriverInput) {
      // Auto-create/force assign just like DispatchPanel
      const inputTrimmed = manualDriverInput.trim();
      let movilNum = parseInt(inputTrimmed);
      let driver = drivers.find(d => 
        d.id === inputTrimmed || 
        d.vehicle_model === inputTrimmed || 
        d.name.toLowerCase() === inputTrimmed.toLowerCase()
      );

      if (!driver && !isNaN(movilNum)) {
        try {
          const m = await base44.entities.Movil.filter({ numero_movil: movilNum });
          let movil = m[0];
          if (!movil) {
            movil = await base44.entities.Movil.create({ numero_movil: movilNum, activo: true });
          }
          const fakePlate = `TEST${movilNum}`;
          driver = await base44.entities.Driver.create({
            name: `Móvil ${movilNum}`,
            phone: `000000000${movilNum}`,
            vehicle_plate: fakePlate,
            vehicle_model: String(movilNum),
            status: "disponible"
          });
          if (!movil.dominio) {
            await base44.entities.Movil.update(movil.id, { dominio: fakePlate });
          }
        } catch(err) {
          console.error("Auto-create failed", err);
        }
      }

      if (driver) {
        data.driver_id = driver.id;
        data.driver_name = driver.name;
        data.status = "aceptado";
      } else {
        // Fuerza sin entidad para pruebas
        data.driver_id = `manual-${inputTrimmed}`;
        data.driver_name = isNaN(movilNum) ? inputTrimmed : `Móvil ${movilNum}`;
        data.status = "aceptado";
      }
    } else if (!data.driver_id) {
      delete data.driver_id; 
      delete data.driver_name;
    }

    // Auto-save/update client in database
    if (data.client_name?.trim()) {
      const existing = clients.find(c =>
        (data.client_id && c.id === data.client_id) ||
        (data.client_phone && c.phone === data.client_phone?.trim()) ||
        c.name?.toLowerCase() === data.client_name.trim().toLowerCase()
      );

      if (existing) {
        // Update phone or pickup address if changed
        const updates = {};
        if (data.client_phone && !existing.phone) updates.phone = data.client_phone.trim();
        if (data.pickup_address && !existing.pickup_address) updates.pickup_address = data.pickup_address;
        if (Object.keys(updates).length > 0) {
          await base44.entities.Client.update(existing.id, updates);
        }
        data.client_id = existing.id;
      } else if (!data.client_id) {
        // New client — create automatically
        const newClient = await base44.entities.Client.create({
          name: data.client_name.trim(),
          phone: data.client_phone?.trim() || undefined,
          pickup_address: data.pickup_address || undefined,
        });
        data.client_id = newClient.id;
      }
      queryClient.invalidateQueries(["clients"]);
    }

    if (!data.client_id) delete data.client_id;

    // Record address usage for autocomplete learning
    if (data.pickup_address) recordAddressUsage(data.pickup_address, queryClient);
    if (data.dropoff_address) recordAddressUsage(data.dropoff_address, queryClient);
    (data.dropoff_addresses || []).forEach(a => a && recordAddressUsage(a, queryClient));

    // Learn zone mapping from address+zone for future auto-detection
    if (data.zone && data.pickup_address) {
      learnZoneMapping(data.pickup_address, data.zone).catch(() => {});
    }

    // Save/update ClientAddress for all addresses linked to this client
    if (data.client_id) {
      const allAddresses = [
        data.pickup_address,
        data.dropoff_address,
        ...(data.dropoff_addresses || []),
      ].filter(a => a && a.trim().length >= 3);

      for (const addr of allAddresses) {
        const addrNorm = addr.trim().toLowerCase();
        const existingCA = clientAddresses.find(ca =>
          ca.client_id === data.client_id &&
          (ca.full_address || "").trim().toLowerCase() === addrNorm
        );
        if (existingCA) {
          base44.entities.ClientAddress.update(existingCA.id, {
            usage_count: (existingCA.usage_count || 0) + 1,
            last_used: new Date().toISOString(),
            client_name: data.client_name,
            client_phone: data.client_phone || "",
          }).catch(() => {});
        } else {
          const parsed = parseAddress(addr);
          base44.entities.ClientAddress.create({
            client_id: data.client_id,
            client_name: data.client_name,
            client_phone: data.client_phone || "",
            street: parsed.street || addr,
            height: parsed.number ? String(parsed.number) : "",
            full_address: addr,
            usage_count: 1,
            last_used: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      queryClient.invalidateQueries({ queryKey: ["client_addresses"] });
    }

    onSubmit(data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-primary" />
          </div>
          {order ? "Editar Viaje" : "Nuevo Viaje"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── DIRECCIÓN DE ORIGEN ── */}
          <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Dirección de Origen
            </p>
            <div className="space-y-1.5">
              <Label>Recogida</Label>
              <PickupAutocomplete
                value={form.pickup_address}
                onChange={(v, coords) => setForm(prev => ({ 
                  ...prev, 
                  pickup_address: v, 
                  pickup_lat: coords !== undefined ? (coords?.lat || null) : null, 
                  pickup_lng: coords !== undefined ? (coords?.lng || null) : null 
                }))}
                onClientSelect={handleAddressClientSelect}
                required
              />
            </div>
            {/* Zona */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                Zona
                {detectingZone && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                {detectedZone && detectedZone === form.zone && (
                  <span className="text-xs text-green-600 flex items-center gap-1 font-normal">
                    <Wand2 className="w-3 h-3" /> Detectada automáticamente
                  </span>
                )}
                {detectedZone && detectedZone !== form.zone && form.zone && (
                  <button type="button" className="text-xs text-amber-600 underline font-normal flex items-center gap-1"
                    onClick={() => handleChange("zone", detectedZone)}>
                    <Wand2 className="w-3 h-3" /> Sugerida: {detectedZone}
                  </button>
                )}
                {!form.zone && !detectedZone && !detectingZone && form.pickup_address?.length > 2 && (
                  <span className="text-xs text-amber-600 font-normal">Selección manual requerida</span>
                )}
              </Label>
              <Select value={form.zone || ""} onValueChange={(v) => handleChange("zone", v)}>
                <SelectTrigger className={!form.zone ? "border-amber-300" : ""}>
                  <SelectValue placeholder="Seleccionar zona..." />
                </SelectTrigger>
                <SelectContent>
                  {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── CLIENTE ── */}
          <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Cliente
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="client_name">Nombre</Label>
                <div className="relative">
                  <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="client_name"
                    className="pl-9"
                    placeholder="Nombre del cliente"
                    value={form.client_name}
                    onChange={(e) => handleChange("client_name", e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client_phone">Teléfono</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="client_phone"
                    className="pl-9"
                    placeholder="3462-123456"
                    value={form.client_phone}
                    onChange={(e) => handleChange("client_phone", e.target.value)}
                  />
                </div>
              </div>
            </div>
            {form.client_id ? (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <User className="w-3 h-3" /> Cliente vinculado de la base de datos
              </p>
            ) : form.client_name?.trim() ? (
              <p className="text-xs text-blue-600 flex items-center gap-1">
                <UserPlus className="w-3 h-3" /> Se guardará como nuevo cliente al confirmar
              </p>
            ) : null}
          </div>

          {/* ── DESTINOS ── */}
          <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Destinos
            </p>
            <div className="space-y-1.5">
              <Label>Destino Principal</Label>
              <AddressAutocomplete
                value={form.dropoff_address}
                onChange={(v, coords) => setForm(prev => ({ 
                  ...prev, 
                  dropoff_address: v, 
                  dropoff_lat: coords !== undefined ? (coords?.lat || null) : null, 
                  dropoff_lng: coords !== undefined ? (coords?.lng || null) : null 
                }))}
                placeholder="Calle y número de destino"
                icon={<MapPin className="w-4 h-4 text-red-500" />}
              />
            </div>
            {(form.dropoff_addresses || []).map((addr, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <div className="flex-1">
                  <AddressAutocomplete
                    value={addr}
                    onChange={(v) => updateDestination(idx, v)}
                    placeholder={`Parada ${idx + 2}`}
                    icon={<MapPin className="w-4 h-4 text-orange-400" />}
                  />
                </div>
                <Button type="button" size="icon" variant="ghost" className="text-red-400 hover:text-red-600 shrink-0"
                  onClick={() => removeDestination(idx)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={addDestination}>
              <Plus className="w-3.5 h-3.5" /> Agregar parada
            </Button>
          </div>

          {/* ── ASIGNACIÓN ── */}
          <div className="p-4 rounded-xl bg-muted/40 border space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5" /> Asignación de Móvil
            </p>

            {/* Cola de móviles en la zona seleccionada */}
            {form.zone && (
              <div className="bg-white rounded-xl border p-3">
                <p className="text-xs font-bold text-slate-500 mb-2">Móviles en cola para {form.zone}:</p>
                <div className="flex flex-wrap gap-2">
                  {getBaseQueue(availableDrivers, form.zone).map((d, i) => (
                    <Badge 
                      key={d.id} 
                      variant="outline"
                      className={`cursor-pointer px-2 py-1 text-xs transition-colors ${form.driver_id === d.id ? 'bg-green-500 text-white border-green-600 hover:bg-green-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'}`}
                      onClick={() => handleDriverChange(d.id)}
                    >
                      {i + 1}. {d.name.split(" ")[0]} {d.vehicle_model ? `#${d.vehicle_model}` : ''}
                    </Badge>
                  ))}
                  {getBaseQueue(availableDrivers, form.zone).length === 0 && (
                    <span className="text-xs text-amber-600">No hay móviles en esta base en este momento.</span>
                  )}
                </div>
              </div>
            )}

            {/* Sugerencia automática */}
            {suggestedDriver && !form.driver_id && (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{suggestedDriver.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{suggestedDriver.vehicle_plate} · {suggestedDriver.current_base}</p>
                </div>
                <Button type="button" size="sm" className="gap-1.5 rounded-lg shrink-0 bg-amber-500 hover:bg-amber-600"
                  onClick={handleAutoAssign} disabled={autoAssigning}>
                  {autoAssigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Asignar
                </Button>
              </div>
            )}

            {form.driver_id && (
              <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-xl">
                <Car className="w-4 h-4 text-green-600" />
                <p className="text-sm font-semibold text-green-700 flex-1">{form.driver_name}</p>
                <Badge className="bg-green-100 text-green-700 border-0 text-xs">asignado</Badge>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-400"
                  onClick={() => handleChange("driver_id", "")}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              <input 
                className="flex-1 h-9 text-base font-extrabold text-slate-900 rounded-lg border-2 border-slate-400 px-3 bg-white placeholder:text-slate-500 placeholder:font-normal"
                style={{ color: "#000000", backgroundColor: "#ffffff" }}
                placeholder="Nº de móvil para asignar..."
                value={manualDriverInput}
                onChange={(e) => {
                  setManualDriverInput(e.target.value);
                  setForm(prev => ({ ...prev, driver_id: "" })); // Clear actual ID to trigger auto-creation on submit
                }}
              />
              <Button type="button" variant="outline" className="gap-1.5 rounded-lg shrink-0"
                onClick={handleAutoAssign} disabled={autoAssigning || !form.pickup_address}>
                {autoAssigning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Auto
              </Button>
            </div>

            {availableDrivers.length === 0 && (
              <p className="text-xs text-amber-600">Sin móviles disponibles en base</p>
            )}
          </div>

          {/* ── TARIFA Y NOTAS ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fare">Tarifa ($)</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="fare"
                    className="pl-9"
                    type="number"
                    placeholder="0"
                    value={form.fare}
                    onChange={(e) => handleChange("fare", e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-1.5 shrink-0 text-xs"
                  disabled={!form.pickup_address || !form.dropoff_address || calculandoTarifa}
                  onClick={handleCalcularTarifa}
                  title="Calcula la tarifa basada en la distancia real de ruta"
                >
                  {calculandoTarifa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />}
                  Calcular
                </Button>
              </div>
              {distanciaCalculada > 0 && (
                <p className="text-xs text-green-600">
                  📍 {(distanciaCalculada / 1000).toFixed(1)} km · Bandera ${tarifa.bajada_bandera} + ${tarifa.precio_por_metro}/m {tarifa.es_nocturna ? "🌙 nocturna" : ""}
                </p>
              )}
              {distanciaCalculada === -1 && (
                <p className="text-xs text-amber-600">
                  ⚠ No se pudo calcular la distancia — ingresá el monto manualmente
                </p>
              )}
              {calculandoTarifa && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Calculando tarifa...
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas</Label>
              <Input
                id="notes"
                placeholder="Observaciones..."
                value={form.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
              />
            </div>
          </div>

          <Button type="submit" className="w-full h-11 rounded-xl" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
            ) : order ? "Actualizar Viaje" : "Crear Viaje"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}