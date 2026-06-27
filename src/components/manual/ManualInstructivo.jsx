import { useState } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";

const secciones = [
  {
    titulo: "🖥️ Central de Despacho (Inicio)",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Qué es la Central?",
        texto: "Es la pantalla principal del sistema. Desde aquí podés ver en tiempo real todos los viajes activos, chóferes en posición y el mapa con ubicaciones en vivo."
      },
      {
        subtitulo: "Estadísticas del encabezado",
        texto: "• Activos: viajes en curso (aceptados, en camino, en viaje).\n• Pendientes: pedidos sin asignar aún.\n• Completados Hoy: viajes finalizados en el día.\n• Chóferes en Posición: chóferes disponibles con base asignada."
      },
      {
        subtitulo: "Panel de Despacho",
        texto: "Muestra los viajes pendientes y ofrecidos. Hacé clic en un viaje para ver el detalle y gestionarlo. Los viajes rechazados se reasignan automáticamente."
      },
      {
        subtitulo: "Colas por Base",
        texto: "Muestra la cola de chóferes esperando en cada base (Puerto, Plaza, Columna, etc.), ordenados por llegada. El primero en la cola es el próximo en recibir un viaje."
      },
      {
        subtitulo: "Alertas de Pánico",
        texto: "Si un chófer activa el botón de pánico desde su app, aparece un aviso rojo con sonido en la central. Podés ver la ubicación en Google Maps y marcarlo como 'Atendido'."
      }
    ]
  },
  {
    titulo: "📋 Órdenes",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Qué es una orden?",
        texto: "Es un pedido de viaje. Contiene los datos del cliente, dirección de origen, destino, chófer asignado y estado actual."
      },
      {
        subtitulo: "Estados de un viaje",
        texto: "• Pendiente → Ofrecido → Aceptado → En Camino → En Viaje → Completado\n• También puede ser Cancelado o Rechazado si el chófer no acepta."
      },
      {
        subtitulo: "Crear un nuevo pedido",
        texto: "Usá el botón 'Nuevo Pedido' (en el menú lateral o arriba en la Central). Completá teléfono o nombre del cliente para autocompletar datos, luego indicá origen y destino."
      },
      {
        subtitulo: "Asignación de chófer",
        texto: "El sistema sugiere automáticamente el chófer más cercano a la zona de recogida según la cola de bases. Podés aceptar la sugerencia o elegir otro manualmente."
      },
      {
        subtitulo: "Tarifa estimada",
        texto: "Al cargar origen y destino se calcula automáticamente una tarifa estimada según la distancia y la configuración de precios."
      }
    ]
  },
  {
    titulo: "📅 Agenda",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Para qué sirve la Agenda?",
        texto: "Para programar viajes con anticipación. Podés agendar un pedido indicando fecha, hora, origen, destino y si se requiere un chófer específico."
      },
      {
        subtitulo: "Alertas automáticas",
        texto: "El sistema te avisa cuando un viaje agendado está próximo a su horario para que lo despachez a tiempo."
      },
      {
        subtitulo: "Estados de viajes agendados",
        texto: "• Pendiente: aún no despachado.\n• Notificado: el sistema alertó al operador.\n• Despachado: se creó la orden de viaje.\n• Completado / Cancelado."
      }
    ]
  },
  {
    titulo: "👤 Clientes",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Qué es el módulo de Clientes?",
        texto: "Guarda el historial y datos de cada pasajero: nombre, teléfono, dirección habitual, cantidad de viajes, cancelaciones y puntuación."
      },
      {
        subtitulo: "Autocompletar al crear un pedido",
        texto: "Cuando escribís el teléfono en el formulario de nuevo pedido, el sistema busca automáticamente si existe el cliente y precarga sus datos."
      },
      {
        subtitulo: "Puntuación del cliente",
        texto: "Va de 1 a 10. Ayuda al operador a identificar clientes problemáticos. Los clientes con baja puntuación o en lista negra se muestran con alertas visuales."
      },
      {
        subtitulo: "Lista negra",
        texto: "Los clientes en lista negra aparecen con un aviso rojo. El operador puede decidir no tomarles el pedido."
      },
      {
        subtitulo: "Historial de direcciones",
        texto: "El sistema guarda automáticamente todas las direcciones usadas (origen y destino) para sugerirlas la próxima vez que ese cliente llame."
      },
      {
        subtitulo: "Teléfono único",
        texto: "No se puede registrar dos clientes con el mismo número de teléfono. Si ya existe, el sistema avisa a qué cliente pertenece."
      }
    ]
  },
  {
    titulo: "💬 Mensajes",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Cómo funciona el chat?",
        texto: "El operador puede enviar mensajes privados a cada chófer o hacer un broadcast a todos. Cada chófer solo ve sus propios mensajes con la central."
      },
      {
        subtitulo: "Mensajes no leídos",
        texto: "En el menú lateral aparece un indicador cuando hay mensajes sin leer de algún chófer."
      }
    ]
  },
  {
    titulo: "🗺️ Mapa",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Qué muestra el mapa?",
        texto: "La ubicación en tiempo real de los chóferes activos y los viajes en curso. Podés hacer clic en un marcador para ver el detalle del chófer o del viaje."
      }
    ]
  },
  {
    titulo: "🚗 Chóferes",
    rol: "admin",
    contenido: [
      {
        subtitulo: "¿Qué es el módulo de Chóferes?",
        texto: "Registra todos los conductores de la flota con sus datos personales, documentación, vehículo asignado y estado operativo."
      },
      {
        subtitulo: "Datos del chófer",
        texto: "Se guarda: nombre, DNI, teléfono, dirección, fecha de nacimiento, categoría de carnet, foto, vencimiento de seguro y buena conducta, y notas internas."
      },
      {
        subtitulo: "Alertas de documentación",
        texto: "El sistema muestra avisos en rojo o amarillo cuando el carnet, el seguro o la buena conducta están vencidos o próximos a vencer."
      },
      {
        subtitulo: "Historial de viajes del chófer",
        texto: "Desde la ficha de cada chófer podés ver todos los viajes que realizó con fecha, origen, destino e importe."
      },
      {
        subtitulo: "Vinculación con Móvil",
        texto: "Cada chófer puede estar asignado a uno o más móviles. Al ingresar el nombre del chófer en el formulario del móvil, se autocompletan patente y color si ya está registrado."
      }
    ]
  },
  {
    titulo: "🚕 Móviles",
    rol: "admin",
    contenido: [
      {
        subtitulo: "¿Qué es un Móvil?",
        texto: "Es el vehículo registrado en la flota. Tiene su propio legajo con datos del titular, documentación del auto, estado de pagos y chóferes asignados."
      },
      {
        subtitulo: "Documentación del vehículo",
        texto: "Se controla: VTV/RTO, seguro automotor, seguro de riesgos personales y buena conducta del titular. Todos con vencimiento y alertas automáticas."
      },
      {
        subtitulo: "Pago semanal",
        texto: "Cada móvil tiene un estado de pago semanal. Si está atrasado, aparece una alerta. También se puede registrar deuda acumulada con su detalle."
      },
      {
        subtitulo: "Suspender o dar de baja",
        texto: "El operador puede suspender un móvil con un motivo. La comisión puede darlo de baja definitiva por falta de pago, papeles, sanción u otro motivo."
      },
      {
        subtitulo: "Advertencia antes de editar",
        texto: "Si un móvil tiene alertas activas (documentos vencidos, deuda, suspensión), el sistema muestra un aviso de advertencia antes de abrir el formulario de edición."
      }
    ]
  },
  {
    titulo: "📱 App Chófer",
    rol: "admin",
    contenido: [
      {
        subtitulo: "¿Qué es la App del Chófer?",
        texto: "Es una app web (PWA) que el chófer instala en su celular. No requiere descarga desde tienda: se abre desde el navegador y se agrega a la pantalla de inicio."
      },
      {
        subtitulo: "Funciones del chófer",
        texto: "• Ver y aceptar/rechazar viajes en tiempo real.\n• Ver el taxímetro en vivo durante el viaje.\n• Cambiar su base actual (Puerto, Plaza, etc.).\n• Enviar y recibir mensajes del operador.\n• Activar el botón de pánico en emergencias.\n• Ver su resumen de viajes del día."
      },
      {
        subtitulo: "Cómo vincular un chófer",
        texto: "Desde la sección 'App Chófer' del menú admin, generás un link de acceso directo para cada chófer con su número de móvil. El chófer abre ese link en su celular y ya queda identificado."
      },
      {
        subtitulo: "Notificaciones push",
        texto: "Los chóferes reciben alertas de nuevos viajes directamente en el celular, incluso con la pantalla apagada, con acciones de Aceptar y Rechazar desde la notificación."
      }
    ]
  },
  {
    titulo: "🗺️ Zonas",
    rol: "admin",
    contenido: [
      {
        subtitulo: "¿Para qué sirven las Zonas?",
        texto: "El sistema usa palabras clave de calles para detectar automáticamente la zona de un pedido (Puerto, Plaza, Columna, etc.) y asignar el chófer más conveniente."
      },
      {
        subtitulo: "Agregar palabras clave",
        texto: "Podés agregar nombres de calles, barrios o referencias a cada zona. Mientras más completo esté, mejor funciona la asignación automática."
      },
      {
        subtitulo: "Prioridad",
        texto: "Si una dirección coincide con varias zonas, se usa la de mayor prioridad."
      }
    ]
  },
  {
    titulo: "💰 Tarifas",
    rol: "admin",
    contenido: [
      {
        subtitulo: "¿Qué se configura?",
        texto: "Los valores del taxímetro: bajada de bandera, precio por metro, precio por minuto en movimiento y precio por minuto de espera. Hay tarifas diurna y nocturna."
      },
      {
        subtitulo: "Tarifa nocturna",
        texto: "Se activa automáticamente según el horario configurado (por defecto de 22:00 a 06:00) y aplica valores más altos."
      },
      {
        subtitulo: "Clave de modificación",
        texto: "Para evitar cambios accidentales, la edición de tarifas requiere ingresar una clave numérica previamente configurada."
      }
    ]
  },
  {
    titulo: "🔄 Cambio de usuario",
    rol: "operador",
    contenido: [
      {
        subtitulo: "¿Para qué sirve?",
        texto: "En la parte superior del menú lateral hay un botón de 'Cambiar usuario'. Permite que otro operador o directivo tome el turno sin cerrar sesión completamente."
      }
    ]
  }
];

