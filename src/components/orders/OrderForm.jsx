import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, User, Phone, DollarSign, Loader2 } from "lucide-react";

export default function OrderForm({ order, onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    client_name: "",
    client_phone: "",
    pickup_address: "",
    dropoff_address: "",
    driver_id: "",
    driver_name: "",
    fare: "",
    notes: "",
    status: "pendiente",
    ...order,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const availableDrivers = drivers.filter(d => d.status === "disponible");

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleDriverChange = (driverId) => {
    const driver = drivers.find(d => d.id === driverId);
    setForm(prev => ({
      ...prev,
      driver_id: driverId,
      driver_name: driver?.name || "",
      status: driverId ? "ofrecido" : "pendiente",
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { ...form };
    if (data.fare) data.fare = Number(data.fare);
    else delete data.fare;
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="client_name">Nombre del Cliente</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="client_name"
                  className="pl-9"
                  placeholder="Juan Pérez"
                  value={form.client_name}
                  onChange={(e) => handleChange("client_name", e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client_phone">Teléfono</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                 id="client_phone"
                 className="pl-9"
                 placeholder="+54 11 1234-5678"
                 value={form.client_phone}
                 onChange={(e) => handleChange("client_phone", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pickup">Dirección de Recogida</Label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-green-500" />
              <Input
                id="pickup"
                className="pl-9"
                placeholder="Av. Corrientes 1234, CABA"
                value={form.pickup_address}
                onChange={(e) => handleChange("pickup_address", e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dropoff">Dirección de Destino</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
              <Input
                id="dropoff"
                className="pl-9"
                placeholder="Av. Santa Fe 4567, CABA"
                value={form.dropoff_address}
                onChange={(e) => handleChange("dropoff_address", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Conductor</Label>
              <Select value={form.driver_id} onValueChange={handleDriverChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar conductor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {availableDrivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} - {d.vehicle_plate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fare">Tarifa ($)</Label>
              <div className="relative">
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
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notas</Label>
            <Textarea
              id="notes"
              placeholder="Observaciones adicionales..."
              value={form.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              rows={3}
            />
          </div>

          <Button type="submit" className="w-full h-11 rounded-xl" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : order ? "Actualizar Viaje" : "Crear Viaje"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}