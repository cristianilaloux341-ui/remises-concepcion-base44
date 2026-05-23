import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Phone, CheckCircle2, XCircle, Navigation, Car, Clock, Loader2, LogIn } from "lucide-react";
import RideMap from "@/components/map/RideMap";
import { BASES } from "@/lib/dispatchLogic";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const STATUS_LABELS = {
  ofrecido: { label: "Nuevo Viaje", color: "bg-amber-500" },
  aceptado: { label: "Aceptado", color: "bg-blue-500" },
  en_camino: { label: "En Camino", color: "bg-purple-500" },
  en_viaje: { label: "En Viaje", color: "bg-cyan-500" },
  completado: { label: "Completado", color: "bg-green-500" },
};

export default function DriverApp() {
  const queryClient = useQueryClient();
  const [myDriverId, setMyDriverId] = useState(() => localStorage.getItem("my_driver_id") || "");
  const [selectedBase, setSelectedBase] = useState("");
  const [geoError, setGeoError] = useState(null);
  const [myLat, setMyLat] = useState(null);
  const [myLng, setMyLng] = useState(null);

  // Watch position
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => { setMyLat(pos.coords.latitude); setMyLng(pos.coords.longitude); },
      () => setGeoError("No se pudo obtener la ubicación")
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: () => base44.entities.Driver.list(),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: () => base44.entities.RideOrder.list("-created_date", 50),
    refetchInterval: 5000,
  });

  const myDriver = drivers.find(d => d.id === myDriverId);

  // Orders offered to me or assigned to me
  const myOrders = orders.filter(o =>
    (o.driver_id === myDriverId && ["ofrecido", "aceptado", "en_camino", "en_viaje"].includes(o.status)) ||
    (o.status === "pendiente" && !o.driver_id)
  );
  const activeOrder = orders.find(o => o.driver_id === myDriverId && ["aceptado", "en_camino", "en_viaje"].includes(o.status));
  const offeredOrder = orders.find(o => o.driver_id === myDriverId && o.status === "ofrecido");
  const availableOrders = orders.filter(o => o.status === "pendiente" && !o.driver_id);

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.RideOrder.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });

  const updateDriverMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Driver.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const handleSelectDriver = (driverId) => {
    setMyDriverId(driverId);
    localStorage.setItem("my_driver_id", driverId);
  };

  const handleEnterBase = () => {
    if (!selectedBase || !myDriver) return;
    updateDriverMutation.mutate({
      id: myDriver.id,
      data: {
        current_base: selectedBase,
        status: "disponible",
        queue_entered_at: new Date().toISOString(),
        ...(myLat && myLng ? { current_lat: myLat, current_lng: myLng } : {}),
      },
    });
  };

  const handleAccept = (order) => {
    updateOrderMutation.mutate({ id: order.id, data: { status: "aceptado" } });
    updateDriverMutation.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  const handleReject = (order) => {
    updateOrderMutation.mutate({
      id: order.id,
      data: { status: "pendiente", driver_id: null, driver_name: null },
    });
  };

  const handleStatusChange = (order, newStatus) => {
    updateOrderMutation.mutate({ id: order.id, data: { status: newStatus } });
    if (newStatus === "completado") {
      updateDriverMutation.mutate({
        id: myDriverId,
        data: {
          status: "disponible",
          queue_entered_at: new Date().toISOString(),
        },
      });
    }
  };

  const handleTakeOrder = (order) => {
    updateOrderMutation.mutate({
      id: order.id,
      data: {
        status: "aceptado",
        driver_id: myDriverId,
        driver_name: myDriver?.name,
        assigned_base: myDriver?.current_base,
      },
    });
    updateDriverMutation.mutate({ id: myDriverId, data: { status: "en_viaje" } });
  };

  // Not logged in as driver
  if (!myDriver) {
    return (
      <div className="min-h-screen bg-sidebar flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-sidebar-primary/20 flex items-center justify-center mx-auto mb-4">
              <Car className="w-8 h-8 text-sidebar-primary" />
            </div>
            <h1 className="text-2xl font-bold text-white">App del Chófer</h1>
            <p className="text-sidebar-foreground/60 mt-1">Remisería</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <LogIn className="w-4 h-4" />
                Identificarse
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Seleccioná tu perfil para comenzar</p>
              {drivers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hay chóferes registrados. Pedile al operador que te agregue.
                </p>
              ) : (
                drivers.map(d => (
                  <button
                    key={d.id}
                    className="w-full p-3 rounded-xl border text-left hover:border-primary hover:bg-primary/5 transition-colors"
                    onClick={() => handleSelectDriver(d.id)}
                  >
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{d.vehicle_plate} · {d.vehicle_model}</p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-sidebar text-white px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sidebar-primary/30 flex items-center justify-center">
              <Car className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-semibold">{myDriver.name}</p>
              <p className="text-xs text-white/60 font-mono">{myDriver.vehicle_plate}</p>
            </div>
          </div>
          <button className="text-xs text-white/40 underline" onClick={() => { localStorage.removeItem("my_driver_id"); setMyDriverId(""); }}>
            Salir
          </button>
        </div>

        {/* Base entry */}
        {!myDriver.current_base || myDriver.status !== "disponible" ? (
          <div className="flex gap-2">
            <Select value={selectedBase} onValueChange={setSelectedBase}>
              <SelectTrigger className="flex-1 h-9 bg-sidebar-accent text-white border-sidebar-border text-sm">
                <SelectValue placeholder="Entrar a base..." />
              </SelectTrigger>
              <SelectContent>
                {BASES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-9 px-4 bg-sidebar-primary hover:bg-sidebar-primary/90" onClick={handleEnterBase} disabled={!selectedBase}>
              Entrar
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between bg-sidebar-accent rounded-xl px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm font-medium">Base: {myDriver.current_base}</span>
            </div>
            <Badge className="bg-green-500/20 text-green-300 border-0 text-xs">En posición</Badge>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Offered order (must respond) */}
        {offeredOrder && (
          <Card className="border-2 border-amber-400 shadow-lg shadow-amber-100">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                <CardTitle className="text-base text-amber-700">¡Nuevo Viaje Asignado!</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-4 h-4 rounded-full bg-green-500 shrink-0" />
                  <span className="font-medium">{offeredOrder.pickup_address}</span>
                </div>
                {offeredOrder.dropoff_address && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-red-500 shrink-0" />
                    <span>{offeredOrder.dropoff_address}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="w-4 h-4" />
                  <span>{offeredOrder.client_name} · {offeredOrder.client_phone}</span>
                </div>
              </div>
              {offeredOrder.fare && (
                <p className="text-lg font-bold text-green-600">${offeredOrder.fare.toLocaleString()}</p>
              )}
              <div className="flex gap-2">
                <Button className="flex-1 gap-2 bg-green-500 hover:bg-green-600 rounded-xl" onClick={() => handleAccept(offeredOrder)}>
                  <CheckCircle2 className="w-4 h-4" /> Aceptar
                </Button>
                <Button variant="outline" className="flex-1 gap-2 text-red-500 border-red-200 hover:bg-red-50 rounded-xl" onClick={() => handleReject(offeredOrder)}>
                  <XCircle className="w-4 h-4" /> Rechazar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active order map & controls */}
        {activeOrder && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Viaje en Curso</CardTitle>
                <Badge className={`${STATUS_LABELS[activeOrder.status]?.color} text-white border-0`}>
                  {STATUS_LABELS[activeOrder.status]?.label}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-48 rounded-xl overflow-hidden">
                <RideMap orders={[activeOrder]} drivers={[]} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-green-500 mt-0.5 shrink-0" />
                  <span>{activeOrder.pickup_address}</span>
                </div>
                {activeOrder.dropoff_address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <span>{activeOrder.dropoff_address}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-3 h-3" />
                  <span>{activeOrder.client_name} · {activeOrder.client_phone}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {activeOrder.status === "aceptado" && (
                  <Button className="col-span-2 rounded-xl gap-2 bg-purple-500 hover:bg-purple-600" onClick={() => handleStatusChange(activeOrder, "en_camino")}>
                    <Navigation className="w-4 h-4" /> Saliendo a Buscar
                  </Button>
                )}
                {activeOrder.status === "en_camino" && (
                  <Button className="col-span-2 rounded-xl gap-2 bg-cyan-500 hover:bg-cyan-600" onClick={() => handleStatusChange(activeOrder, "en_viaje")}>
                    <Car className="w-4 h-4" /> Pasajero a Bordo
                  </Button>
                )}
                {activeOrder.status === "en_viaje" && (
                  <Button className="col-span-2 rounded-xl gap-2 bg-green-500 hover:bg-green-600" onClick={() => handleStatusChange(activeOrder, "completado")}>
                    <CheckCircle2 className="w-4 h-4" /> Completar Viaje
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Available orders to pick (when driver is free and many orders) */}
        {!activeOrder && !offeredOrder && myDriver.status === "disponible" && availableOrders.length > 1 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-muted-foreground">Viajes Disponibles ({availableOrders.length})</p>
            {availableOrders.map(order => (
              <Card key={order.id} className="border hover:border-primary/50 cursor-pointer transition-colors">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full bg-green-500 shrink-0" />
                    <span className="font-medium">{order.pickup_address}</span>
                  </div>
                  {order.dropoff_address && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="w-3 h-3 text-red-400 shrink-0" />
                      <span>{order.dropoff_address}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{order.client_name}</span>
                    {order.fare && <span className="font-bold text-green-600">${order.fare.toLocaleString()}</span>}
                  </div>
                  <Button size="sm" className="w-full rounded-lg" onClick={() => handleTakeOrder(order)}>
                    Tomar este Viaje
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Idle state */}
        {!activeOrder && !offeredOrder && (!myDriver.current_base || myDriver.status !== "disponible") && (
          <div className="text-center py-12 text-muted-foreground">
            <Car className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Seleccioná una base para quedar en posición</p>
          </div>
        )}

        {!activeOrder && !offeredOrder && myDriver.current_base && myDriver.status === "disponible" && availableOrders.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">En espera de viaje</p>
            <p className="text-sm">Base: {myDriver.current_base}</p>
          </div>
        )}
      </div>
    </div>
  );
}