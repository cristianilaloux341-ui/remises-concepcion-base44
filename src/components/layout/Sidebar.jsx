import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, MapPin, Car, Users, Plus, X, Smartphone, CalendarClock, UserCheck, MessageSquare, Map, DollarSign, UserCircle, RefreshCw, Timer, UserCog, HardDriveDownload } from "lucide-react";
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
  { label: "Usuarios", path: "/usuarios", icon: UserCog },
  { label: "Chóferes", path: "/drivers", icon: Users },
  { label: "Tiempo Espera", path: "/tiempo-espera", icon: Timer },
  { label: "Móviles", path: "/moviles", icon: Car },
  { label: "App Chófer", path: "/driver-link", icon: Smartphone },
  { label: "Zonas", path: "/zone-settings", icon: Map },
  { label: "Tarifas", path: "/tarifas", icon: DollarSign },
  { label: "Backup", path: "/backup", icon: HardDriveDownload },
];

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const { user, checkUserAuth } = useAuth();
  // Operador local (login por celular+PIN, sobrescribe el nombre mostrado)
  const [localOperator, setLocalOperator] = useState(() => {
    try { return JSON.parse(localStorage.getItem("local_operator") || "null"); } catch { return null; }
  });

  const displayUser = localOperator || user;
  // Si hay un operador local logueado, usar su rol; sino el rol de plataforma
  const effectiveRole = localOperator ? localOperator.role : user?.role;
  const isAdmin = effectiveRole === "admin";
  const navItems = isAdmin ? [...operadorItems, ...adminItems] : operadorItems;
  const [switchOpen, setSwitchOpen] = useState(false);

  const handleSwitchSuccess = (op) => {
    setLocalOperator(op);
    localStorage.setItem("local_operator", JSON.stringify(op));
    setSwitchOpen(false);
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
              <p className="font-semibold text-sm text-sidebar-foreground truncate">{displayUser?.name || displayUser?.full_name || displayUser?.email || "Usuario"}</p>
              <p className="text-xs text-sidebar-foreground/50 capitalize">{localOperator ? (localOperator.role === "admin" ? "Directivo" : "Operador") : (user?.role === "admin" ? "Directivo" : "Operador")}</p>
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

        <nav className="flex-1 px-3 overflow-y-auto">
          <div className="space-y-1 pb-2">
            {operadorItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/25"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {isAdmin && (
            <>
              <div className="border-t border-sidebar-border my-2" />
              <p className="px-4 py-1 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">Administración</p>
              <div className="space-y-1 pb-2">
                {adminItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/25"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </>
          )}
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