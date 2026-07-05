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
      if (['F2', 'F3', 'F5', 'F7'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        
        switch (e.key) {
          case 'F2':
            navigate('/agenda?new=true');
            break;
          case 'F3':
            navigate('/agenda');
            break;
          case 'F5':
            navigate('/orders');
            break;
          case 'F7':
            navigate('/'); // Dashboard (viajes en curso)
            break;
          default:
            break;
        }
      }
    };
    // Usamos document y { capture: true } para atajar el evento ANTES que cualquier otro componente o el propio navegador
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [navigate]);

  // Monitoreo de actividad del operador
  useEffect(() => {
    const updatePresence = () => {
      try {
        const op = JSON.parse(localStorage.getItem("local_operator"));
        if (op && op.id) {
          // Usamos una API function call o ignoramos si no tenemos auth.
          // El presence lo actualizamos directamente si tenemos base44 funcionando.
          // Como ahora usan UsuariosSistema, vamos a llamar a una simple func o directo si se permite.
          // Pero UsuariosSistema tiene RLS update: { role: impossible }. 
          // Entonces debemos actualizarlo desde authSystem u otro backend function.
          base44.functions.invoke('authSystem', {
            action: 'manage_users',
            payload: { sub_action: 'update_presence', admin_id: op.id }
          }).catch(()=>{});
        }
      } catch (e) {}
    };
    updatePresence(); // initial ping
    const interval = setInterval(updatePresence, 60000); // 1 minuto
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="fixed top-4 right-4 left-4 md:left-auto z-[9999] flex flex-col gap-3 pointer-events-none md:w-[380px] items-end" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <PanicAlertBanner />
        <CancellationAlert />
        <AgendaAlert />
        <DriverMessageAlert />
      </div>
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