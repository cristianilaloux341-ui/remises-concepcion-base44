import { useState } from "react";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PullToRefresh from "@/components/ui/pull-to-refresh";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search } from "lucide-react";
import OrderCard from "@/components/orders/OrderCard";
import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/permissions";
import { useMutation } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function Orders() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  const localOperator = (() => { try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; } })();
  const { role: effectiveRole } = usePermissions(user);
  const isAdmin = effectiveRole === "admin";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { orders, isLoading } = useRealtimeOrders({ limit: 100, fallbackRefreshMs: 2000 });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const orderToDelete = orders.find(o => o.id === id);
      if (orderToDelete) {
        // El historial de ofertas no autoriza a liberar móviles: podrían estar ya en otro viaje.
        const toCancel = [...new Set([orderToDelete.driver_id, orderToDelete.reserved_driver_id])].filter(Boolean);
        if (toCancel.length > 0) {
          await base44.entities.Driver.updateMany(
            { id: { $in: toCancel }, $or: [{ active_order_id: orderToDelete.id }, { active_ride_id: orderToDelete.id }, { reserved_order_id: orderToDelete.id }] },
            {
              $set: {
                status: "disponible",
                dispatch_status: "normal",
                active_ride_id: null,
                reserved_order_id: null,
                reservation_token: null,
                manual_reservation_token: null,
                driver_reservation_key: null
              }
            }
          ).catch(() => {});
        }
      }
      return base44.entities.RideOrder.delete(id);
    },
    onSuccess: (_, id) => {
      base44.entities.AuditLog.create({
        action: "eliminar_viaje",
        user_type: effectiveRole,
        user_name: localOperator?.name || "Admin",
        details: `Eliminó la orden de viaje ID ${id}`
      }).catch(()=>{});
      queryClient.invalidateQueries({ queryKey: ["orders", "drivers"] });
    }
  });

  const handleDelete = (order) => {
    if (confirm("¿Estás seguro de que querés eliminar este viaje? Esta acción no se puede deshacer.")) {
      deleteMutation.mutate(order.id);
    }
  };

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const filtered = orders.filter(o => {
    const matchSearch =
      !search ||
      o.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.client_phone?.includes(search) ||
      o.pickup_address?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6 pb-6">
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Órdenes de Viaje</h1>
          <p className="text-muted-foreground mt-1">{orders.length} viajes en total</p>
        </div>
        <Link to="/orders/new">
          <Button className="rounded-xl gap-2">
            <Plus className="w-4 h-4" />
            Nuevo Viaje
          </Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 rounded-xl"
            placeholder="Buscar por cliente, teléfono o dirección..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="h-10">
            <TabsTrigger value="all" className="text-xs">Todos</TabsTrigger>
            <TabsTrigger value="pendiente" className="text-xs">Pendientes</TabsTrigger>
            <TabsTrigger value="en_viaje" className="text-xs">En Viaje</TabsTrigger>
            <TabsTrigger value="completado" className="text-xs">Completados</TabsTrigger>
            <TabsTrigger value="cancelado" className="text-xs">Cancelados</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No se encontraron viajes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(order => (
            <OrderCard 
              key={order.id} 
              order={order} 
              onClick={() => navigate(`/orders/${order.id}`)} 
              isAdmin={isAdmin}
              onDelete={() => handleDelete(order)}
            />
          ))}
        </div>
        )}
      </div>
    </PullToRefresh>
  );
}