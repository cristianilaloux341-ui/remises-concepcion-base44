import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Real-time subscription hook for RideOrder entity.
 * Keeps the ["orders"] query cache always fresh without polling.
 */
export function useRealtimeOrders() {
  const queryClient = useQueryClient();
  const unsubRef = useRef(null);

  useEffect(() => {
    unsubRef.current = base44.entities.RideOrder.subscribe((event) => {
      queryClient.setQueryData(["orders"], (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (event.type === "create") {
          // Prepend new order (sorted by created_date desc)
          return [event.data, ...list.filter(o => o.id !== event.id)];
        }
        if (event.type === "update") {
          if (!event.data) return list;
          const exists = list.some(o => o.id === event.id);
          if (exists) return list.map(o => o.id === event.id ? { ...o, ...event.data } : o);
          return [event.data, ...list];
        }
        if (event.type === "delete") {
          return list.filter(o => o.id !== event.id);
        }
        return list;
      });
    });

    return () => {
      unsubRef.current?.();
    };
  }, [queryClient]);
}

/**
 * Real-time subscription hook for Driver entity.
 */
export function useRealtimeDrivers() {
  const queryClient = useQueryClient();
  const unsubRef = useRef(null);

  useEffect(() => {
    unsubRef.current = base44.entities.Driver.subscribe((event) => {
      queryClient.setQueryData(["drivers"], (prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (event.type === "create") {
          return [...list.filter(d => d.id !== event.id), event.data];
        }
        if (event.type === "update") {
          if (!event.data) return list;
          const exists = list.some(d => d.id === event.id);
          if (exists) return list.map(d => d.id === event.id ? { ...d, ...event.data } : d);
          return [...list, event.data];
        }
        if (event.type === "delete") {
          return list.filter(d => d.id !== event.id);
        }
        return list;
      });
    });

    return () => {
      unsubRef.current?.();
    };
  }, [queryClient]);
}