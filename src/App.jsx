import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';

window.addEventListener('keydown', (e) => {
  if (e.key === 'F4') {
    e.preventDefault();
    window.location.reload();
  }
});

import PrivacyPolicy from '@/pages/PrivacyPolicy';

import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Orders from '@/pages/Orders';
import NewOrder from '@/pages/NewOrder';
import OrderDetail from '@/pages/OrderDetail';
import MapView from '@/pages/MapView';
import Drivers from '@/pages/Drivers';
import DriverLink from '@/pages/DriverLink';
import Clients from '@/pages/Clients';
import Agenda from '@/pages/Agenda';
import Messages from '@/pages/Messages';
import ZoneSettings from '@/pages/ZoneSettings';
import Tarifas from '@/pages/Tarifas';
import Moviles from '@/pages/Moviles';
import TiempoEspera from '@/pages/TiempoEspera';
import Backup from '@/pages/Backup';
import AuditLogs from '@/pages/AuditLogs';
import ActiveUsers from '@/pages/ActiveUsers';
import Profile from '@/pages/Profile';
import DesktopOnlyError from '@/components/DesktopOnlyError';
import LoginCentral from '@/pages/LoginCentral';
import AdminUsuarios from '@/pages/AdminUsuarios';

import { getEffectiveRole } from '@/lib/permissions';

function AdminRoute({ children, allowRoles = ["admin"] }) {
  const { user } = useAuth();
  const effectiveRole = getEffectiveRole(user);
  
  if (!allowRoles.includes(effectiveRole)) return <Navigate to="/" replace />;
  return children;
}

import { useState, useEffect } from 'react';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F4') {
        e.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Forzar HTTPS en producción (Auditoría/Seguridad)
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    window.location.href = window.location.href.replace('http:', 'https:');
  }

  const isLoginCentral = location.pathname === '/login';
  
  const hasLocalOperator = sessionStorage.getItem('local_operator') !== null;

  if (!isLoginCentral && !hasLocalOperator) {
    window.location.href = "/login";
    return null;
  }


  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError && !hasLocalOperator) {
    if (authError.type === 'user_not_registered' && !isLoginCentral) {
      return <UserNotRegisteredError />;
    }
    // Para auth_required y otros errores: dejamos que las rutas manejen la redirección
    // ProtectedRoute enviará al login si corresponde
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginCentral />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/new" element={<NewOrder />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/drivers" element={<AdminRoute allowRoles={["admin","supervisor"]}><Drivers /></AdminRoute>} />
          <Route path="/driver-link" element={<AdminRoute allowRoles={["admin"]}><DriverLink /></AdminRoute>} />
          <Route path="/zone-settings" element={<AdminRoute allowRoles={["admin"]}><ZoneSettings /></AdminRoute>} />
          <Route path="/tarifas" element={<AdminRoute allowRoles={["admin"]}><Tarifas /></AdminRoute>} />
          <Route path="/moviles" element={<AdminRoute allowRoles={["admin","supervisor"]}><Moviles /></AdminRoute>} />
          <Route path="/tiempo-espera" element={<AdminRoute allowRoles={["admin"]}><TiempoEspera /></AdminRoute>} />
          <Route path="/admin/usuarios" element={<AdminRoute allowRoles={["admin"]}><AdminUsuarios /></AdminRoute>} />
          <Route path="/backup" element={<AdminRoute allowRoles={["admin"]}><Backup /></AdminRoute>} />
          <Route path="/audit" element={<AdminRoute allowRoles={["admin"]}><AuditLogs /></AdminRoute>} />
          <Route path="/active-users" element={<AdminRoute allowRoles={["admin", "supervisor"]}><ActiveUsers /></AdminRoute>} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>
      
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  // Cache buster: Forzando actualización de la app pública
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App