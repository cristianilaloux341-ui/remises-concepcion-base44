import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function ClientLogin() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    const cleanPhone = phone.trim();
    if (!cleanPhone) {
      toast.error('Por favor, ingresá tu número de teléfono');
      return;
    }
    
    setLoading(true);
    try {
      // Buscar si el cliente ya existe
      const clients = await base44.entities.Client.filter({ phone: cleanPhone });
      let client;

      if (clients && clients.length > 0) {
        client = clients[0];
        toast.success('¡Bienvenido de nuevo!');
      } else {
        // Si no existe, crearlo automáticamente en la BD
        client = await base44.entities.Client.create({
          name: cleanPhone, // Guardamos el número como nombre inicial para la central
          phone: cleanPhone
        });
        toast.success('¡Ingreso exitoso!');
      }

      // Guardar sesión en local storage
      localStorage.setItem('client_id', client.id);
      localStorage.setItem('client_name', client.name);
      localStorage.setItem('client_phone', client.phone);
      
      navigate('/app-cliente/home');
    } catch (error) {
      console.error(error);
      toast.error('Ocurrió un error al iniciar sesión');
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
          <h1 className="text-3xl font-black tracking-tight">Ingresá a Evoloux</h1>
          <p className="text-slate-400 text-sm">Tu viaje premium está a un paso</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
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
            {loading ? 'Ingresando...' : 'Ingresar'}
          </Button>
        </form>
      </div>
    </div>
  );
}