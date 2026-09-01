import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Search, Star, Clock } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import RideMap from '@/components/map/RideMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function Home() {
  const navigate = useNavigate();
  const [showSetup, setShowSetup] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const clientId = localStorage.getItem('client_id');
  const [favHome, setFavHome] = useState(localStorage.getItem('fav_home') || '');
  const [favWork, setFavWork] = useState(localStorage.getItem('fav_work') || '');

  useEffect(() => {
    let cancelled = false;
    const resumeActiveRide = async () => {
      const activeOrderId = localStorage.getItem('client_active_order_id');
      if (!activeOrderId) return;
      try {
        const order = await base44.entities.RideOrder.get(activeOrderId);
        if (cancelled) return;
        if (!order || (clientId && String(order.client_id || '') !== String(clientId))) {
          localStorage.removeItem('client_active_order_id');
          return;
        }
        if (order.status === 'procesando_despacho' || order.status === 'pendiente' || order.status === 'ofrecido') {
          navigate('/app-cliente/searching', { state: { orderId: activeOrderId }, replace: true });
          return;
        }
        if (order.status === 'aceptado' || order.status === 'en_camino') {
          navigate('/app-cliente/assigned', { state: { orderId: activeOrderId }, replace: true });
          return;
        }
        if (order.status === 'en_viaje') {
          navigate('/app-cliente/active-ride', { state: { orderId: activeOrderId }, replace: true });
          return;
        }
        localStorage.removeItem('client_active_order_id');
      } catch (error) {
        console.error('No se pudo recuperar el viaje activo', error);
      }
    };
    resumeActiveRide();
    return () => { cancelled = true; };
  }, [clientId, navigate]);

  useEffect(() => {
    const handleFavUpdate = () => {
      setFavHome(localStorage.getItem('fav_home') || '');
      setFavWork(localStorage.getItem('fav_work') || '');
    };
    window.addEventListener('fav_addresses_updated', handleFavUpdate);
    return () => window.removeEventListener('fav_addresses_updated', handleFavUpdate);
  }, []);

  useEffect(() => {
    if (clientId) {
      base44.entities.Client.get(clientId).then(client => {
        if (client.name === client.phone || !client.name) {
          setShowSetup(true);
        } else {
          localStorage.setItem('client_name', client.name);
        }
      }).catch(console.error);
    }
  }, [clientId]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Por favor, ingresá tu nombre'); return; }
    setSaving(true);
    try {
      await base44.entities.Client.update(clientId, { name: name.trim() });
      localStorage.setItem('client_name', name.trim());
      setShowSetup(false);
      toast.success('¡Perfil completado!');
    } catch (error) {
      console.error(error);
      toast.error('Ocurrió un error al guardar');
    } finally { setSaving(false); }
  };

  return (
    <div className="h-[100dvh] flex flex-col relative bg-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="absolute inset-0 z-0"><RideMap className="border-none rounded-none w-full h-full" autoFit={false} zoom={14} /></div>
      {showSetup && (
        <div className="absolute inset-0 z-50 bg-slate-50 flex flex-col p-6 animate-in fade-in duration-300">
          <div className="absolute top-0 inset-x-0 h-48 bg-blue-600 rounded-b-[3rem] shadow-lg"></div>
          <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full relative z-10"><div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100">
            <div className="text-center space-y-2 mb-8"><h1 className="text-2xl font-black tracking-tight text-slate-800">¿Cómo te llamás?</h1><p className="text-slate-500 text-sm">Completá tu nombre para que el chofer pueda identificarte.</p></div>
            <form onSubmit={handleSaveProfile} className="space-y-6"><div className="space-y-2"><Label htmlFor="name" className="text-slate-700 font-bold">Nombre completo</Label><Input id="name" type="text" placeholder="Ej: Juan Pérez" value={name} onChange={(e)=>setName(e.target.value)} className="bg-slate-50 border-slate-200 text-slate-900 h-14 text-lg focus-visible:ring-blue-600 focus-visible:border-blue-600" autoFocus /></div><Button type="submit" className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl shadow-md shadow-green-600/20" disabled={saving || !name.trim()}>{saving ? 'Guardando...' : 'Comenzar a viajar'}</Button></form>
          </div></div>
        </div>
      )}
      <div className="absolute top-0 inset-x-0 p-5 z-10 flex justify-between items-center bg-gradient-to-b from-white/90 to-transparent pt-14">
        <button onClick={() => navigate('/app-cliente/profile')} className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-transform border border-slate-100"><Menu className="w-6 h-6 text-blue-600" /></button>
        <div className="bg-white pl-2 pr-4 py-2 rounded-full shadow-lg flex items-center gap-2 border border-slate-100"><img src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" alt="RC" className="w-8 h-8 rounded-full object-cover" /><span className="font-black text-slate-900 tracking-tight text-sm">Remises Concepción</span></div>
      </div>
      <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[2.5rem] shadow-[0_-20px_40px_rgba(0,0,0,0.08)] p-6 z-10 flex flex-col gap-6 animate-in slide-in-from-bottom-full duration-500">
        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto -mt-2"></div><h2 className="text-2xl font-bold text-slate-900 mt-2">¿A dónde vamos?</h2>
        <button onClick={() => navigate('/app-cliente/request')} className="w-full bg-slate-50 p-5 rounded-2xl flex items-center gap-4 text-left active:bg-slate-100 transition-colors border border-slate-100 shadow-sm"><Search className="w-6 h-6 text-slate-500" /><span className="text-lg text-slate-500 font-medium">Buscar destino...</span></button>
        <div className="flex gap-4 overflow-x-auto pb-4 pt-2 hide-scrollbar -mx-6 px-6">
          <div className="shrink-0 bg-white border border-slate-100 shadow-sm p-4 rounded-3xl flex items-center gap-4 w-56 active:scale-95 transition-transform cursor-pointer" onClick={() => { if (favHome) navigate('/app-cliente/fare', { state: { pickup: 'Mi ubicación', dropoff: favHome } }); else { toast.info('Configurá tu dirección de Casa en Perfil'); navigate('/app-cliente/profile'); } }}><div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center shrink-0"><Star className="w-6 h-6 text-blue-600" /></div><div className="min-w-0"><p className="font-bold text-slate-800">Casa</p><p className="text-sm text-slate-500 truncate">{favHome || 'Tocar para agregar'}</p></div></div>
          <div className="shrink-0 bg-white border border-slate-100 shadow-sm p-4 rounded-3xl flex items-center gap-4 w-56 active:scale-95 transition-transform cursor-pointer" onClick={() => { if (favWork) navigate('/app-cliente/fare', { state: { pickup: 'Mi ubicación', dropoff: favWork } }); else { toast.info('Configurá tu dirección de Trabajo en Perfil'); navigate('/app-cliente/profile'); } }}><div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center shrink-0"><Clock className="w-6 h-6 text-slate-600" /></div><div className="min-w-0"><p className="font-bold text-slate-800">Trabajo</p><p className="text-sm text-slate-500 truncate">{favWork || 'Tocar para agregar'}</p></div></div>
        </div>
      </div>
    </div>
  );
}
