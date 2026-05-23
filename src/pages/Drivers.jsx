import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Phone, Car, Trash2, Loader2, User } from "lucide-react";

function DriverForm({ onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    name: "", phone: "", vehicle_model: "", vehicle_plate: "", vehicle_color: "", status: "disponible",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Nombre</Label>
          <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} required />
        </div>
        <div className="space-y-2">
          <Label>Teléfono</Label>
          <Input value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} required />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Modelo</Label>
          <Input value={form.vehicle_model} onChange={(e) => setForm(p => ({ ...p, vehicle_model: e.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Patente</Label>
          <Input value={form.vehicle_plate} onChange={(e) => setForm(p => ({ ...p, vehicle_plate: e.target.value }))} required />
        </div>
        <div className="space-y-2">
          <Label>Color</Label>
          <Input value={form.vehicle_color} onChange={(e) => setForm(p => ({ ...p, vehicle_color: e.target.value }))} />
        </div>
      </div>
      <Button type="submit" className="w-full rounded-xl" disabled={isSubmitting}>
        {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        Agregar Conductor
      </Button>
    </form>
  );
}

export default function Drivers() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Driver.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setDialogOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Driver.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Driver.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const statusColors = {
    disponible: "bg-green-100 text-green-700 border-green-200",
    en_viaje: "bg-blue-100 text-blue-700 border-blue-200",
    no_disponible: "bg-gray-100 text-gray-700 border-gray-200",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Conductores</h1>
          <p className="text-muted-foreground mt-1">{drivers.length} conductores registrados</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl gap-2">
              <Plus className="w-4 h-4" />
              Agregar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo Conductor</DialogTitle>
            </DialogHeader>
            <DriverForm onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : drivers.length === 0 ? (
        <div className="text-center py-16">
          <Car className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No hay conductores registrados</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drivers.map(driver => (
            <Card key={driver.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
                      <User className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{driver.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {driver.phone}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={statusColors[driver.status]}>
                    {driver.status?.replace("_", " ")}
                  </Badge>
                </div>

                <div className="flex items-center gap-2 p-3 bg-muted rounded-xl text-sm mb-4">
                  <Car className="w-4 h-4 text-muted-foreground" />
                  <span>{driver.vehicle_model || "Sin modelo"}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono font-semibold">{driver.vehicle_plate}</span>
                  {driver.vehicle_color && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <span>{driver.vehicle_color}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={driver.status}
                    onValueChange={(val) => updateMutation.mutate({ id: driver.id, data: { status: val } })}
                  >
                    <SelectTrigger className="flex-1 h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="disponible">Disponible</SelectItem>
                      <SelectItem value="en_viaje">En Viaje</SelectItem>
                      <SelectItem value="no_disponible">No Disponible</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    onClick={() => deleteMutation.mutate(driver.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}