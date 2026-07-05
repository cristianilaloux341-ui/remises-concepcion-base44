import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

function getLocalOperator() {
  try { return JSON.parse(sessionStorage.getItem("local_operator") || "null"); } catch { return null; }
}

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement }) {
  const localOperator = getLocalOperator();
  const isLocallyAuthenticated = !!(localOperator && localOperator.active !== false);

  // Si no hay operador local validado con PIN, no entra nadie (ni siquiera el admin de Base44)
  if (!isLocallyAuthenticated) {
    return unauthenticatedElement;
  }

  return <Outlet />;
}