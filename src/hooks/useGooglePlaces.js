/**
 * Hook para autocompletar direcciones usando Photon (OpenStreetMap) via backend proxy.
 * No requiere API key ni billing — funciona inmediatamente.
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

  // Las predicciones de Photon ya traen _lat/_lng embebidos
  // Solo necesita llamar al backend si el place_id no empieza por "photon_"
  const getPlaceDetails = useCallback(async (place_id, description) => {
    // Si las coordenadas vienen directo del place_id, extraerlas localmente
    if (place_id?.startsWith("photon_") || place_id?.startsWith("osm_")) {
      const parts = place_id.replace("photon_", "").replace("osm_", "").split("_");
      return {
        lat: parseFloat(parts[0]),
        lng: parseFloat(parts[1]),
        formatted_address: description || "",
      };
    }

    // Fallback al backend (Nominatim)
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