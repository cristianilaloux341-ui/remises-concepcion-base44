/**
 * Hook para autocompletar direcciones usando Google Places API (via backend proxy).
 * Maneja session tokens para agrupar calls Autocomplete + PlaceDetails en una sola facturación.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";

function generateSessionToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function useGooglePlaces(inputValue) {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef(generateSessionToken());
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
        const res = await base44.functions.invoke("geocodeRoute", {
          action: "autocomplete",
          input: inputValue,
          sessiontoken: sessionTokenRef.current,
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
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [inputValue]);

  const getPlaceDetails = useCallback(async (place_id) => {
    const res = await base44.functions.invoke("geocodeRoute", {
      action: "placedetails",
      place_id,
      sessiontoken: sessionTokenRef.current,
    });
    // Después de PlaceDetails, renovar session token (nueva sesión de facturación)
    sessionTokenRef.current = generateSessionToken();
    return res.data; // { lat, lng, formatted_address }
  }, []);

  return { predictions, loading, getPlaceDetails };
}