function Seccion({ s, expandida, onToggle }) {
  const [expandidos, setExpandidos] = useState({});

  const toggleItem = (i) => {
    setExpandidos(prev => ({ ...prev, [i]: !prev[i] }));
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="font-semibold text-gray-800 text-sm">{s.titulo}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.rol === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
            {s.rol === "admin" ? "Comisión" : "Operador"}
          </span>
          {expandida ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        </div>
      </button>
      {expandida && (
        <div className="divide-y divide-gray-100">
          {s.contenido.map((item, i) => (
            <div key={i} className="px-4 py-2">
              <button
                onClick={() => toggleItem(i)}
                className="w-full flex items-center justify-between py-1 text-left"
              >
                <span className="text-sm font-medium text-gray-700">{item.subtitulo}</span>
                {expandidos[i] ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
              </button>
              {expandidos[i] && (
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line pb-2 pt-1 pl-1">
                  {item.texto}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ManualInstructivo() {
  const [open, setOpen] = useState(false);
  const [expandidas, setExpandidas] = useState({});
  const [filtro, setFiltro] = useState("todos");

  const toggle = (i) => setExpandidas(prev => ({ ...prev, [i]: !prev[i] }));

  const seccionesFiltradas = secciones.filter(s => filtro === "todos" || s.rol === filtro);

  return (
    <>
      {/* Botón flotante ? */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center text-xl font-bold transition-all hover:scale-110"
        title="Manual de uso"
      >
        ?
      </button>

      {/* Modal del manual */}
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center" style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Manual del Sistema</h2>
                <p className="text-xs text-gray-500">Guía completa para operadores y comisión</p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Filtro */}
            <div className="flex gap-2 px-5 py-3 border-b bg-gray-50">
              {[
                { val: "todos", label: "Todo" },
                { val: "operador", label: "Operador" },
                { val: "admin", label: "Comisión / Admin" },
              ].map(f => (
                <button
                  key={f.val}
                  onClick={() => setFiltro(f.val)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filtro === f.val ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Contenido */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-2">
              {seccionesFiltradas.map((s, i) => (
                <Seccion key={i} s={s} expandida={!!expandidas[i]} onToggle={() => toggle(i)} />
              ))}
            </div>

            <div className="px-5 py-3 border-t text-center">
              <p className="text-xs text-gray-400">Sistema de Despacho — Tocá cada sección para expandirla</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}