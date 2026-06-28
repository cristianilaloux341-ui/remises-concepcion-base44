import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Car, CalendarClock, MessageSquare, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Central", path: "/", match: "/", icon: LayoutDashboard, exact: true },
  { label: "Órdenes", path: "/orders", match: "/orders", icon: Car },
  { label: "Agenda", path: "/agenda", match: "/agenda", icon: CalendarClock },
  { label: "Mensajes", path: "/messages", match: "/messages", icon: MessageSquare },
  { label: "Perfil", path: "/profile", match: "/profile", icon: UserCircle },
];

export default function BottomTabBar() {
  const location = useLocation();
  const [tabPaths, setTabPaths] = useState(() => {
    try {
      const stored = sessionStorage.getItem("tab_navigation_stack");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Track the current path for the active tab
  useEffect(() => {
    const activeTab = tabs.find(t => 
      t.exact ? location.pathname === t.match : location.pathname.startsWith(t.match)
    );
    
    if (activeTab) {
      setTabPaths(prev => {
        const next = { ...prev, [activeTab.match]: location.pathname + location.search };
        sessionStorage.setItem("tab_navigation_stack", JSON.stringify(next));
        return next;
      });
    }
  }, [location.pathname, location.search]);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-sidebar border-t border-sidebar-border flex lg:hidden select-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((tab) => {
        const isActive = tab.exact ? location.pathname === tab.match : location.pathname.startsWith(tab.match);
        // Navigate to the preserved path if exists, otherwise base path.
        // If clicking the active tab again, go to its base path (like popping to root).
        const targetPath = isActive ? tab.path : (tabPaths[tab.match] || tab.path);

        return (
          <Link
            key={tab.path}
            to={targetPath}
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