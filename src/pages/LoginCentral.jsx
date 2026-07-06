import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Car, Lock, Phone } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export default function LoginCentral() {
  const [telefono, setTelefono] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!telefono || !pin) return;
    
    setLoading(true);
    try {
      // Intentar forzar la inicialización si la tabla está vacía
      await base44.functions.invoke('authSystem', { action: 'init_system' }).catch(() => {});

      const response = await base44.functions.invoke('authSystem', { 
        action: 'login', 
        payload: { telefono, pin } 
      });

      if (response.data?.success) {
        sessionStorage.setItem("local_operator", JSON.stringify(response.data.usuario));
        sessionStorage.setItem("local_operator_token", response.data.token);
        // Redirigir al inicio
        window.location.href = "/";
      } else {
        toast({
          title: "Acceso denegado",
          description: response.data?.error || "Credenciales incorrectas o usuario inactivo",
          variant: "destructive"
        });
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || "Credenciales incorrectas o usuario inactivo";
      toast({
        title: "Acceso denegado",
        description: errorMsg,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-primary p-6 text-center">
          <div className="w-20 h-20 mx-auto mb-4">
            <img 
              src="https://base44.app/api/apps/6a2195daf5c708d8398b3ca1/files/mp/public/6a2195daf5c708d8398b3ca1/a9e61fb71_9aaf2aa1d_whatsapp_image_2212741042823763.jpg" 
              alt="Logo" 
              className="w-full h-full object-cover rounded-2xl shadow-lg border-2 border-white/20"
            />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Central de Despacho</h1>
          <p className="text-primary-foreground/80 text-sm mt-1">Acceso seguro para operadores</p>
        </div>

        <form onSubmit={handleLogin} className="p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Teléfono</label>
            <div className="relative">
              <Phone className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                type="tel"
                placeholder="Ej. 3442640443"
                className="pl-10 h-12 rounded-xl text-lg"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700">Código PIN</label>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                type="password"
                placeholder="••••"
                className="pl-10 h-12 rounded-xl text-lg tracking-widest"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full h-12 rounded-xl text-lg font-bold mt-4" 
            disabled={loading || !telefono || !pin}
          >
            {loading ? "Verificando..." : "Ingresar"}
          </Button>
        </form>
      </div>
    </div>
  );
}