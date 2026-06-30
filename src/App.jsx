import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';

import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import PrivacyPolicy from '@/pages/PrivacyPolicy';

import AppLayout from '@/components/layout/AppLayout';
import Dashboard from '@/pages/Dashboard';
import Orders from '@/pages/Orders';
import NewOrder from '@/pages/NewOrder';
import OrderDetail from '@/pages/OrderDetail';
import MapView from '@/pages/MapView';
import Drivers from '@/pages/Drivers';
import DriverApp from '@/pages/DriverApp';
import { Component } from 'react';

class DriverAppErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-gray-950 flex items-center justify-center p-6">
          <div className="text-center space-y-4">
            <p className="text-red-400 font-bold">Error al cargar la app</p>
            <p className="text-gray-500 text-xs">{this.state.error?.message}</p>
            <button className="bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-bold" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import DriverLink from '@/pages/DriverLink';
import Clients from '@/pages/Clients';
import Agenda from '@/pages/Agenda';
import Messages from '@/pages/Messages';
import ZoneSettings from '@/pages/ZoneSettings';
import Tarifas from '@/pages/Tarifas';
import Moviles from '@/pages/Moviles';
import TiempoEspera from '@/pages/TiempoEspera';
import Usuarios from '@/pages/Usuarios';
import Backup from '@/pages/Backup';
import AuditLogs from '@/pages/AuditLogs';
import ActiveUsers from '@/pages/ActiveUsers';
import Profile from '@/pages/Profile';
import DesktopOnlyError from '@/components/DesktopOnlyError';

function AdminRoute({ children, allowRoles = ["admin"] }) {
  const { user } = useAuth();
  const localOperator = (() => {
    try { return JSON.parse(localStorage.getItem("local_operator") || "null"); } catch { return null; }
  })();
  const effectiveRole = localOperator ? localOperator.role : user?.role;
  if (!allowRoles.includes(effectiveRole)) return <Navigate to="/" replace />;
  return children;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Forzar HTTPS en producción (Auditoría/Seguridad)
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    window.location.href = window.location.href.replace('http:', 'https:');
  }

  // Seguridad: Validar User-Agent (Contenedor Electron)
  const isDesktopApp = navigator.userAgent.includes('RemisesConcepcion-AdminApp');
  const isDriverApp = window.location.pathname === '/driver-app' || window.location.pathname.startsWith('/driver-app');
  // Parametro bypass solo para poder seguir editando la web en este editor temporalmente (?dev=1)
  const isDevBypass = true; // Bypass temporal total para asegurar que puedan probar

  if (!isDriverApp && !isDesktopApp && !isDevBypass) {
    return <DesktopOnlyError />;
  }

  // Driver app is fully public - render immediately without any auth checks
  if (isDriverApp) {
    return (
      <Routes>
        <Route path="/driver-app" element={<DriverAppErrorBoundary><DriverApp /></DriverAppErrorBoundary>} />
      </Routes>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    // Para auth_required y otros errores: dejamos que las rutas manejen la redirección
    // ProtectedRoute enviará al login si corresponde
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      
      {/* Driver mobile app - public, no login needed */}
      <Route path="/driver-app" element={<DriverApp />} />

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
          <Route path="/usuarios" element={<AdminRoute allowRoles={["admin"]}><Usuarios /></AdminRoute>} />
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