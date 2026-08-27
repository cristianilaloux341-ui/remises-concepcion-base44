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
import ClientLogin from '@/pages/client-app/ClientLogin';
import ClientRegister from '@/pages/client-app/ClientRegister';
import ClientHome from '@/pages/client-app/Home';
import ClientRequest from '@/pages/client-app/RequestRide';
import ClientFare from '@/pages/client-app/FareEstimate';
import ClientSearching from '@/pages/client-app/Searching';
import ClientAssigned from '@/pages/client-app/DriverAssigned';
import ClientActiveRide from '@/pages/client-app/ActiveRide';
import ClientRating from '@/pages/client-app/Rating';
import ClientProfile from '@/pages/client-app/Profile';
import ClientPushRegistration from '@/pages/client-app/ClientPushRegistration';
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
import PilotObservability from '@/pages/PilotObservability';
import SimulacionDiaReal from '@/pages/SimulacionDiaReal';
import Profile from '@/pages/Profile';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import LoginCentral from '@/pages/LoginCentral';
import AdminUsuarios from '@/pages/AdminUsuarios';
import { getEffectiveRole } from '@/lib/permissions';
import { useState, useEffect } from 'react';

class DriverAppErrorBoundary extends Component { constructor(props){super(props);this.state={hasError:false,error:null};} static getDerivedStateFromError(error){return{hasError:true,error};} render(){if(this.state.hasError)return <div className="h-screen bg-gray-950 flex items-center justify-center p-6"><div className="text-center space-y-4"><p className="text-red-400 font-bold">Error al cargar la app</p><p className="text-gray-500 text-xs">{this.state.error?.message}</p><button className="bg-blue-600 text-white px-6 py-2 rounded-xl text-sm font-bold" onClick={()=>window.location.reload()}>Reintentar</button></div></div>;return this.props.children;} }
function AdminRoute({children,allowRoles=["admin"]}){const{user}=useAuth();return allowRoles.includes(getEffectiveRole(user))?children:<Navigate to="/" replace/>;}

