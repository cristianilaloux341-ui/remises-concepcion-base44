import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Política de Privacidad</h1>
          <p className="text-muted-foreground">Última actualización: 29 de Junio de 2026</p>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">1. Recopilación de Datos de Ubicación (GPS en segundo plano)</h2>
          <p className="leading-relaxed">
            Nuestra aplicación recopila y transmite datos de ubicación de los conductores. Para que el sistema de despacho funcione correctamente, 
            <strong> recopilamos datos de ubicación en segundo plano</strong>. Esto significa que podemos acceder a la ubicación del dispositivo incluso cuando 
            la aplicación está cerrada o no se encuentra en la pantalla principal.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">2. Finalidad del Uso de Ubicación</h2>
          <p className="leading-relaxed">La ubicación exacta del dispositivo se utiliza exclusivamente para los siguientes fines operativos:</p>
          <ul className="list-disc pl-6 space-y-2 leading-relaxed">
            <li><strong>Despacho Inteligente:</strong> Asignar viajes automáticamente al chofer más cercano disponible.</li>
            <li><strong>Seguridad (Botón de Pánico):</strong> Permitir a la central localizar el vehículo inmediatamente en caso de emergencia.</li>
            <li><strong>Cálculo de Tarifas:</strong> Medir distancias recorridas y tiempos de espera para el taxímetro integrado.</li>
            <li><strong>Monitoreo de Flota:</strong> Mostrar la ubicación de los móviles en tiempo real en el mapa de la central de operaciones.</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">3. Protección y Compartición de Datos</h2>
          <p className="leading-relaxed">
            La información de ubicación se transmite de forma segura a nuestros servidores. Estos datos son de uso estrictamente interno por parte 
            de los operadores y administradores de la central de remises. <strong>No vendemos, alquilamos ni compartimos</strong> información de 
            ubicación con terceros ajenos a la prestación del servicio de transporte.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">4. Control del Usuario</h2>
          <p className="leading-relaxed">
            El conductor puede detener la transmisión de ubicación en cualquier momento cambiando su estado a "No Disponible" o cerrando su sesión. 
            Sin embargo, la ubicación en segundo plano es un requisito técnico obligatorio para recibir viajes mientras se está en estado "Disponible".
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">5. Contacto</h2>
          <p className="leading-relaxed">
            Si tiene alguna duda sobre el manejo de sus datos o esta política de privacidad, comuníquese con la administración de la remisería.
          </p>
        </section>
      </div>
    </div>
  );
}