import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { validateInternalKey, verifyOperatorSession } from '../../shared/security.ts';

Deno.serve(async (req) => {
  try {
    const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
    const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { action, sessionToken, internalKey } = body;

    let isAppRequest = false;
    let validDriver = null;
    
    if (validateInternalKey(internalKey)) {
      isAppRequest = true;
    } else if (sessionToken) {
      if (await verifyOperatorSession(base44.asServiceRole, sessionToken)) {
        isAppRequest = true;
      } else {
        const choferes = await base44.asServiceRole.entities.Driver.filter({ current_session_token: sessionToken });
        if (choferes.length > 0) {
          isAppRequest = true;
          validDriver = choferes[0];
        }
      }
    } else {
       isAppRequest = await base44.auth.isAuthenticated();
    }

    if (!isAppRequest) {
      return Response.json({ error: "Unauthorized. Se requiere sessionToken válido." }, { status: 401 });
    }
    
    // Bypass prevention: Drivers can only consume routing APIs if they are in an active ride
    if (validDriver && action === "route") {
       if (!validDriver.active_ride_id) {
          return Response.json({ error: "Consumo de API denegado: No tienes un viaje activo." }, { status: 403 });
       }
    }

    // ── 1. Autocomplete (Google Places API) ────────────────────────────────
    if (action === "autocomplete") {
      const { input } = body;
      if (!input || input.length < 2) return Response.json({ predictions: [] });

      // Forzamos la búsqueda local con strictbounds y agregamos la ciudad si no está escrita para no poner "cualquier cosa" de otros lados
      const query = input.toLowerCase().includes("concepci") ? input : `${input}, Concepción del Uruguay`;
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&language=es&components=country:ar&location=-32.4853,-58.2375&radius=15000&strictbounds=true`;
      const r = await fetch(url);
      const data = await r.json();

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        console.error("Google Places autocomplete error:", data.status, data.error_message);
        return Response.json({ error: data.status, message: data.error_message }, { status: 400 });
      }

      const predictions = (data.predictions || []).map((p) => ({
        place_id: p.place_id,
        description: p.description,
        structured_formatting: p.structured_formatting,
      }));

      return Response.json({ predictions });
    }

    // ── 2. Place Details → lat/lng (Google Place Details API) ──────────────
    if (action === "placedetails") {
      const { place_id, description } = body;
      if (!place_id) return Response.json({ error: "place_id required" }, { status: 400 });

      // Compatibilidad con place_ids legacy de OSM
      if (place_id.startsWith("photon_") || place_id.startsWith("osm_")) {
        const parts = place_id.replace("photon_", "").replace("osm_", "").split("_");
        return Response.json({ lat: parseFloat(parts[0]), lng: parseFloat(parts[1]), formatted_address: description || "" });
      }

      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=geometry,formatted_address&key=${GOOGLE_API_KEY}&language=es`;
      const r = await fetch(url);
      const data = await r.json();

      if (data.status !== "OK") {
        console.error("Google Place Details error:", data.status, data.error_message);
        return Response.json({ error: data.status, message: data.error_message }, { status: 400 });
      }

      const loc = data.result.geometry.location;
      return Response.json({ lat: loc.lat, lng: loc.lng, formatted_address: data.result.formatted_address });
    }

    // ── 2.5 Búsqueda de Coordenadas Directas (Geocode) ──────────────────────
    if (action === "geocode") {
      const { address, lat, lng } = body;
      
      // Reverse Geocoding (Lat/Lng -> Dirección)
      if (lat && lng) {
        try {
          const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}&language=es`;
          const r = await fetch(url);
          const data = await r.json();
          if (data.status === "OK" && data.results.length > 0) {
            const result = data.results[0];
            const route = result.address_components.find(c => c.types.includes("route"))?.short_name || "";
            const num = result.address_components.find(c => c.types.includes("street_number"))?.short_name || "";
            const shortAddress = route ? `${route} ${num}`.trim() : result.formatted_address.split(',')[0];
            return Response.json({ lat, lng, address: shortAddress, full_address: result.formatted_address });
          }
        } catch(e) { console.error("Reverse geocoding error:", e); }
      }
      
      // Forward Geocoding (Dirección Libre -> Lat/Lng)
      if (address) {
        try {
          const query = address.toLowerCase().includes("concepci") ? address : `${address}, Concepción del Uruguay`;
          const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&language=es&components=country:ar`;
          const r = await fetch(url);
          const data = await r.json();
          if (data.status === "OK" && data.results.length > 0) {
            const loc = data.results[0].geometry.location;
            return Response.json({ lat: loc.lat, lng: loc.lng, full_address: data.results[0].formatted_address });
          }
        } catch(e) { console.error("Forward geocoding error:", e); }
      }
      return Response.json({ error: "No se pudo geocodificar", lat: null, lng: null }, { status: 400 });
    }

    // ── 3. Calcular ruta real por calles ───────────────────────────────────
    // Módulo 2: Google Directions API (principal)
    // Módulo 4: Haversine × 1.3 (fallback de emergencia)
    if (action === "route") {
      const { originLat, originLng, destLat, destLng } = body;
      if (!originLat || !originLng || !destLat || !destLng) {
        return Response.json({ error: "Se requieren coordenadas de origen y destino" }, { status: 400 });
      }

      // — Intento 1: Google Directions API —
      try {
        const googleUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${GOOGLE_API_KEY}&language=es&mode=driving`;
        const r = await fetch(googleUrl, { signal: AbortSignal.timeout(8000) });
        const data = await r.json();

        if (data.status === "OK" && data.routes?.[0]?.legs?.[0]?.distance?.value) {
          const metros = data.routes[0].legs[0].distance.value;
          console.log(`Google Directions: ${metros}m`);
          return Response.json({ distance: metros, source: "google_directions" });
        }
        console.warn("Google Directions status:", data.status, data.error_message);
      } catch (e) {
        console.warn("Google Directions falló:", e.message);
      }

      // — Intento 2: Mapbox Directions API —
      if (MAPBOX_TOKEN) {
        try {
          const mapboxUrl = `https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}&geometries=geojson&language=es`;
          const r = await fetch(mapboxUrl, { signal: AbortSignal.timeout(8000) });
          const data = await r.json();

          if (data.routes?.[0]?.distance) {
            const metros = Math.round(data.routes[0].distance);
            console.log(`Mapbox Directions: ${metros}m`);
            return Response.json({ distance: metros, source: "mapbox" });
          }
          console.warn("Mapbox sin rutas:", JSON.stringify(data).slice(0, 200));
        } catch (e) {
          console.warn("Mapbox falló:", e.message);
        }
      }

      // — Fallback de emergencia: Haversine × 1.3 —
      console.warn("FALLBACK: Usando Haversine × 1.3 (sin ruteador real disponible)");
      const R = 6371000;
      const dLat = (destLat - originLat) * Math.PI / 180;
      const dLng = (destLng - originLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(originLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const linea_recta = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const metros = Math.round(linea_recta * 1.3);
      return Response.json({ distance: metros, source: "haversine_fallback", fallback: true });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("geocodeRoute error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});