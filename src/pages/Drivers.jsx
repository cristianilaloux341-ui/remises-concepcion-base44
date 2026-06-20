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
import { Plus, Phone, Car, Trash2, Loader2, User, History, Trash, AlertCircle, Upload, MapPin, CreditCard, NotebookPen, ClipboardList } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { DocVencimientosAlert, ReinscripcionPanel } from "@/components/docs/DocAlerts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

function DriverForm({ onSubmit, isSubmitting, initial }) {
  const [form, setForm] = useState(initial || {
    name: "", phone: "", dni: "", direccion: "", photo_url: "", carnet_categoria: "",
    vehicle_model: "", vehicle_plate: "", vehicle_color: "", status: "disponible", notas: "",
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set("photo_url", file_url);
    setUploadingPhoto(false);
  };

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {/* Foto */}
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center overflow-hidden shrink-0">
          {form.photo_url
            ? <img src={form.photo_url} alt="foto" className="w-full h-full object-cover" />
            : <User className="w-7 h-7 text-muted-foreground" />}
        </div>
        <div>
          <Label className="text-xs">Foto del conductor</Label>
          <label className="mt-1 flex items-center gap-2 cursor-pointer text-sm text-primary hover:underline">
            <Upload className="w-4 h-4" />
            {uploadingPhoto ? "Subiendo..." : "Subir foto"}
            <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} disabled={uploadingPhoto} />
          </label>
        </div>
      </div>

      {/* Datos personales */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Nombre *</Label>
          <Input value={form.name} onChange={e => set("name", e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label>Teléfono *</Label>
          <Input value={form.phone} onChange={e => set("phone", e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>DNI</Label>
          <Input value={form.dni} onChange={e => set("dni", e.target.value)} placeholder="Ej: 28.345.678" />
        </div>
        <div className="space-y-1">
          <Label>Carnet Categoría</Label>
          <Select value={form.carnet_categoria} onValueChange={v => set("carnet_categoria", v)}>
            <SelectTrigger><SelectValue placeholder="Categoría..." /></SelectTrigger>
            <SelectContent>
              {["A","B","C","D","E","F","G"].map(c => <SelectItem key={c} value={c}>Categoría {c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Dirección</Label>
        <Input value={form.direccion} onChange={e => set("direccion", e.target.value)} placeholder="Ej: San Martín 1234" />
      </div>

      {/* Notas internas */}
      <div className="space-y-1">
        <Label className="flex items-center gap-1"><NotebookPen className="w-3.5 h-3.5" /> Notas internas de la comisión</Label>
        <textarea
          value={form.notas}
          onChange={e => set("notas", e.target.value)}
          placeholder="Ej: Le falta renovar el carnet, revisar VTV en agosto..."
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
      </div>

      {/* Vehículo */}
      <div className="border-t pt-3">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Vehículo</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label>Modelo</Label>
            <Input value={form.vehicle_model} onChange={e => set("vehicle_model", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Patente *</Label>
            <Input value={form.vehicle_plate} onChange={e => set("vehicle_plate", e.target.value.toUpperCase())} required className="font-mono" />
          </div>
          <div className="space-y-1">
            <Label>Color</Label>
            <Input value={form.vehicle_color} onChange={e => set("vehicle_color", e.target.value)} />
          </div>
        </div>
      </div>

      <Button type="submit" className="w-full rounded-xl" disabled={isSubmitting || uploadingPhoto}>
        {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        {initial ? "Guardar Cambios" : "Agregar Conductor"}
      </Button>
    </form>
  );
}

function DriverHistory({ driverId, driverName, onClose }) {
  const queryClient = useQueryClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: orders = [] } = useQuery({
    queryKey: ["driver-history", driverId],
    queryFn: () => base44.entities.RideOrder.filter({ driver_id: driverId }),
  });

  const deleteMutation = useMutation({
    mutationFn: (orderId) => base44.entities.RideOrder.delete(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["driver-history", driverId] });
    },
  });

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const todayOrders = orders.filter(o => {
    const orderDate = new Date(o.created_date);
    orderDate.setHours(0, 0, 0, 0);
    return orderDate.getTime() === today.getTime();
  });

  const statusColors = {
    pendiente: "bg-amber-50 border-amber-200 text-amber-700",
    ofrecido: "bg-blue-50 border-blue-200 text-blue-700",
    aceptado: "bg-purple-50 border-purple-200 text-purple-700",
    en_camino: "bg-purple-50 border-purple-200 text-purple-700",
    en_viaje: "bg-cyan-50 border-cyan-200 text-cyan-700",
    completado: "bg-green-50 border-green-200 text-green-700",
    cancelado: "bg-red-50 border-red-200 text-red-700",
    rechazado: "bg-red-50 border-red-200 text-red-700",
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Historial de Viajes — {driverName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-700 font-semibold">
              Total hoy: <span className="text-lg">{todayOrders.length} viaje{todayOrders.length !== 1 ? 's' : ''}</span>
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Completados: {todayOrders.filter(o => o.status === 'completado').length}
            </p>
          </div>

          {todayOrders.length === 0 ? (
            <div className="text-center py-8">
              <Car className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-muted-foreground text-sm">Sin viajes hoy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayOrders.map(order => (
                <Card key={order.id} className={`border ${statusColors[order.status]}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{order.client_name}</p>
                        <p className="text-xs">{order.pickup_address}{order.dropoff_address ? ' → ' + order.dropoff_address : ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge className={statusColors[order.status] + " border-0 text-xs"}>
                          {order.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {order.fare && <span className="font-semibold text-green-600">${order.fare}</span>}
                      </span>
                      <span>{format(new Date(order.created_date), "HH:mm")}</span>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive hover:bg-red-50 h-7 gap-1"
                        onClick={() => setDeleteConfirm(order)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash className="w-3 h-3" /> Eliminar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                Eliminar Viaje
              </AlertDialogTitle>
              <AlertDialogDescription>
                ¿Eliminar el viaje de {deleteConfirm?.client_name}? Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm">
              <p><strong>Dirección:</strong> {deleteConfirm?.pickup_address}</p>
              {deleteConfirm?.fare && <p><strong>Tarifa:</strong> ${deleteConfirm.fare}</p>}
            </div>
            <div className="flex gap-3">
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (deleteConfirm?.id) {
                    deleteMutation.mutate(deleteConfirm.id);
                    setDeleteConfirm(null);
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                Eliminar
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export default function Drivers() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [reinscripcionMovil, setReinscripcionMovil] = useState(null);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const { data: moviles = [] } = useQuery({
    queryKey: ["moviles"],
    queryFn: () => base44.entities.Movil.list(),
  });

  // Busca el móvil por patente del chofer
  const getMovil = (driver) =>
    moviles.find(m => m.dominio && driver.vehicle_plate &&
      m.dominio.replace(/\s/g,"").toUpperCase() === driver.vehicle_plate.replace(/\s/g,"").toUpperCase()
    );

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Driver.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setDialogOpen(false);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Driver.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setEditingDriver(null);
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nuevo Conductor</DialogTitle>
            </DialogHeader>
            <DriverForm onSubmit={(data) => createMutation.mutate(data)} isSubmitting={createMutation.isPending} />
          </DialogContent>
        </Dialog>

        {/* Dialog edición */}
        <Dialog open={!!editingDriver} onOpenChange={(v) => !v && setEditingDriver(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Editar Conductor — {editingDriver?.name}</DialogTitle>
            </DialogHeader>
            <DriverForm
              initial={editingDriver}
              onSubmit={(data) => editMutation.mutate({ id: editingDriver.id, data })}
              isSubmitting={editMutation.isPending}
            />
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
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
                      {driver.photo_url
                        ? <img src={driver.photo_url} alt={driver.name} className="w-full h-full object-cover" />
                        : <User className="w-6 h-6 text-primary" />}
                    </div>
                    <div>
                      <p className="font-semibold">{driver.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {driver.phone}
                      </p>
                      {driver.dni && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <CreditCard className="w-3 h-3" /> DNI {driver.dni}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={statusColors[driver.status]}>
                    {driver.status?.replace("_", " ")}
                  </Badge>
                </div>
                {(driver.direccion || driver.carnet_categoria) && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {driver.direccion && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {driver.direccion}
                      </span>
                    )}
                    {driver.carnet_categoria && (
                      <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                        Carnet Cat. {driver.carnet_categoria}
                      </span>
                    )}
                  </div>
                )}

                {(() => {
                  const movil = getMovil(driver);
                  return (
                    <div className="p-3 bg-muted rounded-xl text-sm mb-4 space-y-1">
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-mono font-semibold">{movil?.dominio || driver.vehicle_plate || "—"}</span>
                        {movil?.numero_movil && (
                          <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
                            Móvil {movil.numero_movil}
                          </span>
                        )}
                      </div>
                      {(movil?.marca || movil?.modelo || driver.vehicle_model) && (
                        <p className="text-xs text-muted-foreground pl-6">
                          {[movil?.marca, movil?.modelo || driver.vehicle_model, movil?.color || driver.vehicle_color].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {driver.notas && (
                  <div className="mb-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <NotebookPen className="w-3.5 h-3.5 text-yellow-600 mt-0.5 shrink-0" />
                    <p className="text-xs text-yellow-800">{driver.notas}</p>
                  </div>
                )}

                {/* Alertas de vencimiento del móvil vinculado */}
                {(() => {
                  const movil = getMovil(driver);
                  if (!movil) return null;
                  const campos = [
                    { key: "vtv_vencimiento",                      label: "VTV / RTO",               fecha: movil.vtv_vencimiento },
                    { key: "seguro_automotor_vencimiento",          label: "Seguro Automotor",        fecha: movil.seguro_automotor_vencimiento },
                    { key: "seguro_riesgos_personales_vencimiento", label: "Seg. Riesgos Personales", fecha: movil.seguro_riesgos_personales_vencimiento },
                    { key: "buena_conducta_vencimiento",            label: "Buena Conducta",          fecha: movil.buena_conducta_vencimiento },
                    { key: "pago_mensual_al_dia",                   label: "Pago mensual al día",     boolean: true, valor: movil.pago_mensual_al_dia },
                  ];
                  return (
                    <div className="mb-3">
                      <DocVencimientosAlert nombre={`Móvil ${movil.numero_movil}`} campos={campos} />
                      {reinscripcionMovil?.id === movil.id && (
                        <div className="mt-2">
                          <ReinscripcionPanel
                            nombre={`${driver.name} — Móvil ${movil.numero_movil}`}
                            campos={campos}
                            onClose={() => setReinscripcionMovil(null)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}

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
                     variant="outline"
                     size="icon"
                     className="h-9 w-9"
                     onClick={() => setEditingDriver(driver)}
                     title="Editar conductor"
                   >
                     <User className="w-4 h-4" />
                   </Button>
                   <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      onClick={() => setSelectedDriver(driver)}
                      title="Ver historial"
                    >
                      <History className="w-4 h-4" />
                    </Button>
                    {getMovil(driver) && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 text-blue-500 border-blue-200"
                        title="Lista reinscripción"
                        onClick={() => setReinscripcionMovil(prev => prev?.id === getMovil(driver)?.id ? null : getMovil(driver))}
                      >
                        <ClipboardList className="w-4 h-4" />
                      </Button>
                    )}
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

      {selectedDriver && (
        <DriverHistory
          driverId={selectedDriver.id}
          driverName={selectedDriver.name}
          onClose={() => setSelectedDriver(null)}
        />
      )}
    </div>
  );
}