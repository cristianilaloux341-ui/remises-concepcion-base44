import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Check if iOS
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.navigator.standalone;
    setIsIOS(ios && !standalone);

    // Android / Chrome install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Show iOS banner after a moment
    if (ios && !standalone) {
      setTimeout(() => setShow(true), 1500);
    }

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

  if (!show) return null;

  return (
    <>
      <div className="bg-blue-600 text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <Download className="w-5 h-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">Instalá la app en tu celular</p>
          <p className="text-xs text-blue-200 leading-tight">Accedé más rápido sin abrir el navegador</p>
        </div>
        <Button
          size="sm"
          className="bg-white text-blue-600 hover:bg-blue-50 rounded-xl text-xs font-bold shrink-0 h-8 px-3"
          onClick={handleInstall}
        >
          Instalar
        </Button>
        <button onClick={() => setShow(false)} className="text-blue-200 hover:text-white shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* iOS instructions modal */}
      {showIOSInstructions && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end p-4" onClick={() => setShowIOSInstructions(false)}>
          <div className="w-full bg-white rounded-3xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg">Agregar al inicio (iPhone)</h3>
            <ol className="space-y-3 text-sm text-gray-600">
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
                Tocá el botón <strong>Compartir</strong> (el cuadrado con la flechita hacia arriba) en la barra de Safari
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                Deslizá hacia abajo y tocá <strong>"Agregar a pantalla de inicio"</strong>
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">3</span>
                Tocá <strong>"Agregar"</strong> arriba a la derecha
              </li>
            </ol>
            <Button className="w-full rounded-2xl h-12" onClick={() => setShowIOSInstructions(false)}>Entendido</Button>
          </div>
        </div>
      )}
    </>
  );
}