import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, MapPin, Car, Users, Plus, X, Smartphone, CalendarClock, UserCheck, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Central", path: "/", icon: LayoutDashboard },
  { label: "Órdenes", path: "/orders", icon: Car },
  { label: "Agenda", path: "/agenda", icon: CalendarClock },
  { label: "Clientes", path: "/clients", icon: UserCheck },
  { label: "Mensajes", path: "/messages", icon: MessageSquare },
  { label: "Mapa", path: "/map", icon: MapPin },
  { label: "Chóferes", path: "/drivers", icon: Users },
  { label: "App Chófer", path: "/driver-link", icon: Smartphone },
];

export default function Sidebar({ open, onClose }) {
  const location = useLocation();

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
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sidebar-primary flex items-center justify-center">
              <Car className="w-5 h-5 text-sidebar-primary-foreground" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-sidebar-foreground">Remisería</h1>
              <p className="text-xs text-sidebar-foreground/50">Sistema de despacho</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden text-sidebar-foreground" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
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
      </aside>
    </>
  );
}