const AuthenticatedApp=()=>{
 const{isLoadingAuth,isLoadingPublicSettings,authError}=useAuth();const location=useLocation();const[nativeAppId,setNativeAppId]=useState(null);
 useEffect(()=>{if(Capacitor.isNativePlatform())CapApp.getInfo().then(info=>setNativeAppId(info.id)).catch(console.error);},[]);
 const ClientProtectedRoute=({children})=>localStorage.getItem('client_id')?<>{children}</>:<Navigate to="/app-cliente/login" replace/>;
 const clientRoutes=<><Route path="/client/*" element={<Navigate to="/app-cliente/splash" replace/>}/><Route path="/client" element={<Navigate to="/app-cliente/splash" replace/>}/><Route path="/app-cliente" element={<Navigate to="/app-cliente/splash" replace/>}/><Route path="/app-cliente/splash" element={<ClientSplash/>}/><Route path="/app-cliente/login" element={<ClientLogin/>}/><Route path="/app-cliente/register" element={<ClientRegister/>}/><Route path="/app-cliente/home" element={<ClientProtectedRoute><ClientHome/></ClientProtectedRoute>}/><Route path="/app-cliente/request" element={<ClientProtectedRoute><ClientRequest/></ClientProtectedRoute>}/><Route path="/app-cliente/fare" element={<ClientProtectedRoute><ClientFare/></ClientProtectedRoute>}/><Route path="/app-cliente/searching" element={<ClientProtectedRoute><ClientSearching/></ClientProtectedRoute>}/><Route path="/app-cliente/assigned" element={<ClientProtectedRoute><ClientAssigned/></ClientProtectedRoute>}/><Route path="/app-cliente/active-ride" element={<ClientProtectedRoute><ClientActiveRide/></ClientProtectedRoute>}/><Route path="/app-cliente/finished" element={<Navigate to="/app-cliente/rating" replace/>}/><Route path="/app-cliente/rating" element={<ClientProtectedRoute><ClientRating/></ClientProtectedRoute>}/><Route path="/app-cliente/profile" element={<ClientProtectedRoute><ClientProfile/></ClientProtectedRoute>}/></>;
 if(Capacitor.isNativePlatform()){
  if(!nativeAppId)return <div className="fixed inset-0 flex items-center justify-center bg-gray-950"><div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div></div>;
  if(nativeAppId==='com.remisesconcepcion.cliente')return <><ClientPushRegistration/><Routes>{clientRoutes}<Route path="*" element={<Navigate to="/app-cliente/splash" replace/>}/></Routes></>;
  return <Routes><Route path="*" element={<DriverAppErrorBoundary><DriverApp/></DriverAppErrorBoundary>}/></Routes>;
 }
 if(window.location.protocol==='http:'&&window.location.hostname!=='localhost'){window.location.href=window.location.href.replace('http:','https:');}
 const isDriverApp=location.pathname==='/driver-app'||location.pathname.startsWith('/driver-app');const isClientApp=location.pathname==='/app-cliente'||location.pathname.startsWith('/app-cliente/')||location.pathname==='/client'||location.pathname.startsWith('/client/');const isLoginCentral=location.pathname==='/login';const hasLocalOperator=sessionStorage.getItem('local_operator')!==null;
 if(!isDriverApp&&!isClientApp&&!isLoginCentral&&!hasLocalOperator){window.location.href='/login';return null;}
 if(isDriverApp)return <Routes><Route path="/driver-app" element={<DriverAppErrorBoundary><DriverApp/></DriverAppErrorBoundary>}/></Routes>;
 if(isClientApp)return <Routes>{clientRoutes}<Route path="*" element={<Navigate to="/app-cliente/splash" replace/>}/></Routes>;
 if(isLoadingPublicSettings||isLoadingAuth)return <div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div></div>;
 if(authError&&!hasLocalOperator&&authError.type==='user_not_registered'&&!isLoginCentral&&!isDriverApp)return <UserNotRegisteredError/>;
 return <Routes><Route path="/login" element={<LoginCentral/>}/><Route path="/privacy-policy" element={<PrivacyPolicy/>}/><Route path="/driver-app" element={<DriverApp/>}/>{clientRoutes}<Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace/>}/>}><Route element={<AppLayout/>}><Route path="/" element={<Dashboard/>}/><Route path="/orders" element={<Orders/>}/><Route path="/orders/new" element={<NewOrder/>}/><Route path="/orders/:id" element={<OrderDetail/>}/><Route path="/map" element={<MapView/>}/><Route path="/clients" element={<Clients/>}/><Route path="/agenda" element={<Agenda/>}/><Route path="/messages" element={<Messages/>}/><Route path="/drivers" element={<AdminRoute allowRoles={["admin","supervisor"]}><Drivers/></AdminRoute>}/><Route path="/driver-link" element={<AdminRoute><DriverLink/></AdminRoute>}/><Route path="/zone-settings" element={<AdminRoute><ZoneSettings/></AdminRoute>}/><Route path="/tarifas" element={<AdminRoute><Tarifas/></AdminRoute>}/><Route path="/moviles" element={<AdminRoute allowRoles={["admin","supervisor"]}><Moviles/></AdminRoute>}/><Route path="/tiempo-espera" element={<AdminRoute><TiempoEspera/></AdminRoute>}/><Route path="/admin/usuarios" element={<AdminRoute><AdminUsuarios/></AdminRoute>}/><Route path="/backup" element={<AdminRoute><Backup/></AdminRoute>}/><Route path="/audit" element={<AdminRoute><AuditLogs/></AdminRoute>}/><Route path="/active-users" element={<AdminRoute allowRoles={["admin","supervisor"]}><ActiveUsers/></AdminRoute>}/><Route path="/pilot-observability" element={<AdminRoute><PilotObservability/></AdminRoute>}/><Route path="/simulacion-dia" element={<AdminRoute><SimulacionDiaReal/></AdminRoute>}/><Route path="/profile" element={<Profile/>}/></Route></Route><Route path="*" element={<PageNotFound/>}/></Routes>;
};
function App(){return <AuthProvider><QueryClientProvider client={queryClientInstance}><Router><AuthenticatedApp/></Router><Toaster/></QueryClientProvider></AuthProvider>}
export default App
