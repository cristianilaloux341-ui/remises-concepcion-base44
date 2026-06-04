import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Suscripción en tiempo real a órdenes.
 * Carga inicial + actualizaciones push instantáneas.
 * @param {object} options
 * @param {number} [options.limit=100]
 * @param {string} [options.sort="-created_date"]
 */
export function useRealtimeOrders({ limit = 100, sort = "-created_date" } = {}) {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Carga inicial
    base44.entities.RideOrder.list(sort, limit).then((data) => {
      if (mountedRef.current) {
        setOrders(data);
        setIsLoading(false);
      }
    });

    // Suscripción en tiempo real
    const unsub = base44.entities.RideOrder.subscribe((event) => {
      if (!mountedRef.current) return;

      setOrders((prev) => {
        if (event.type === "create") {
          // Insertar al inicio (orden descendente por fecha)
          return [event.data, ...prev].slice(0, limit);
        }
        if (event.type === "update") {
          return prev.map((o) => (o.id === event.id ? event.data : o));
        }
        if (event.type === "delete") {
          return prev.filter((o) => o.id !== event.id);
        }
        return prev;
      });
    });

    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, [limit, sort]);

  return { orders, isLoading };
}