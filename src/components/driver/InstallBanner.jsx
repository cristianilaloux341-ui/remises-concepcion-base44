import { useState, useEffect } from "react";
import { Download, X, Share } from "lucide-react";

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Si ya está instalada como PWA, no mostrar nada
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (isStandalone) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    if (ios) {
      // En iOS no hay beforeinstallprompt — mostrar banner manual
      const dismissed = localStorage.getItem("install_banner_dismissed");
      if (!dismissed) setTimeout(() => setShow(true), 1200);
      return;
    }

    // Android / Chrome
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setShow(false);
      setDeferredPrompt(null);
    } else if (isIOS) {
      setShowIOSInstructions(true);
    }
  };

  const handleDismiss = () => {
    setShow(false);
    localStorage.setItem("install_banner_dismissed", "1");
  };

  if (!show) return null;

  return (
    <>
      <div className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <Download className="w-5 h-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">Instalá la app en tu celular</p>
          <p className="text-xs text-blue-200 leading-tight">Accedé sin abrir el navegador</p>
        </div>
        <button
          className="shrink-0 bg-white text-blue-600 font-bold text-xs px-3 py-1.5 rounded-xl active:scale-95"
          onClick={handleInstall}
        >
          {isIOS ? "¿Cómo?" : "Instalar"}
        </button>
        <button onClick={handleDismiss} className="text-blue-200 hover:text-white shrink-0 p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Modal de instrucciones iOS */}
      {showIOSInstructions && (
        <div
          className="fixed inset-0 z-[9999] bg-black/70 flex items-end p-4"
          onClick={() => setShowIOSInstructions(false)}
        >
          <div
            className="w-full bg-white rounded-3xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0">
                <Share className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Agregar al inicio (iPhone)</h3>
                <p className="text-xs text-gray-500">3 pasos simples en Safari</p>
              </div>
            </div>
            <ol className="space-y-3 text-sm text-gray-600">
              <li className="flex gap-3 items-start">
                <span className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
                <span>Tocá el botón <strong>Compartir</strong> <span className="inline-block bg-gray-100 px-1.5 py-0.5 rounded text-xs">□↑</span> en la barra inferior de Safari</span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
                <span>Deslizá hacia abajo y tocá <strong>"Agregar a pantalla de inicio"</strong></span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
                <span>Tocá <strong>"Agregar"</strong> en la esquina superior derecha</span>
              </li>
            </ol>
            <button
              className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl text-base"
              onClick={() => setShowIOSInstructions(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}