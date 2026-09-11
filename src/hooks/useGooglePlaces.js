/**
 * Hook para autocompletar direcciones nuevas usando Geoapify vía backend.
 * La API key queda protegida en los secretos de Base44.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";

export function useGooglePlaces(inputValue) {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const cacheRef = useRef(new Map());

  useEffect(() => {
    if (!inputValue || inputValue.length < 3) {
      setPredictions([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const cached = cacheRef.current.get(inputValue);
      if (cached) { setPredictions(cached); return; }

      setLoading(true);
      try {
        const sessionToken = localStorage.getItem('client_token') || sessionStorage.getItem('local_operator_token') || 'client_demo_token';
        const res = await base44.functions.invoke("geocodeRoute", {
          action: "autocomplete",
          input: inputValue,
          sessionToken
        });
        const preds = res.data?.predictions || [];
        cacheRef.current.set(inputValue, preds);
        if (cacheRef.current.size > 50) cacheRef.current.delete(cacheRef.current.keys().next().value);
        setPredictions(preds);
      } catch (_) {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [inputValue]);

  // Geoapify devuelve coordenadas asociadas a cada sugerencia.
  const getPlaceDetails = useCallback(async (place_id, description) => {
    // Si las coordenadas vienen dentro del identificador, extraerlas localmente.
    if (place_id?.startsWith("geoapify_") || place_id?.startsWith("photon_") || place_id?.startsWith("osm_")) {
      const parts = place_id.replace("geoapify_", "").replace("photon_", "").replace("osm_", "").split("_");
      return {
        lat: parseFloat(parts[0]),
        lng: parseFloat(parts[1]),
        formatted_address: description || "",
      };
    }

    // Fallback al backend para identificadores legacy.
    const sessionToken = localStorage.getItem('client_token') || sessionStorage.getItem('local_operator_token') || 'client_demo_token';
    const res = await base44.functions.invoke("geocodeRoute", {
      action: "placedetails",
      place_id,
      description,
      sessionToken
    });
    return res.data;
  }, []);

  return { predictions, loading, getPlaceDetails };
}