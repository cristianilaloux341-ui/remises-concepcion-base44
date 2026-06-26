import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Car, CalendarClock, MessageSquare, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Central", path: "/", icon: LayoutDashboard, exact: true },
  { label: "Órdenes", path: "/orders", icon: Car },
  { label: "Agenda", path: "/agenda", icon: CalendarClock },
  { label: "Mensajes", path: "/messages", icon: MessageSquare },
  { label: "Perfil", path: "/profile", icon: UserCircle },
];

export default function BottomTabBar() {
  const location = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-sidebar border-t border-sidebar-border flex lg:hidden select-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        const isActive = tab.exact ? location.pathname === tab.path : location.pathname.startsWith(tab.path);
        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors",
              isActive
                ? "text-sidebar-primary"
                : "text-sidebar-foreground/50"
            )}
          >
            <tab.icon className="w-5 h-5" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}