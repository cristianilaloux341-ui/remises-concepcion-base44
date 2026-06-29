import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Si el usuario tuvo un service worker corrupto, lo borramos inmediatamente al iniciar React
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}
// Limpiamos los caches estáticos para obligar a que cargue todo fresco
if ('caches' in window) {
  caches.keys().then(keys => {
    keys.forEach(k => caches.delete(k));
  });
}

// Sync dark mode with system preference
const applyTheme = () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', prefersDark);
};
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// Ocultamiento de consola en producción (seguridad)
if (window.location.hostname !== 'localhost') {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.debug = () => {};
  console.trace = () => {};

  // Bloqueo de herramientas de desarrollo (Anti-Inspección)
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
      (e.ctrlKey && (e.key === 'U' || e.key === 'u')) ||
      (e.metaKey && e.altKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'U' || e.key === 'u'))
    ) {
      e.preventDefault();
    }
  });
}

// Detección básica de Root / Emuladores
const isProbableEmulator = () => {
  const isAndroid = /Android/i.test(navigator.userAgent);
  if (!isAndroid) return false;
  // Comprobaciones heurísticas básicas para web view/PWA
  const hasHardwareConcurrency = navigator.hardwareConcurrency > 0;
  const isWebGlRenderValid = () => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return true; // fallback
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return /swiftshader|llvmpipe|mali/i.test(renderer);
    } catch (e) {
      return false;
    }
  };
  return isWebGlRenderValid() && !hasHardwareConcurrency;
};

if (isProbableEmulator()) {
  document.body.innerHTML = "<div style='padding:20px;text-align:center;font-family:sans-serif;'>Dispositivo no soportado (Root/Emulador detectado) por motivos de seguridad.</div>";
  throw new Error("Entorno no seguro detectado");
}

// Registrar el Service Worker para PWA y push notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed silently
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)