import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const GOOGLE_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_ACCESS_TOKEN");

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const authenticated = await base44.auth.isAuthenticated();
    if (!authenticated) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    // ── 1. Autocomplete de direcciones (Google Places Autocomplete) ──────────
    if (action === "autocomplete") {
      const { input, sessiontoken } = body;
      if (!input) return Response.json({ predictions: [] });

      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&components=country:ar&location=-33.1270,-58.2310&radius=8000&strictbounds=false&language=es&key=${GOOGLE_KEY}&sessiontoken=${sessiontoken}`;
      const r = await fetch(url);
      const data = await r.json();
      return Response.json({ predictions: data.predictions || [] });
    }

    // ── 2. Obtener lat/lng de un place_id (Google Place Details) ────────────
    if (action === "placedetails") {
      const { place_id, sessiontoken } = body;
      if (!place_id) return Response.json({ error: "place_id required" }, { status: 400 });

      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=geometry,formatted_address&key=${GOOGLE_KEY}&sessiontoken=${sessiontoken}`;
      const r = await fetch(url);
      const data = await r.json();
      const loc = data.result?.geometry?.location;
      if (!loc) return Response.json({ error: "No location found" }, { status: 404 });
      return Response.json({
        lat: loc.lat,
        lng: loc.lng,
        formatted_address: data.result?.formatted_address || "",
      });
    }

    // ── 3. Calcular distancia de ruta (Mapbox Directions) ───────────────────
    if (action === "route") {
      const { originLat, originLng, destLat, destLng } = body;
      if (!originLat || !originLng || !destLat || !destLng) {
        return Response.json({ error: "coords required" }, { status: 400 });
      }

      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${originLng},${originLat};${destLng},${destLat}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=false`;
      const r = await fetch(url);
      const data = await r.json();
      const route = data.routes?.[0];
      if (!route) return Response.json({ error: "No route found" }, { status: 404 });
      return Response.json({ distance: Math.round(route.distance) });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});