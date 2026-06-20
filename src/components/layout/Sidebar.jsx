import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, MapPin, Car, Users, Plus, X, Smartphone, CalendarClock, UserCheck, MessageSquare, Map, DollarSign, UserCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import SwitchUserModal from "./SwitchUserModal";

const operadorItems = [
  { label: "Central", path: "/", icon: LayoutDashboard },
  { label: "Órdenes", path: "/orders", icon: Car },
  { label: "Agenda", path: "/agenda", icon: CalendarClock },
  { label: "Clientes", path: "/clients", icon: UserCheck },
  { label: "Mensajes", path: "/messages", icon: MessageSquare },
  { label: "Mapa", path: "/map", icon: MapPin },
];

const adminItems = [
  { label: "Chóferes", path: "/drivers", icon: Users },
  { label: "App Chófer", path: "/driver-link", icon: Smartphone },
  { label: "Zonas", path: "/zone-settings", icon: Map },
  { label: "Tarifas", path: "/tarifas", icon: DollarSign },
];

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const { user, checkUserAuth } = useAuth();
  const isAdmin = user?.role === "admin";
  const navItems = isAdmin ? [...operadorItems, ...adminItems] : operadorItems;
  const [switchOpen, setSwitchOpen] = useState(false);

  const handleSwitchSuccess = async (newUser) => {
    setSwitchOpen(false);
    await checkUserAuth();
    onClose();
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sidebar-primary flex items-center justify-center shrink-0">
              <UserCircle className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-sidebar-foreground truncate">{user?.full_name || user?.email || "Usuario"}</p>
              <p className="text-xs text-sidebar-foreground/50 capitalize">{user?.role === "admin" ? "Directivo" : "Operador"}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/50 hover:text-sidebar-foreground w-8 h-8"
              onClick={() => setSwitchOpen(true)}
              title="Cambiar usuario"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="lg:hidden text-sidebar-foreground w-8 h-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/25"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
                {item.path === "/driver-link" && (
                  <span className="ml-auto text-xs bg-sidebar-primary/30 text-sidebar-primary-foreground px-2 py-0.5 rounded-full">
                    Móvil
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4">
          <Link to="/orders/new" onClick={onClose}>
            <Button className="w-full gap-2 rounded-xl h-11 bg-sidebar-primary hover:bg-sidebar-primary/90">
              <Plus className="w-4 h-4" />
              Nuevo Pedido
            </Button>
          </Link>
        </div>

      <SwitchUserModal
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        onSuccess={handleSwitchSuccess}
      />
      </aside>
    </>
  );
}