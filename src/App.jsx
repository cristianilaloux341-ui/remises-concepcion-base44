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
import Profile from '@/pages/Profile';

function AdminRoute({ children }) {
  const { user } = useAuth();
  // Verificar también el operador local (login por celular+PIN)
  const localOperator = (() => {
    try { return JSON.parse(localStorage.getItem("local_operator") || "null"); } catch { return null; }
  })();
  const effectiveRole = localOperator ? localOperator.role : user?.role;
  if (effectiveRole !== "admin") return <Navigate to="/" replace />;
  return children;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Driver app is fully public - render immediately without any auth checks
  if (window.location.pathname === '/driver-app' || window.location.pathname.startsWith('/driver-app')) {
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
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
    // Para cualquier otro error (unknown, timeout, etc.) dejamos que las rutas se rendericen
    // para que el usuario vea la página de login en lugar de una pantalla en blanco
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      
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
          <Route path="/drivers" element={<AdminRoute><Drivers /></AdminRoute>} />
          <Route path="/driver-link" element={<AdminRoute><DriverLink /></AdminRoute>} />
          <Route path="/zone-settings" element={<AdminRoute><ZoneSettings /></AdminRoute>} />
          <Route path="/tarifas" element={<AdminRoute><Tarifas /></AdminRoute>} />
          <Route path="/moviles" element={<AdminRoute><Moviles /></AdminRoute>} />
          <Route path="/tiempo-espera" element={<AdminRoute><TiempoEspera /></AdminRoute>} />
          <Route path="/usuarios" element={<AdminRoute><Usuarios /></AdminRoute>} />
          <Route path="/backup" element={<AdminRoute><Backup /></AdminRoute>} />
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