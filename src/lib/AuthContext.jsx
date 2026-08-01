import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const hasLocalOperator = sessionStorage.getItem('local_operator') !== null;
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(hasLocalOperator);
  const [isLoadingAuth, setIsLoadingAuth] = useState(!hasLocalOperator);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(!hasLocalOperator);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    try {
      if (!hasLocalOperator) setIsLoadingPublicSettings(true);
      setAuthError(null);
      
      // First, check app public settings (with token if available)
      // This will tell us if auth is required, user not registered, etc.
      const appClient = createAxiosClient({
        baseURL: `/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token, // Include token if available
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        // If we got the app public settings successfully, check if user is authenticated
        await checkUserAuth();
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        // Handle app-level errors
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
              setAuthError({
                type: reason,
                message: appError.message
              });
            }
          } else if (appError.status === 401 || appError.status === 403) {
            // Public app with no token — not an error, just unauthenticated
            setAuthError({ type: 'auth_required', message: 'Authentication required' });
          } else {
            setAuthError({
              type: 'unknown',
              message: appError.message || 'Failed to load app'
            });
          }
          setIsLoadingPublicSettings(false);
          setIsLoadingAuth(false);
          setAuthChecked(true);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      if (!hasLocalOperator) setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (error) {
      // 401/403 on a public app just means "not logged in" — not an error
      setIsAuthenticated(false);
      if (error.status !== 401 && error.status !== 403) {
        console.error('User auth check failed:', error);
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    sessionStorage.removeItem("local_operator");
    sessionStorage.removeItem("local_operator_token");
    
    // Evitar llamar a base44.auth.logout que redirige al login de plataforma.
    // Solo redirigimos localmente.
    if (shouldRedirect) {
      window.location.href = "/login";
    }
  };

  const navigateToLogin = () => {
    // Forzar siempre redirección local
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};