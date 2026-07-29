import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { hashPin, createJWT } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { action, payload } = body;

    // Acción 1: Inicialización automática del Administrador General
    if (action === "init_system") {
      const usuarios = await base44.asServiceRole.entities.UsuariosSistema.list();
      if (usuarios && usuarios.length === 0) {
        // La tabla está vacía, creamos el admin semilla
        const initPin = Deno.env.get("INIT_ADMIN_PIN");
        if (!initPin) {
          return Response.json({ success: false, message: "INIT_ADMIN_PIN no configurado en entorno de seguridad.", initialized: false }, { status: 500 });
        }
        const pinHash = await hashPin(initPin);
        const nuevoAdmin = await base44.asServiceRole.entities.UsuariosSistema.create({
          nombre: "Administrador",
          telefono: "3442640443",
          pin_hash: pinHash,
          rol: "Administrador General",
          activo: true
        });
        return Response.json({ success: true, message: "Administrador semilla creado con éxito.", initialized: true });
      }
      return Response.json({ success: true, message: "Sistema ya inicializado.", initialized: false });
    }

    // Acción 2: Login de teléfono y PIN
    if (action === "login") {
      const { telefono, pin } = payload;
      if (!telefono || !pin) {
        return Response.json({ error: "Teléfono y PIN requeridos" }, { status: 400 });
      }

      const inputHash = await hashPin(pin);
      
      const usuarios = await base44.asServiceRole.entities.UsuariosSistema.filter({
        telefono: telefono
      });

      if (usuarios.length === 0) {
        // Error genérico para no filtrar información
        return Response.json({ error: "Credenciales incorrectas o usuario inactivo" }, { status: 401 });
      }

      const usuario = usuarios[0];
      
      if (!usuario.activo || usuario.pin_hash !== inputHash) {
        return Response.json({ error: "Credenciales incorrectas o usuario inactivo" }, { status: 401 });
      }

      // Actualizar último acceso
      await base44.asServiceRole.entities.UsuariosSistema.update(usuario.id, {
        ultimo_acceso: new Date().toISOString()
      });

      // Emitimos un token JWT firmado de forma criptográfica usando el secreto cargado
      const tokenPayload = await createJWT({ id: usuario.id, telefono: usuario.telefono, exp: Date.now() + 86400000 });
      
      return Response.json({ 
        success: true, 
        token: tokenPayload,
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          telefono: usuario.telefono,
          rol: usuario.rol
        }
      });
    }

    // Acción 3: Gestión de usuarios (Solo Admin)
    if (action === "manage_users") {
      const { sub_action, admin_id, data, sessionToken } = payload;
      
      // Verificar si quien ejecuta es admin comprobando criptográficamente su sesión JWT
      let isAuthorized = false;
      let authenticatedAdminId = admin_id;

      if (sessionToken) {
        const { verifyJWT } = await import('../../shared/security.ts');
        const tokenData = await verifyJWT(sessionToken);
        if (tokenData && tokenData.id && tokenData.exp && Date.now() < tokenData.exp) {
          const adminData = await base44.asServiceRole.entities.UsuariosSistema.get(tokenData.id).catch(() => null);
          if (adminData && (adminData.rol === "Administrador General" || adminData.rol === "Supervisor") && adminData.activo) {
            isAuthorized = true;
            authenticatedAdminId = tokenData.id;
          }
        }
      } else {
        const user = await base44.auth.me().catch(() => null);
        if (user && user.role === "admin") {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        return Response.json({ error: "Acceso denegado. Se requiere rol de Administrador General o Admin." }, { status: 403 });
      }

      if (sub_action === "list") {
        const todos = await base44.asServiceRole.entities.UsuariosSistema.list('', 500);
        // Removemos los hashes antes de enviarlos al cliente
        const seguros = todos.map(u => {
          const { pin_hash, ...rest } = u;
          return rest;
        });
        return Response.json({ success: true, usuarios: seguros });
      }

      if (sub_action === "create") {
        const check = await base44.asServiceRole.entities.UsuariosSistema.filter({ telefono: data.telefono });
        if (check.length > 0) return Response.json({ error: "El teléfono ya existe" }, { status: 400 });
        
        const pinHash = await hashPin(data.pin);
        const newUser = await base44.asServiceRole.entities.UsuariosSistema.create({
          nombre: data.nombre,
          telefono: data.telefono,
          pin_hash: pinHash,
          rol: data.rol,
          activo: data.activo !== false
        });
        return Response.json({ success: true, usuario_id: newUser.id });
      }

      if (sub_action === "update_presence") {
        if (authenticatedAdminId) {
          await base44.asServiceRole.entities.UsuariosSistema.update(authenticatedAdminId, {
            ultimo_acceso: new Date().toISOString()
          }).catch(()=>{});
        }
        return Response.json({ success: true });
      }

      if (sub_action === "update") {
        const updateData = {
          nombre: data.nombre,
          telefono: data.telefono,
          rol: data.rol,
          activo: data.activo
        };
        // Solo actualizamos PIN si se envió uno nuevo
        if (data.pin && data.pin.trim() !== "") {
          updateData.pin_hash = await hashPin(data.pin);
        }
        await base44.asServiceRole.entities.UsuariosSistema.update(data.id, updateData);
        return Response.json({ success: true });
      }

      if (sub_action === "delete") {
        const userId = data.id;
        if (userId === authenticatedAdminId) {
          return Response.json({ error: "No puedes eliminar tu propio usuario" }, { status: 400 });
        }
        await base44.asServiceRole.entities.UsuariosSistema.delete(userId);
        return Response.json({ success: true });
      }
    }

    return Response.json({ error: "Acción desconocida" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});