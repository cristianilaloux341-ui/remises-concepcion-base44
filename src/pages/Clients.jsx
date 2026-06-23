import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Phone, Car, MapPin, BarChart2, UserCog, Trash2 } from "lucide-react";
import ClientTripStats from "@/components/clients/ClientTripStats";

function scoreColor(score) {
  if (score >= 8) return "text-green-600";
  if (score >= 5) return "text-amber-600";
  return "text-red-600";
}

function scoreBg(score) {
  if (score >= 8) return "bg-green-100 text-green-700";
  if (score >= 5) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function scoreLabel(score) {
  if (score >= 9) return "Excelente";
  if (score >= 7) return "Bueno";
  if (score >= 5) return "Regular";
  if (score >= 3) return "Conflictivo";
  return "Lista Negra";
}

function ClientForm({ client, drivers, onSave, onClose }) {
  const [form, setForm] = useState(client || {
    name: "", phone: "", pickup_address: "", score: 5, complaints: 0, cancelled_trips: 0,
    total_trips: 0, preferred_driver_id: "", preferred_driver_name: "",
    blacklisted: false, notes: ""
  });
  const [error, setError] = useState("");

  const handleSave = () => {
    if (!form.name.trim()) { setError("El nombre es obligatorio."); return; }
    setError("");
    onSave(form);
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Nombre <span className="text-red-500">*</span></Label>
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Nombre del cliente" />
        </div>
        <div className="space-y-1">
          <Label>Teléfono <span className="text-muted-foreground text-xs">(opcional)</span></Label>
          <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="Sin teléfono" />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Dirección habitual <span className="text-muted-foreground text-xs">(opcional)</span></Label>
        <Input value={form.pickup_address || ""} onChange={e => setForm({ ...form, pickup_address: e.target.value })} placeholder="Ej: Rivadavia 1234" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Puntuación (1-10)</Label>
          <Input type="number" min={1} max={10} value={form.score}
            onChange={e => setForm({ ...form, score: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label>Reclamos</Label>
          <Input type="number" min={0} value={form.complaints}
            onChange={e => setForm({ ...form, complaints: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label>Cancelaciones</Label>
          <Input type="number" min={0} value={form.cancelled_trips}
            onChange={e => setForm({ ...form, cancelled_trips: Number(e.target.value) })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Móvil preferido (opcional)</Label>
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
          <SelectTrigger><SelectValue placeholder="Sin preferencia..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ninguno">Sin preferencia</SelectItem>
            {drivers.map(d => (
              <SelectItem key={d.id} value={d.id}>{d.name} — {d.vehicle_plate}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Notas / Observaciones</Label>
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder="Ej: siempre pide el mismo auto, reclama mucho, etc." className="h-20" />
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.blacklisted} onCheckedChange={v => setForm({ ...form, blacklisted: v })} />
        <Label className="text-red-600 font-medium">Lista negra (no tomar viajes)</Label>
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
        <Button className="flex-1" onClick={handleSave}>Guardar</Button>
      </div>
    </div>
  );
}

function ClientCard({ client, onEdit }) {
  return (
    <Card className={`hover:shadow-md transition-all cursor-pointer ${client.blacklisted ? "border-red-300 bg-red-50" : ""}`}
      onClick={() => onEdit(client)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{client.name}</p>
              {client.blacklisted && <Badge className="bg-red-100 text-red-700 border-0 text-xs">⛔ Lista Negra</Badge>}
            </div>
            {client.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" />{client.phone}
              </p>
            )}
            {client.pickup_address && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-green-500" />{client.pickup_address}
              </p>
            )}
          </div>
          <div className={`text-center px-3 py-1.5 rounded-xl shrink-0 ml-2 ${scoreBg(client.score || 5)}`}>
            <p className="text-lg font-bold leading-none">{client.score || 5}</p>
            <p className="text-xs mt-0.5">{scoreLabel(client.score || 5)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-muted rounded-lg p-2">
            <p className="font-bold text-base">{client.total_trips || 0}</p>
            <p className="text-muted-foreground">Viajes</p>
          </div>
          <div className={`rounded-lg p-2 ${client.cancelled_trips > 2 ? "bg-red-100" : "bg-muted"}`}>
            <p className="font-bold text-base">{client.cancelled_trips || 0}</p>
            <p className="text-muted-foreground">Cancela</p>
          </div>
          <div className={`rounded-lg p-2 ${client.complaints > 2 ? "bg-amber-100" : "bg-muted"}`}>
            <p className="font-bold text-base">{client.complaints || 0}</p>
            <p className="text-muted-foreground">Reclamos</p>
          </div>
        </div>

        {client.preferred_driver_name && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Car className="w-3 h-3 text-blue-500" /> Prefiere: <span className="font-medium">{client.preferred_driver_name}</span>
          </p>
        )}
        {client.notes && (
          <p className="text-xs text-muted-foreground italic line-clamp-2">"{client.notes}"</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Clients() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modalTab, setModalTab] = useState("ficha");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => base44.entities.Client.list("-created_date", 200),
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Client.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setShowForm(false);
      setEditing(null);
    }
  });

  const saveMutation = useMutation({
    mutationFn: async (form) => {
      if (form.phone && form.phone.trim()) {
        const existing = clients.find(c =>
          c.phone && c.phone.trim() === form.phone.trim() && c.id !== editing?.id
        );
        if (existing) throw new Error(`El teléfono ya está registrado para el cliente "${existing.name}".`);
      }
      if (editing?.id) {
        await base44.entities.Client.update(editing.id, form);
      } else {
        await base44.entities.Client.create(form);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setShowForm(false);
      setEditing(null);
    }
  });

  const filtered = clients.filter(c =>
    !search ||
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.pickup_address?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground mt-1">Historial y puntuación</p>
        </div>
        <Button className="rounded-xl gap-2" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus className="w-4 h-4" /> Nuevo Cliente
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold">{clients.length}</p>
          <p className="text-xs text-muted-foreground">Total Clientes</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{clients.filter(c => c.blacklisted).length}</p>
          <p className="text-xs text-muted-foreground">Lista Negra</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{clients.filter(c => (c.score || 5) >= 8).length}</p>
          <p className="text-xs text-muted-foreground">Excelentes</p>
        </Card>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9 rounded-xl" placeholder="Buscar por nombre, teléfono o dirección..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(client => (
          <ClientCard key={client.id} client={client} onEdit={(c) => { setEditing(c); setShowForm(true); }} />
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); setEditing(null); setModalTab("ficha"); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? editing.name : "Nuevo Cliente"}</DialogTitle>
          </DialogHeader>

          {/* Tabs solo cuando estamos editando */}
          {editing?.id && (
            <div className="flex gap-1 bg-muted p-1 rounded-xl mb-2">
              <button
                onClick={() => setModalTab("ficha")}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-all ${modalTab === "ficha" ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}
              >
                <UserCog className="w-3.5 h-3.5" /> Ficha
              </button>
              <button
                onClick={() => setModalTab("estadisticas")}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-all ${modalTab === "estadisticas" ? "bg-white shadow text-foreground" : "text-muted-foreground"}`}
              >
                <BarChart2 className="w-3.5 h-3.5" /> Estadísticas
              </button>
            </div>
          )}

          {(!editing?.id || modalTab === "ficha") && (
            <>
              {saveMutation.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveMutation.error?.message}</p>
              )}
              <ClientForm
                client={editing}
                drivers={drivers}
                onSave={(form) => saveMutation.mutate(form)}
                onClose={() => { setShowForm(false); setEditing(null); setModalTab("ficha"); }}
              />
              {editing?.id && (
                <div className="border-t pt-3 mt-1">
                  <Button
                    variant="destructive"
                    className="w-full gap-2"
                    onClick={() => { if (confirm(`¿Eliminar a ${editing.name}? Esta acción no se puede deshacer.`)) deleteMutation.mutate(editing.id); }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                    {deleteMutation.isPending ? "Eliminando..." : "Eliminar cliente"}
                  </Button>
                </div>
              )}
            </>
          )}

          {editing?.id && modalTab === "estadisticas" && (
            <ClientTripStats clientId={editing.id} clientName={editing.name} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}