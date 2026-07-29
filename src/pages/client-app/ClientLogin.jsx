import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function ClientLogin() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Función simple para un hash no criptográfico local (como demostración para la PWA de clientes).
  // Idealmente se debería hacer en un backend de Base44.
  const hashPassword = async (pass) => {
    const msgUint8 = new TextEncoder().encode(pass + "CLIENT_SALT_44");
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const cleanPhone = phone.trim();
    if (!cleanPhone) {
      toast.error('Por favor, ingresá tu número de teléfono');
      return;
    }
    if (!password) {
      toast.error('Por favor, ingresá una contraseña segura');
      return;
    }
    
    setLoading(true);
    try {
      // Buscar si el cliente ya existe
      const clients = await base44.entities.Client.filter({ phone: cleanPhone });
      let client;

      const inputHash = await hashPassword(password);

      if (clients && clients.length > 0) {
        client = clients[0];
        // Validar contraseña
        if (client.password_hash && client.password_hash !== inputHash) {
           toast.error('Contraseña incorrecta.');
           setLoading(false);
           return;
        } else if (!client.password_hash) {
           // Cliente viejo sin password, lo "migramos" fijando el password actual
           await base44.entities.Client.update(client.id, { password_hash: inputHash });
        }
        toast.success('¡Bienvenido de nuevo!');
      } else {
        // Si no existe, crearlo y asignar contraseña
        client = await base44.entities.Client.create({
          name: cleanPhone,
          phone: cleanPhone,
          password_hash: inputHash
        });
        toast.success('¡Ingreso exitoso!');
      }

      // Guardar sesión en local storage de forma segura
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
    <div className="h-[100dvh] bg-slate-50 text-slate-900 flex flex-col p-6 relative overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="absolute top-0 inset-x-0 h-48 bg-blue-600 rounded-b-[3rem] shadow-lg"></div>
      <div className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto relative z-10">
        <div className="bg-white rounded-[2rem] p-6 shadow-xl border border-slate-100">
          <div className="text-center space-y-2 mb-8">
            <div className="w-20 h-20 bg-white rounded-2xl p-1 mx-auto shadow-md border border-slate-100 mb-4 -mt-14">
              <img 
                src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" 
                alt="Remises Concepción" 
                className="w-full h-full rounded-xl object-cover"
              />
            </div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Remises Concepción</h1>
            <p className="text-slate-500 text-sm">Ingresá para pedir tu móvil</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="phone" className="text-slate-700 font-bold">Número de celular</Label>
              <Input 
                id="phone" 
                type="tel" 
                placeholder="Ej: 3442 123456" 
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-slate-50 border-slate-200 text-slate-900 h-14 text-lg focus-visible:ring-blue-600 focus-visible:border-blue-600"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-700 font-bold">Contraseña Segura</Label>
              <Input 
                id="password" 
                type="password" 
                placeholder="****" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-slate-50 border-slate-200 text-slate-900 h-14 text-lg focus-visible:ring-blue-600 focus-visible:border-blue-600"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full h-14 text-lg font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md shadow-red-600/20"
              disabled={loading}
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}