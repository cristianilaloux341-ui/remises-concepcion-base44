import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
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
import { base44 } from "@/api/base44Client";

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
  const navigate = useNavigate();
  useOperatorPushSubscription(user);

  // Accesos directos de teclado
  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'F2':
          e.preventDefault();
          navigate('/agenda?new=true');
          break;
        case 'F3':
          e.preventDefault();
          navigate('/agenda');
          break;
        case 'F5':
          e.preventDefault();
          navigate('/orders');
          break;
        case 'F7':
          e.preventDefault();
          navigate('/'); // Dashboard (viajes en curso)
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  // Monitoreo de actividad del operador
  useEffect(() => {
    const updatePresence = () => {
      try {
        const op = JSON.parse(localStorage.getItem("local_operator"));
        if (op && op.id) {
          base44.entities.Operator.update(op.id, { last_active: new Date().toISOString() }).catch(()=>{});
        }
      } catch (e) {}
    };
    updatePresence(); // initial ping
    const interval = setInterval(updatePresence, 60000); // 1 minuto
    return () => clearInterval(interval);
  }, []);

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