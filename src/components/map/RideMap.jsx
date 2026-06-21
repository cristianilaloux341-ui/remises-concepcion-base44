import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import OrderStatusBadge from "../orders/OrderStatusBadge";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const centralIcon = new L.DivIcon({
  html: '<div style="background:#7c3aed;width:18px;height:18px;border-radius:4px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:10px;">🏢</div>',
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const pickupIcon = new L.DivIcon({
  html: '<div style="background:#22c55e;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const dropoffIcon = new L.DivIcon({
  html: '<div style="background:#ef4444;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Driver icons by status — color coded
function makeDriverIcon(status, name) {
  const colors = {
    disponible:    { bg: "#22c55e", border: "#16a34a", label: "#166534" },
    en_viaje:      { bg: "#3b82f6", border: "#1d4ed8", label: "#1e3a8a" },
    no_disponible: { bg: "#94a3b8", border: "#64748b", label: "#475569" },
  };
  const c = colors[status] || colors.no_disponible;
  const shortName = (name || "?").split(" ")[0].substring(0, 8);
  return new L.DivIcon({
    html: `<div style="
      display:flex;flex-direction:column;align-items:center;gap:2px;
    ">
      <div style="
        background:${c.bg};
        border:2.5px solid ${c.border};
        border-radius:50%;
        width:32px;height:32px;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        font-size:16px;
      ">🚗</div>
      <div style="
        background:${c.bg};
        color:white;
        font-size:10px;font-weight:700;
        padding:1px 5px;border-radius:6px;
        white-space:nowrap;
        box-shadow:0 1px 4px rgba(0,0,0,0.25);
        border:1.5px solid ${c.border};
      ">${shortName}</div>
    </div>`,
    className: "",
    iconSize: [50, 50],
    iconAnchor: [25, 16],
    popupAnchor: [0, -20],
  });
}

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [bounds, map]);
  return null;
}

function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    // Forzar recálculo en móviles — inmediato + diferido para cubrir transiciones
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 200);
    const t2 = setTimeout(() => map.invalidateSize(), 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [map]);

  useEffect(() => {
    // Re-invalidar cuando la pestaña vuelve al frente (background → foreground)
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setTimeout(() => map.invalidateSize(), 300);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [map]);

  return null;
}

// Coordenadas de la central — Concepción del Uruguay, Entre Ríos
const CENTRAL = { lat: -32.4847, lng: -58.2378, nombre: "Central Remisería" };

// Coordenadas aproximadas de las bases para drivers sin GPS
const BASE_COORDS = {
  "1-Puerto":      { lat: -32.4796, lng: -58.2421 },
  "2-Plaza":       { lat: -32.4847, lng: -58.2378 },
  "3-Columna":     { lat: -32.4820, lng: -58.2340 },
  "4-Base":        { lat: -32.4865, lng: -58.2410 },
  "5-Cementerio":  { lat: -32.4900, lng: -58.2350 },
  "6-Díaz Vélez":  { lat: -32.4780, lng: -58.2300 },
  "7-Don Bosco":   { lat: -32.4830, lng: -58.2450 },
  "8-Monumento":   { lat: -32.4760, lng: -58.2390 },
};

export default function RideMap({ orders = [], drivers = [], center, zoom = 13, className = "" }) {
  const defaultCenter = center || [CENTRAL.lat, CENTRAL.lng];
  // No re-montamos el mapa en cada visibilitychange — InvalidateSize lo maneja

  const allPoints = [];
  orders.forEach(o => {
    if (o.pickup_lat && o.pickup_lng) allPoints.push([o.pickup_lat, o.pickup_lng]);
    if (o.dropoff_lat && o.dropoff_lng) allPoints.push([o.dropoff_lat, o.dropoff_lng]);
  });
  drivers.forEach(d => {
    if (d.current_lat && d.current_lng) allPoints.push([d.current_lat, d.current_lng]);
  });

  return (
    <div className={`rounded-xl overflow-hidden border ${className}`} style={{ height: "100%", minHeight: "260px" }}>
      <MapContainer
        center={defaultCenter}
        zoom={zoom}
        style={{ height: "100%", width: "100%", minHeight: "200px" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <InvalidateSize />
        {allPoints.length > 1 && <FitBounds bounds={allPoints} />}

        {/* Marcador fijo de la central */}
        <Marker position={[CENTRAL.lat, CENTRAL.lng]} icon={centralIcon}>
          <Popup>
            <div className="text-sm font-semibold">{CENTRAL.nombre}</div>
            <div className="text-xs text-gray-500">Concepción del Uruguay, Entre Ríos</div>
          </Popup>
        </Marker>

        {orders.map((order) => (
          <div key={order.id}>
            {order.pickup_lat && order.pickup_lng && (
              <Marker position={[order.pickup_lat, order.pickup_lng]} icon={pickupIcon}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{order.client_name}</p>
                    <p className="text-gray-600">Recogida: {order.pickup_address}</p>
                  </div>
                </Popup>
              </Marker>
            )}
            {order.dropoff_lat && order.dropoff_lng && (
              <Marker position={[order.dropoff_lat, order.dropoff_lng]} icon={dropoffIcon}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{order.client_name}</p>
                    <p className="text-gray-600">Destino: {order.dropoff_address}</p>
                  </div>
                </Popup>
              </Marker>
            )}
            {order.pickup_lat && order.pickup_lng && order.dropoff_lat && order.dropoff_lng && (
              <Polyline
                positions={[
                  [order.pickup_lat, order.pickup_lng],
                  [order.dropoff_lat, order.dropoff_lng],
                ]}
                color="#3b82f6"
                weight={3}
                opacity={0.6}
                dashArray="8 8"
              />
            )}
          </div>
        ))}

        {drivers.map((driver) => {
          const lat = driver.current_lat || BASE_COORDS[driver.current_base]?.lat;
          const lng = driver.current_lng || BASE_COORDS[driver.current_base]?.lng;
          if (!lat || !lng) return null;
          return (
            <Marker
              key={driver.id}
              position={[lat, lng]}
              icon={makeDriverIcon(driver.status, driver.name)}
            >
              <Popup>
                <div className="text-sm space-y-1 min-w-[140px]">
                  <p className="font-bold text-base">{driver.name}</p>
                  {driver.vehicle_model && <p className="text-gray-600">{driver.vehicle_model} · {driver.vehicle_color || ""}</p>}
                  <p className="text-gray-600 font-mono">{driver.vehicle_plate}</p>
                  <p className={`font-semibold capitalize ${
                    driver.status === "disponible" ? "text-green-600"
                    : driver.status === "en_viaje" ? "text-blue-600"
                    : "text-gray-500"
                  }`}>
                    {driver.status === "disponible" ? "🟢 Libre" : driver.status === "en_viaje" ? "🔵 En viaje" : "⚫ Fuera de servicio"}
                  </p>
                  {driver.current_base && <p className="text-gray-500 text-xs">📍 {driver.current_base}</p>}
                  {!driver.current_lat && driver.current_base && <p className="text-gray-400 text-xs">📌 Posición aproximada (base)</p>}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}