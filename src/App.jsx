import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ProtectedRoute from '@/components/ProtectedRoute';

import PrivacyPolicy from '@/pages/PrivacyPolicy';

import AppLayout from '@/components/layout/AppLayout';
import ClientSplash from '@/pages/client-app/Splash';
import ClientHome from '@/pages/client-app/Home';
import ClientRequest from '@/pages/client-app/RequestRide';
import ClientFare from '@/pages/client-app/FareEstimate';
import ClientSearching from '@/pages/client-app/Searching';
import ClientAssigned from '@/pages/client-app/DriverAssigned';
import ClientActiveRide from '@/pages/client-app/ActiveRide';
import ClientRating from '@/pages/client-app/Rating';
import ClientProfile from '@/pages/client-app/Profile';
import Dashboard from '@/pages/Dashboard';
import Orders from '@/pages/Orders';
import NewOrder from '@/pages/NewOrder';
import OrderDetail from '@/pages/OrderDetail';
import MapView from '@/pages/MapView';
import Drivers from '@/pages/Drivers';
import DriverApp from '@/pages/DriverApp';
import { Component } from 'react';
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
import { Capacitor } from '@capacitor/core';
import LoginCentral from '@/pages/LoginCentral';
import AdminUsuarios from '@/pages/AdminUsuarios';

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

import { getEffectiveRole } from '@/lib/permissions';

function AdminRoute({ children, allowRoles = ["admin"] }) {
  const { user } = useAuth();
  const effectiveRole = getEffectiveRole(user);
  
  if (!allowRoles.includes(effectiveRole)) return <Navigate to="/" replace />;
  return children;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const location = useLocation();

  // En Android/iOS nativo: Evitamos todo tipo de redirección, cargando la app directamente.
  // Esto mata de raíz el problema del bucle y el destello blanco.
  if (Capacitor.isNativePlatform()) {
    return (
      <Routes>
        <Route path="*" element={<DriverAppErrorBoundary><DriverApp /></DriverAppErrorBoundary>} />
      </Routes>
    );
  }

  // Forzar HTTPS en producción (Auditoría/Seguridad)
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    window.location.href = window.location.href.replace('http:', 'https:');
  }

  // Seguridad: Validar User-Agent (Contenedor Electron)
  const isDesktopApp = navigator.userAgent.includes('RemisesConcepcion-AdminApp');
  const isDriverApp = location.pathname === '/driver-app' || location.pathname.startsWith('/driver-app');
  const isClientApp = location.pathname === '/client' || location.pathname.startsWith('/client/');
  const isLoginCentral = location.pathname === '/login';
  
  const hasLocalOperator = sessionStorage.getItem('local_operator') !== null;

  // Permitimos a isClientApp pasar directamente sin chequear login interno
  if (!isDriverApp && !isClientApp && !isLoginCentral && !hasLocalOperator) {
    window.location.href = "/login";
    return null;
  }

  // Driver app is fully public - render immediately without any auth checks
  if (isDriverApp) {
    return (
      <Routes>
        <Route path="/driver-app" element={<DriverAppErrorBoundary><DriverApp /></DriverAppErrorBoundary>} />
      </Routes>
    );
  }

  // Client app demo is fully public - render immediately without any auth checks
  if (isClientApp) {
    return (
      <Routes>
        <Route path="/client" element={<Navigate to="/client/splash" replace />} />
        <Route path="/client/splash" element={<ClientSplash />} />
        <Route path="/client/home" element={<ClientHome />} />
        <Route path="/client/request" element={<ClientRequest />} />
        <Route path="/client/fare" element={<ClientFare />} />
        <Route path="/client/searching" element={<ClientSearching />} />
        <Route path="/client/assigned" element={<ClientAssigned />} />
        <Route path="/client/active-ride" element={<ClientActiveRide />} />
        <Route path="/client/finished" element={<Navigate to="/client/rating" replace />} />
        <Route path="/client/rating" element={<ClientRating />} />
        <Route path="/client/profile" element={<ClientProfile />} />
        <Route path="*" element={<Navigate to="/client/splash" replace />} />
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
    if (authError.type === 'user_not_registered' && !isLoginCentral && !isDriverApp) {
      return <UserNotRegisteredError />;
    }
    // Para auth_required y otros errores: dejamos que las rutas manejen la redirección
    // ProtectedRoute enviará al login si corresponde
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginCentral />} />
      <Route path="/privacy-policy" element={<PrivacyPolicy />} />
      
      {/* Driver mobile app - public, no login needed */}
      <Route path="/driver-app" element={<DriverApp />} />

      {/* Client Demo App - Independent Flow */}
      <Route path="/client" element={<Navigate to="/client/splash" replace />} />
      <Route path="/client/splash" element={<ClientSplash />} />
      <Route path="/client/home" element={<ClientHome />} />
      <Route path="/client/request" element={<ClientRequest />} />
      <Route path="/client/fare" element={<ClientFare />} />
      <Route path="/client/searching" element={<ClientSearching />} />
      <Route path="/client/assigned" element={<ClientAssigned />} />
      <Route path="/client/active-ride" element={<ClientActiveRide />} />
      <Route path="/client/finished" element={<Navigate to="/client/rating" replace />} />
      <Route path="/client/rating" element={<ClientRating />} />
      <Route path="/client/profile" element={<ClientProfile />} />

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