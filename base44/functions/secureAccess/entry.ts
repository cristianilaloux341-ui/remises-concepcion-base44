import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Todas las llamadas desde la app de la base validan la sesión (JWT del backend)
    if (!user) {
      return Response.json({ error: 'Unauthorized. Token JWT inválido o sesión expirada.' }, { status: 401 });
    }

    // Aquí se podrían agregar funciones específicas con validación estricta de propiedad (IDOR)
    // Ejemplo: const viaje = await base44.asServiceRole.entities.RideOrder.get(reqId);
    // if (viaje.driver_id !== user.id) return 403 Forbidden;

    return Response.json({ status: 'ok', secure: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});