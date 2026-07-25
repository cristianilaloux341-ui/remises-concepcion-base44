import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, History, MapPin, User, Settings, HelpCircle, CreditCard, Home, Briefcase } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Profile() {
  const navigate = useNavigate();

  const clientName = localStorage.getItem('client_name') || 'Cliente';

  const [homeAddress, setHomeAddress] = useState(localStorage.getItem('fav_home') || '');
  const [workAddress, setWorkAddress] = useState(localStorage.getItem('fav_work') || '');
  const [openFav, setOpenFav] = useState(false);

  const saveFavorites = () => {
    localStorage.setItem('fav_home', homeAddress);
    localStorage.setItem('fav_work', workAddress);
    setOpenFav(false);
    toast.success("Direcciones guardadas");
    // Trigger custom event so Home can listen to changes if it's in background, or it will just read on mount
    window.dispatchEvent(new Event('fav_addresses_updated'));
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col pb-10">
      <div className="bg-blue-600 text-white p-6 pt-16 pb-10 rounded-b-[3rem] shadow-xl relative">
        <button onClick={() => navigate(-1)} className="absolute top-12 left-4 p-2 rounded-full bg-white/20 hover:bg-white/30">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-5 mt-6">
          <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center border-4 border-white/20 text-3xl shadow-inner">
            👤
          </div>
          <div>
            <h1 className="text-2xl font-black">{clientName}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-red-500 text-white px-2 py-0.5 rounded text-xs font-bold tracking-wider shadow-sm">NUEVO MIEMBRO</span>
              <span className="text-blue-100 text-sm font-medium">★ 5.0</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-6 relative z-10 space-y-4">
        {/* Menu Grid */}
        <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-100">
          
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center"><History className="w-5 h-5 text-blue-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Historial de Viajes</div>
          </div>
          
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center"><CreditCard className="w-5 h-5 text-indigo-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Métodos de Pago</div>
          </div>

          <Dialog open={openFav} onOpenChange={setOpenFav}>
            <DialogTrigger asChild>
              <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
                <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center"><MapPin className="w-5 h-5 text-emerald-600" /></div>
                <div className="flex-1 font-bold text-slate-800">Direcciones Favoritas</div>
              </div>
            </DialogTrigger>
            <DialogContent className="w-11/12 rounded-3xl mx-auto p-6 bg-white">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-slate-800">Tus lugares</DialogTitle>
              </DialogHeader>
              <div className="space-y-5 mt-2">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><Home className="w-4 h-4"/> Casa</label>
                  <Input 
                    value={homeAddress} 
                    onChange={e => setHomeAddress(e.target.value)} 
                    placeholder="Ej: 9 de Julio 1250" 
                    className="h-12 bg-slate-50 border-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><Briefcase className="w-4 h-4"/> Trabajo</label>
                  <Input 
                    value={workAddress} 
                    onChange={e => setWorkAddress(e.target.value)} 
                    placeholder="Ej: Leguizamón 350" 
                    className="h-12 bg-slate-50 border-slate-200"
                  />
                </div>
                <Button className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg shadow-md" onClick={saveFavorites}>
                  Guardar Direcciones
                </Button>
              </div>
            </DialogContent>
          </Dialog>

        </div>

        <div className="bg-white rounded-3xl p-2 shadow-sm border border-slate-100">
          <div className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer">
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center"><Settings className="w-5 h-5 text-slate-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Configuración</div>
          </div>
          <div 
            className="flex items-center gap-4 p-4 active:bg-slate-50 rounded-2xl cursor-pointer"
            onClick={() => window.open('https://wa.me/5493442123456?text=Hola,%20necesito%20ayuda%20con%20la%20app%20de%20remises', '_blank')}
          >
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center"><HelpCircle className="w-5 h-5 text-slate-600" /></div>
            <div className="flex-1 font-bold text-slate-800">Ayuda y Soporte (WhatsApp)</div>
          </div>
        </div>

        <button className="w-full p-4 text-center font-bold text-red-500 bg-white rounded-2xl shadow-sm border border-slate-100 mt-6 active:scale-95 transition-transform">
          Cerrar Sesión
        </button>

      </div>
    </div>
  );
}