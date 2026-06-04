import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Suscripción en tiempo real a conductores.
 * Carga inicial + actualizaciones push instantáneas.
 */
export function useRealtimeDrivers() {
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Carga inicial
    base44.entities.Driver.list().then((data) => {
      if (mountedRef.current) {
        setDrivers(data);
        setIsLoading(false);
      }
    });

    // Suscripción en tiempo real
    const unsub = base44.entities.Driver.subscribe((event) => {
      if (!mountedRef.current) return;

      setDrivers((prev) => {
        if (event.type === "create") {
          return [...prev, event.data];
        }
        if (event.type === "update") {
          return prev.map((d) => (d.id === event.id ? event.data : d));
        }
        if (event.type === "delete") {
          return prev.filter((d) => d.id !== event.id);
        }
        return prev;
      });
    });

    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  return { drivers, isLoading };
}