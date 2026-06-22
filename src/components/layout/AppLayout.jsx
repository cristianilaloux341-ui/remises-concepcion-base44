import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import AgendaAlert from "@/components/agenda/AgendaAlert";
import CancellationAlert from "@/components/alerts/CancellationAlert";
import DriverMessageAlert from "@/components/alerts/DriverMessageAlert";
import PanicAlertBanner from "@/components/alerts/PanicAlertBanner";
import { useAuth } from "@/lib/AuthContext";
import { useOperatorPushSubscription } from "@/hooks/useOperatorPushSubscription";

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  useOperatorPushSubscription(user);

  return (
    <div className="min-h-screen bg-background">
      <AgendaAlert />
      <CancellationAlert />
      <DriverMessageAlert />
      <PanicAlertBanner />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
        </header>
        <main className="p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}