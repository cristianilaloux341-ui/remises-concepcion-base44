import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, MapPin, Car, Users, Plus, X, Smartphone, CalendarClock, UserCheck, MessageSquare, Map, DollarSign, UserCircle, RefreshCw, Timer, UserCog, HardDriveDownload, Settings, Eye, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import SwitchUserModal from "./SwitchUserModal";
import { ROLE_LABELS } from "@/lib/permissions";

// Items visibles por rol
const NAV_BY_ROLE = {
  admin: [
    { label: "Central",       path: "/",              icon: LayoutDashboard },
    { label: "Órdenes",       path: "/orders",        icon: Car },
    { label: "Agenda",        path: "/agenda",        icon: CalendarClock },
    { label: "Clientes",      path: "/clients",       icon: UserCheck },
    { label: "Mensajes",      path: "/messages",      icon: MessageSquare },
    { label: "Mapa",          path: "/map",           icon: MapPin },
    // Administración
    { label: "Usuarios",      path: "/usuarios",      icon: UserCog,       section: "Administración" },
    { label: "Chóferes",      path: "/drivers",       icon: Users },
    { label: "Móviles",       path: "/moviles",       icon: Car },
    { label: "Tiempo Espera", path: "/tiempo-espera", icon: Timer },
    { label: "App Chófer",    path: "/driver-link",   icon: Smartphone },
    { label: "Zonas",         path: "/zone-settings", icon: Map },
    { label: "Tarifas",       path: "/tarifas",       icon: DollarSign },
    { label: "Backup",        path: "/backup",        icon: HardDriveDownload },
  ],
  supervisor: [
    { label: "Central",   path: "/",        icon: LayoutDashboard },
    { label: "Órdenes",   path: "/orders",  icon: Car },
    { label: "Agenda",    path: "/agenda",  icon: CalendarClock },
    { label: "Clientes",  path: "/clients", icon: UserCheck },
    { label: "Mensajes",  path: "/messages",icon: MessageSquare },
    { label: "Mapa",      path: "/map",     icon: MapPin },
    { label: "Chóferes",  path: "/drivers", icon: Users,    section: "Supervisión" },
    { label: "Móviles",   path: "/moviles", icon: Car },
  ],
  operador: [
    { label: "Central",  path: "/",         icon: LayoutDashboard },
    { label: "Órdenes",  path: "/orders",   icon: Car },
    { label: "Agenda",   path: "/agenda",   icon: CalendarClock },
    { label: "Clientes", path: "/clients",  icon: UserCheck },
    { label: "Mensajes", path: "/messages", icon: MessageSquare },
    { label: "Mapa",     path: "/map",      icon: MapPin },
  ],
  caja: [
    { label: "Central",  path: "/",        icon: LayoutDashboard },
    { label: "Clientes", path: "/clients", icon: UserCheck },
    { label: "Agenda",   path: "/agenda",  icon: CalendarClock },
  ],
};

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const { user } = useAuth();
  const [localOperator, setLocalOperator] = useState(() => {
    try { return JSON.parse(localStorage.getItem("local_operator") || "null"); } catch { return null; }
  });
  const [switchOpen, setSwitchOpen] = useState(false);

  const displayUser = localOperator || user;
  const effectiveRole = localOperator?.role || user?.role || "operador";
  const navItems = NAV_BY_ROLE[effectiveRole] || NAV_BY_ROLE["operador"];

  // Separar items en secciones
  const mainItems = navItems.filter(i => !i.section);
  const sectionItems = navItems.filter(i => i.section);
  const sectionLabel = sectionItems.length > 0 ? sectionItems[0].section : null;

  const canCreateOrder = ["admin", "supervisor", "operador"].includes(effectiveRole);

  const handleSwitchSuccess = (op) => {
    setLocalOperator(op);
    localStorage.setItem("local_operator", JSON.stringify(op));
    setSwitchOpen(false);
    onClose();
    window.location.href = "/";
  };

  const NavLink = ({ item }) => {
    const isActive = location.pathname === item.path;
    return (
      <Link
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
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Header de usuario */}
        <div className="p-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-sidebar-primary flex items-center justify-center shrink-0">
              <UserCircle className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-sidebar-foreground truncate">
                {displayUser?.name || displayUser?.full_name || displayUser?.email || "Usuario"}
              </p>
              <p className="text-xs text-sidebar-foreground/50">
                {ROLE_LABELS[effectiveRole] || effectiveRole}
              </p>
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

        {/* Navegación */}
        <nav className="flex-1 px-3 overflow-y-auto">
          <div className="space-y-1 pb-2">
            {mainItems.map(item => <NavLink key={item.path} item={item} />)}
          </div>

          {sectionItems.length > 0 && (
            <>
              <div className="border-t border-sidebar-border my-2" />
              <p className="px-4 py-1 text-xs font-semibold text-sidebar-foreground/40 uppercase tracking-wider">
                {sectionLabel}
              </p>
              <div className="space-y-1 pb-2">
                {sectionItems.map(item => <NavLink key={item.path} item={item} />)}
              </div>
            </>
          )}
        </nav>

        <div className="p-4 space-y-2">
          {canCreateOrder && (
            <Link to="/orders/new" onClick={onClose}>
              <Button className="w-full gap-2 rounded-xl h-11 bg-sidebar-primary hover:bg-sidebar-primary/90">
                <Plus className="w-4 h-4" />
                Nuevo Pedido
              </Button>
            </Link>
          )}
          <Link to="/profile" onClick={onClose}>
            <Button variant="ghost" className="w-full gap-2 rounded-xl h-9 text-sidebar-foreground/60 hover:text-sidebar-foreground justify-start">
              <Settings className="w-4 h-4" />
              Perfil y Ajustes
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