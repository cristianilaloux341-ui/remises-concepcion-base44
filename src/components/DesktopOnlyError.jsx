import React from 'react';
import { MonitorX } from 'lucide-react';

export default function DesktopOnlyError() {
  return (
    <div className="h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
      <MonitorX className="w-20 h-20 text-red-500 mb-6" />
      <h1 className="text-3xl font-bold text-white mb-4">Acceso Restringido</h1>
      <p className="text-slate-400 max-w-md text-lg">
        Por estrictos motivos de seguridad, el panel de control de la central solo puede ser operado desde el software de escritorio oficial instalado en la base.
      </p>
      <p className="text-slate-500 mt-8 text-sm">
        El acceso a través de navegadores web comunes (Chrome, Firefox, Safari) está deshabilitado en producción.
      </p>
    </div>
  );
}