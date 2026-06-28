import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Map, Search } from "lucide-react";
import TarifaConfigPanel from "@/components/tarifa/TarifaConfig";
import ZoneDrawMap from "@/components/map/ZoneDrawMap";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const ZONES = ["1-Puerto","2-Plaza","3-Columna","4-Base","5-Cementerio","6-Díaz Vélez","7-Don Bosco","8-Monumento"];

const ZONE_COLORS = {
  "1-Puerto": "bg-blue-100 text-blue-700",
  "2-Plaza": "bg-green-100 text-green-700",
  "3-Columna": "bg-yellow-100 text-yellow-700",
  "4-Base": "bg-orange-100 text-orange-700",
  "5-Cementerio": "bg-purple-100 text-purple-700",
  "6-Díaz Vélez": "bg-pink-100 text-pink-700",
  "7-Don Bosco": "bg-teal-100 text-teal-700",
  "8-Monumento": "bg-red-100 text-red-700",
};

export default function ZoneSettings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [filterZone, setFilterZone] = useState("all");
  const [newRow, setNewRow] = useState({ keyword: "", zone: "", priority: 1, notes: "" });
  const [selectedDrawZone, setSelectedDrawZone] = useState(ZONES[0]);

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ["zone_mappings"],
    queryFn: () => base44.entities.ZoneMapping.list("-priority"),
  });

  const { data: polygons = [], isLoading: isLoadingPolygons } = useQuery({
    queryKey: ["zone_polygons"],
    queryFn: () => base44.entities.ZonePolygon.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ZoneMapping.create(data),
    onSuccess: () => { qc.invalidateQueries(["zone_mappings"]); setNewRow({ keyword: "", zone: "", priority: 1, notes: "" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ZoneMapping.delete(id),
    onSuccess: () => qc.invalidateQueries(["zone_mappings"]),
  });

  const createPolygonMutation = useMutation({
    mutationFn: (data) => base44.entities.ZonePolygon.create(data),
    onSuccess: () => qc.invalidateQueries(["zone_polygons"]),
  });

  const updatePolygonMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ZonePolygon.update(id, data),
    onSuccess: () => qc.invalidateQueries(["zone_polygons"]),
  });

  const deletePolygonMutation = useMutation({
    mutationFn: (id) => base44.entities.ZonePolygon.delete(id),
    onSuccess: () => qc.invalidateQueries(["zone_polygons"]),
  });

  const handlePolygonCreated = (coordinates, layer) => {
    // Remove the layer immediately from the map, we'll let React-Leaflet handle rendering it
    if (layer && layer._map) {
      layer._map.removeLayer(layer);
    }
    
    const newZone = selectedDrawZone;
    const matchColor = ZONE_COLORS[newZone]?.match(/text-(\w+)-700/);
    const baseColor = matchColor ? matchColor[1] : "blue";
    
    // Convert tailwind color to hex roughly
    const colorMap = {
      blue: "#3b82f6", green: "#22c55e", yellow: "#eab308", 
      orange: "#f97316", purple: "#a855f7", pink: "#ec4899", 
      teal: "#14b8a6", red: "#ef4444"
    };
    
    createPolygonMutation.mutate({
      zone: newZone,
      coordinates,
      color: colorMap[baseColor] || "#3b82f6"
    });
  };

  const handlePolygonEdited = (id, coordinates) => {
    updatePolygonMutation.mutate({ id, data: { coordinates } });
  };

  const handlePolygonDeleted = (id) => {
    deletePolygonMutation.mutate(id);
  };

  const handleAdd = () => {
    if (!newRow.keyword.trim() || !newRow.zone) return;
    createMutation.mutate({ ...newRow, priority: Number(newRow.priority) || 1 });
  };

  const filtered = mappings.filter(m => {
    const matchText = !filter || m.keyword?.toLowerCase().includes(filter.toLowerCase());
    const matchZone = filterZone === "all" || m.zone === filterZone;
    return matchText && matchZone;
  });

  // Group by zone for display
  const byZone = ZONES.reduce((acc, z) => {
    acc[z] = filtered.filter(m => m.zone === z);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Button variant="ghost" className="gap-2 md:hidden -ml-3" onClick={() => navigate(-1)}>
        <ArrowLeft className="w-4 h-4" /> Volver
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Map className="w-6 h-6 text-primary" />
          Configuración del Sistema
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tarifas automáticas y diccionario de zonas.
        </p>
      </div>

      {/* ── TARIFAS ── */}
      <TarifaConfigPanel />

      {/* ── ZONAS ── */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Map className="w-5 h-5 text-primary" /> Mapa de Zonas (Geofencing)
        </h2>
        <p className="text-muted-foreground text-sm mb-4">
          Elegí la zona a dibujar en el selector de abajo, luego trazá el polígono en el mapa usando la herramienta (⬟). Podés editar o borrar los polígonos existentes en cualquier momento.
        </p>
      </div>

      <Card>
        <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center gap-3 bg-muted/30">
          <Label className="font-semibold whitespace-nowrap">Siguiente zona a dibujar:</Label>
          <Select value={selectedDrawZone} onValueChange={setSelectedDrawZone}>
            <SelectTrigger className="w-full sm:w-64 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZONES.map(z => (
                <SelectItem key={z} value={z}>
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${ZONE_COLORS[z].split(' ')[0]}`} />
                    {z}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CardContent className="p-0">
          <ZoneDrawMap 
            polygons={polygons}
            onPolygonCreated={handlePolygonCreated}
            onPolygonEdited={handlePolygonEdited}
            onPolygonDeleted={handlePolygonDeleted}
          />
        </CardContent>
        <CardContent className="p-4 border-t flex flex-wrap gap-2">
          {polygons.map(p => (
            <div key={p.id} className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-full text-xs">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color || '#3b82f6' }} />
              <span className="font-semibold">{p.zone}</span>
              <Select 
                value={p.zone} 
                onValueChange={(v) => {
                  const matchColor = ZONE_COLORS[v]?.match(/text-(\w+)-700/);
                  const baseColor = matchColor ? matchColor[1] : "blue";
                  const colorMap = {
                    blue: "#3b82f6", green: "#22c55e", yellow: "#eab308", 
                    orange: "#f97316", purple: "#a855f7", pink: "#ec4899", 
                    teal: "#14b8a6", red: "#ef4444"
                  };
                  updatePolygonMutation.mutate({ id: p.id, data: { zone: v, color: colorMap[baseColor] } });
                }}
              >
                <SelectTrigger className="h-6 w-28 text-xs border-none bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ZONES.map(z => <SelectItem key={z} value={z} className="text-xs">{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="pt-6">
        <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <Search className="w-5 h-5 text-primary" /> Diccionario de Texto (Opcional)
        </h2>
        <p className="text-muted-foreground text-sm mb-4">
          Reglas manuales de coincidencia de texto como respaldo al mapa.
        </p>
      </div>

      {/* Add new */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agregar nueva regla</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <Label>Calle / Palabra clave</Label>
              <Input
                placeholder="Ej: Av. San Martín, Puerto, Hospital..."
                value={newRow.keyword}
                onChange={(e) => setNewRow(p => ({ ...p, keyword: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1">
              <Label>Zona</Label>
              <Select value={newRow.zone} onValueChange={(v) => setNewRow(p => ({ ...p, zone: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={newRow.priority}
                onChange={(e) => setNewRow(p => ({ ...p, priority: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <Label>Notas (opcional)</Label>
            <Input
              placeholder="Ej: altura 100-500, barrio norte..."
              value={newRow.notes}
              onChange={(e) => setNewRow(p => ({ ...p, notes: e.target.value }))}
            />
          </div>
          <Button
            className="mt-4 gap-2"
            onClick={handleAdd}
            disabled={!newRow.keyword.trim() || !newRow.zone || createMutation.isPending}
          >
            <Plus className="w-4 h-4" />
            Agregar regla
          </Button>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar calle..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <Select value={filterZone} onValueChange={setFilterZone}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las zonas</SelectItem>
            {ZONES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="self-center">{filtered.length} reglas</Badge>
      </div>

      {/* List grouped by zone */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {ZONES.map(zone => {
            const items = byZone[zone];
            if (items.length === 0 && filterZone !== "all" && filterZone !== zone) return null;
            if (items.length === 0 && filter) return null;
            return (
              <Card key={zone}>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge className={ZONE_COLORS[zone]}>{zone}</Badge>
                    <span className="text-muted-foreground font-normal">{items.length} reglas</span>
                  </CardTitle>
                </CardHeader>
                {items.length > 0 && (
                  <CardContent className="px-4 pb-4 pt-0">
                    <div className="divide-y">
                      {items.map(m => (
                        <div key={m.id} className="flex items-center justify-between py-2 gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm">{m.keyword}</p>
                            {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">P:{m.priority || 1}</Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-400 hover:text-red-600 shrink-0"
                            onClick={() => deleteMutation.mutate(m.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}