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

const driverIcon = new L.DivIcon({
  html: '<div style="background:#3b82f6;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;">🚗</div>',
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [bounds, map]);
  return null;
}

export default function RideMap({ orders = [], drivers = [], center, zoom = 13, className = "" }) {
  const defaultCenter = center || [-34.6037, -58.3816]; // Buenos Aires

  const allPoints = [];
  orders.forEach(o => {
    if (o.pickup_lat && o.pickup_lng) allPoints.push([o.pickup_lat, o.pickup_lng]);
    if (o.dropoff_lat && o.dropoff_lng) allPoints.push([o.dropoff_lat, o.dropoff_lng]);
  });
  drivers.forEach(d => {
    if (d.current_lat && d.current_lng) allPoints.push([d.current_lat, d.current_lng]);
  });

  return (
    <div className={`rounded-xl overflow-hidden border ${className}`} style={{ height: "100%", minHeight: 400 }}>
      <MapContainer
        center={defaultCenter}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {allPoints.length > 1 && <FitBounds bounds={allPoints} />}

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

        {drivers.map((driver) =>
          driver.current_lat && driver.current_lng ? (
            <Marker key={driver.id} position={[driver.current_lat, driver.current_lng]} icon={driverIcon}>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{driver.name}</p>
                  <p className="text-gray-600">{driver.vehicle_model} · {driver.vehicle_plate}</p>
                  <p className="text-gray-500 capitalize">{driver.status?.replace("_", " ")}</p>
                </div>
              </Popup>
            </Marker>
          ) : null
        )}
      </MapContainer>
    </div>
  );
}