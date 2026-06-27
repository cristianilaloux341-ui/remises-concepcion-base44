import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import ManualInstructivo from "@/components/manual/ManualInstructivo";
import Sidebar from "./Sidebar";
import BottomTabBar from "./BottomTabBar";
import AgendaAlert from "@/components/agenda/AgendaAlert";
import CancellationAlert from "@/components/alerts/CancellationAlert";
import DriverMessageAlert from "@/components/alerts/DriverMessageAlert";
import PanicAlertBanner from "@/components/alerts/PanicAlertBanner";
import { useAuth } from "@/lib/AuthContext";
import { useOperatorPushSubscription } from "@/hooks/useOperatorPushSubscription";

const pageVariants = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
};

const pageTransition = { duration: 0.18, ease: "easeInOut" };

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  useOperatorPushSubscription(user);

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <AgendaAlert />
      <CancellationAlert />
      <DriverMessageAlert />
      <PanicAlertBanner />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-64" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        <main className="p-4 md:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={pageTransition}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <BottomTabBar />
      <ManualInstructivo />
    </div>
  );
}