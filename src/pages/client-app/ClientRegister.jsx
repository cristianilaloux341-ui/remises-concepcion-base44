import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function ClientRegister() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.phone) {
      setPhone(location.state.phone);
    }
  }, [location.state]);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error('Por favor completá todos los campos');
      return;
    }
    
    setLoading(true);
    try {
      // Verificar de nuevo por si acaso
      const existing = await base44.entities.Client.filter({ phone: phone.trim() });
      if (existing && existing.length > 0) {
        localStorage.setItem('client_id', existing[0].id);
        localStorage.setItem('client_name', existing[0].name);
        localStorage.setItem('client_phone', existing[0].phone);
        toast.success('¡Bienvenido!');
        navigate('/app-cliente/home');
        return;
      }

      // Crear nuevo cliente
      const newClient = await base44.entities.Client.create({
        name: name.trim(),
        phone: phone.trim(),
      });

      localStorage.setItem('client_id', newClient.id);
      localStorage.setItem('client_name', newClient.name);
      localStorage.setItem('client_phone', newClient.phone);
      
      toast.success('¡Cuenta creada con éxito!');
      navigate('/app-cliente/home');
    } catch (error) {
      console.error(error);
      toast.error('Ocurrió un error al registrar la cuenta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] bg-slate-950 text-white flex flex-col p-6" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto w-full">
        <div className="text-center space-y-2 mb-10">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-2xl mb-4">
            <span className="text-3xl font-black text-slate-950 tracking-tighter">EV</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight">Crear cuenta</h1>
          <p className="text-slate-400 text-sm">Completá tus datos para empezar a viajar</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-slate-300">Nombre completo</Label>
            <Input 
              id="name" 
              type="text" 
              placeholder="Ej: Juan Pérez" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-slate-900 border-slate-800 text-white h-14 text-lg focus-visible:ring-blue-600"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone" className="text-slate-300">Número de celular</Label>
            <Input 
              id="phone" 
              type="tel" 
              placeholder="Ej: 3442 123456" 
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-slate-900 border-slate-800 text-white h-14 text-lg focus-visible:ring-blue-600"
            />
          </div>
          <Button 
            type="submit" 
            className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
            disabled={loading}
          >
            {loading ? 'Creando cuenta...' : 'Registrarme'}
          </Button>
          
          <div className="text-center">
             <button type="button" onClick={() => navigate('/app-cliente/login')} className="text-blue-400 text-sm font-semibold hover:underline">
               Ya tengo una cuenta
             </button>
          </div>
        </form>
      </div>
    </div>
  );
}