import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Shield, Plus, Edit, UserX, UserCheck } from 'lucide-react';
import { format } from 'date-fns';

export default function AdminUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState(false);
  const [formData, setFormData] = useState({ id: null, nombre: '', telefono: '', pin: '', rol: 'Operador', activo: true });
  const { toast } = useToast();

  const getAdminId = () => {
    try {
      const op = JSON.parse(sessionStorage.getItem('local_operator'));
      return op?.id;
    } catch { return null; }
  };

  const cargarUsuarios = async () => {
    try {
      setLoading(true);
      const res = await base44.functions.invoke('authSystem', {
        action: 'manage_users',
        payload: { sub_action: 'list', admin_id: getAdminId() }
      });
      if (res.data?.success) {
        setUsuarios(res.data.usuarios);
      } else {
        toast({ title: "Error", description: res.data?.error || "Error al cargar", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: "No se pudieron cargar los usuarios", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const handleOpenNew = () => {
    setFormData({ id: null, nombre: '', telefono: '', pin: '', rol: 'Operador', activo: true });
    setOpenModal(true);
  };

  const handleOpenEdit = (user) => {
    setFormData({ ...user, pin: '' }); // El PIN se deja vacío. Si escribe, se cambia.
    setOpenModal(true);
  };

  const handleToggleActivo = async (user, nuevoEstado) => {
    try {
      await base44.functions.invoke('authSystem', {
        action: 'manage_users',
        payload: { sub_action: 'update', admin_id: getAdminId(), data: { ...user, activo: nuevoEstado } }
      });
      cargarUsuarios();
    } catch (e) {
      toast({ title: "Error", description: "No se pudo cambiar el estado", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!formData.nombre || !formData.telefono || (!formData.id && !formData.pin)) {
      toast({ title: "Atención", description: "Completa todos los campos requeridos", variant: "destructive" });
      return;
    }

    try {
      const subAction = formData.id ? 'update' : 'create';
      const res = await base44.functions.invoke('authSystem', {
        action: 'manage_users',
        payload: { sub_action: subAction, admin_id: getAdminId(), data: formData }
      });

      if (res.data?.success) {
        toast({ title: "Éxito", description: "Usuario guardado correctamente" });
        setOpenModal(false);
        cargarUsuarios();
      } else {
        toast({ title: "Error", description: res.data?.error || "Error al guardar", variant: "destructive" });
      }
    } catch (e) {
      const msg = e.response?.data?.error || "Error al comunicarse con el servidor";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            Administración de Usuarios
          </h1>
          <p className="text-muted-foreground text-sm">Gestiona los accesos de la central (Teléfono y PIN)</p>
        </div>
        <Button onClick={handleOpenNew} className="gap-2 rounded-xl">
          <Plus className="w-4 h-4" /> Nuevo Usuario
        </Button>
      </div>

      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Cargando usuarios...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50/50 text-gray-500 font-medium border-b">
                <tr>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Teléfono</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Último Acceso</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {usuarios.map(u => (
                  <tr key={u.id} className={!u.activo ? "bg-red-50/30" : "hover:bg-gray-50/50 transition-colors"}>
                    <td className="px-4 py-3 font-bold text-black text-base">{u.nombre}</td>
                    <td className="px-4 py-3 font-bold text-black text-base">{u.telefono}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        u.rol === 'Administrador General' ? 'bg-purple-100 text-purple-800' :
                        u.rol === 'Supervisor' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {u.rol}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {u.ultimo_acceso ? format(new Date(u.ultimo_acceso), "dd/MM/yyyy HH:mm") : "Nunca"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-xs font-medium text-gray-500 w-12 text-right">
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                        <Switch 
                          checked={u.activo} 
                          onCheckedChange={(val) => handleToggleActivo(u, val)} 
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(u)} className="h-8 w-8">
                        <Edit className="w-4 h-4 text-gray-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-4 py-8 text-center text-gray-500">No hay usuarios registrados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{formData.id ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Nombre y Apellido</label>
              <Input value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})} placeholder="Ej. Juan Pérez" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Teléfono (Login)</label>
              <Input type="tel" value={formData.telefono} onChange={e => setFormData({...formData, telefono: e.target.value.replace(/\D/g, '')})} placeholder="Sin espacios ni guiones" />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Código PIN {formData.id && "(Dejar en blanco para no cambiar)"}</label>
              <Input type="password" value={formData.pin} onChange={e => setFormData({...formData, pin: e.target.value.replace(/\D/g, '')})} placeholder={formData.id ? "••••" : "Ingresar nuevo PIN"} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Rol del Usuario</label>
              <Select value={formData.rol} onValueChange={v => setFormData({...formData, rol: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Operador">Operador</SelectItem>
                  <SelectItem value="Supervisor">Supervisor</SelectItem>
                  <SelectItem value="Administrador General">Administrador General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <Switch checked={formData.activo} onCheckedChange={v => setFormData({...formData, activo: v})} />
              <label className="text-sm font-medium cursor-pointer">
                Usuario activo (puede ingresar)
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenModal(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}