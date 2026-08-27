import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { base44 } from '@/api/base44Client';

export default function ClientPushRegistration() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let registrationListener;
    let registrationErrorListener;
    let cancelled = false;

    const saveToken = async (token) => {
      const clientId = localStorage.getItem('client_id');
      const sessionToken = localStorage.getItem('client_session_token');
      if (!clientId || !sessionToken || !token) return;
      try {
        await base44.functions.invoke('registerClientFcm', { clientId, sessionToken, token });
        localStorage.setItem('client_fcm_token', token);
      } catch (e) {
        console.error('No se pudo registrar FCM Cliente', e);
      }
    };

    const setup = async () => {
      try {
        registrationListener = await PushNotifications.addListener('registration', ({ value }) => {
          if (!cancelled) saveToken(value);
        });
        registrationErrorListener = await PushNotifications.addListener('registrationError', (error) => {
          console.error('FCM Cliente registrationError', error);
        });
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive === 'prompt') permission = await PushNotifications.requestPermissions();
        if (permission.receive === 'granted') await PushNotifications.register();
      } catch (e) {
        console.error('No se pudo inicializar Push Cliente', e);
      }
    };

    setup();
    return () => {
      cancelled = true;
      registrationListener?.remove?.();
      registrationErrorListener?.remove?.();
    };
  }, []);

  return null;
}
