import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { verifyJWT } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { entity, op, id, data, sessionToken } = body;

    let isAuthorized = false;
    let rol = null;

    if (sessionToken) {
      const tokenData = await verifyJWT(sessionToken);
      if (tokenData && tokenData.id && tokenData.exp && Date.now() < tokenData.exp) {
        const ops = await base44.asServiceRole.entities.UsuariosSistema.filter({ id: tokenData.id });
        if (ops && ops.length > 0 && ops[0].activo) {
          rol = ops[0].rol;
          if (rol === "Administrador General" || rol === "Supervisor") {
            isAuthorized = true;
          }
        }
      }
    } else {
      const user = await base44.auth.me().catch(() => null);
      if (user && user.role === "admin") {
        isAuthorized = true;
        rol = "Administrador General";
      }
    }

    if (!isAuthorized) {
      return Response.json({ error: "Acceso denegado. Se requiere rol de Administrador General o Supervisor." }, { status: 403 });
    }

    // TarifaConfig is exclusively for Administrador General
    if (entity === "TarifaConfig" && rol !== "Administrador General") {
        return Response.json({ error: "Acceso denegado. Solo Administrador General puede modificar tarifas." }, { status: 403 });
    }

    const allowedEntities = ["Driver", "Movil", "TarifaConfig", "Client", "Operator"];
    if (!allowedEntities.includes(entity)) {
        return Response.json({ error: "Entidad no permitida a través de este proxy" }, { status: 403 });
    }

    let result;
    if (op === "create") {
      result = await base44.asServiceRole.entities[entity].create(data);
    } else if (op === "update") {
      result = await base44.asServiceRole.entities[entity].update(id, data);
    } else if (op === "delete") {
      result = await base44.asServiceRole.entities[entity].delete(id);
    } else {
      return Response.json({ error: "Operación no soportada" }, { status: 400 });
    }

    return Response.json({ success: true, result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});