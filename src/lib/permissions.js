/**
 * RBAC — Permisos por rol
 * Roles: admin, operador, supervisor, caja
 *
 * Cada permiso define qué puede ver/hacer cada rol.
 * El admin siempre tiene acceso total.
 */

export const ROLE_LABELS = {
  admin: "Administrador",
  operador: "Operador de Despacho",
  supervisor: "Supervisor",
  caja: "Administrativo de Caja",
};

export const ROLE_COLORS = {
  admin: "bg-purple-100 text-purple-700 border-purple-200",
  operador: "bg-blue-100 text-blue-700 border-blue-200",
  supervisor: "bg-amber-100 text-amber-700 border-amber-200",
  caja: "bg-green-100 text-green-700 border-green-200",
};

/**
 * Permisos de navegación: qué rutas puede ver cada rol.
 * El admin tiene acceso a todo.
 */
const NAV_PERMISSIONS = {
  admin:      ["dashboard", "orders", "map", "clients", "agenda", "messages", "drivers", "moviles", "tarifas", "zone-settings", "tiempo-espera", "usuarios", "backup", "driver-link"],
  supervisor: ["dashboard", "orders", "map", "clients", "agenda", "messages", "drivers", "moviles"],
  operador:   ["dashboard", "orders", "map", "clients", "agenda", "messages"],
  caja:       ["dashboard", "clients", "agenda"],
};

/**
 * Permisos de acciones: qué puede hacer cada rol.
 */
const ACTION_PERMISSIONS = {
  admin: {
    canDispatch: true,          // Despachar viajes
    canCancelOrder: true,       // Cancelar viajes
    canViewFares: true,         // Ver tarifas y configuración
    canEditTarifas: true,       // Editar tarifas
    canManageDrivers: true,     // CRUD choferes y móviles
    canManageUsers: true,       // CRUD operadores
    canViewReports: true,       // Ver estadísticas completas
    canManageQueue: true,       // Gestionar cola de bases
    canSendMessages: true,      // Enviar mensajes a choferes
    canSeeFinancials: true,     // Ver importes y tarifas en órdenes
    canBackup: true,            // Acceso a backup
  },
  supervisor: {
    canDispatch: true,
    canCancelOrder: true,
    canViewFares: true,
    canEditTarifas: false,
    canManageDrivers: false,
    canManageUsers: false,
    canViewReports: true,
    canManageQueue: true,
    canSendMessages: true,
    canSeeFinancials: true,
    canBackup: false,
  },
  operador: {
    canDispatch: true,
    canCancelOrder: true,
    canViewFares: false,
    canEditTarifas: false,
    canManageDrivers: false,
    canManageUsers: false,
    canViewReports: false,
    canManageQueue: true,
    canSendMessages: true,
    canSeeFinancials: false,
    canBackup: false,
  },
  caja: {
    canDispatch: false,
    canCancelOrder: false,
    canViewFares: true,
    canEditTarifas: false,
    canManageDrivers: false,
    canManageUsers: false,
    canViewReports: true,
    canManageQueue: false,
    canSendMessages: false,
    canSeeFinancials: true,
    canBackup: false,
  },
};

/**
 * Obtiene el operador local del localStorage.
 */
export function getLocalOperator() {
  try {
    return JSON.parse(sessionStorage.getItem("local_operator") || "null");
  } catch {
    return null;
  }
}

/**
 * Retorna el rol efectivo del operador actual.
 */
export function getEffectiveRole(platformUser) {
  const op = getLocalOperator();
  if (op?.role) return op.role;
  if (platformUser?.role) return platformUser.role;
  return "operador";
}

/**
 * Verifica si el rol actual tiene acceso a una ruta de navegación.
 * @param {string} route - clave de ruta (ej: "drivers", "tarifas")
 * @param {string} role - rol del operador
 */
export function canAccessRoute(route, role) {
  const allowed = NAV_PERMISSIONS[role] || NAV_PERMISSIONS["operador"];
  return allowed.includes(route);
}

/**
 * Verifica si el rol actual tiene permiso para una acción específica.
 * @param {string} action - clave de acción (ej: "canDispatch")
 * @param {string} role - rol del operador
 */
export function can(action, role) {
  const perms = ACTION_PERMISSIONS[role] || ACTION_PERMISSIONS["operador"];
  return !!perms[action];
}

/**
 * Hook-like helper: retorna un objeto con todos los permisos del operador actual.
 */
export function usePermissions(platformUser) {
  const role = getEffectiveRole(platformUser);
  const perms = ACTION_PERMISSIONS[role] || ACTION_PERMISSIONS["operador"];
  return { role, ...perms };
}