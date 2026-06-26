import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
    const base44 = createClientFromRequest(req);
    const authenticated = await base44.auth.isAuthenticated();
    if (!authenticated) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    // ── 1. Autocomplete de direcciones (Google Places) ──────────────────────
    if (action === "autocomplete") {
      const { input } = body;
      if (!input || input.length < 2) return Response.json({ predictions: [] });

      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input + ", Gualeguaychú, Entre Ríos, Argentina")}&key=${GOOGLE_API_KEY}&language=es&components=country:ar&location=-33.01,-58.51&radius=15000`;
      const r = await fetch(url);
      const data = await r.json();

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        return Response.json({ error: data.status, message: data.error_message }, { status: 400 });
      }

      const predictions = (data.predictions || []).map((p) => ({
        place_id: p.place_id,
        description: p.description,
        structured_formatting: p.structured_formatting,
      }));

      return Response.json({ predictions });
    }

    // ── 2. Obtener lat/lng de un place_id (Google Place Details) ───────────
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
        return Response.json({ error: data.status, message: data.error_message }, { status: 400 });
      }

      const loc = data.result.geometry.location;
      return Response.json({ lat: loc.lat, lng: loc.lng, formatted_address: data.result.formatted_address });
    }

    // ── 3. Calcular distancia de ruta (Google Directions) ──────────────────
    if (action === "route") {
      const { originLat, originLng, destLat, destLng } = body;
      if (!originLat || !originLng || !destLat || !destLng) {
        return Response.json({ error: "coords required" }, { status: 400 });
      }

      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${GOOGLE_API_KEY}&language=es&mode=driving`;
      const r = await fetch(url);
      const data = await r.json();

      if (data.status !== "OK") {
        // Fallback Haversine si Google Directions falla
        const R = 6371000;
        const dLat = (destLat - originLat) * Math.PI / 180;
        const dLng = (destLng - originLng) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(originLat*Math.PI/180) * Math.cos(destLat*Math.PI/180) * Math.sin(dLng/2)**2;
        const distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) * 1.3);
        return Response.json({ distance, fallback: true });
      }

      const leg = data.routes[0].legs[0];
      return Response.json({ distance: leg.distance.value });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});