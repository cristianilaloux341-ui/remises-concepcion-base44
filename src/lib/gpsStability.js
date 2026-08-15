// Filtro conservador compartido para todas las lecturas GPS del chofer.
const MAX_ACCURACY_METERS = 80;
const MAX_SAMPLE_AGE_MS = 30_000;
const MAX_SPEED_KMH = 180;
const MAX_JUMP_METERS = 1_000;

function distanceMeters(a, b) {
  const R = 6_371_000;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLng = (b.longitude - a.longitude) * Math.PI / 180;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function normalizeGpsLocation(raw) {
  if (!raw) return null;
  const coords = raw.coords || raw;
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const accuracyValue = Number(coords.accuracy);
  const speedValue = Number(coords.speed);
  let timestamp = Number(raw.timestamp ?? raw.time ?? coords.timestamp ?? Date.now());
  if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < 1e12) timestamp *= 1000;

  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracyValue) && accuracyValue >= 0 ? accuracyValue : null,
    speed: Number.isFinite(speedValue) && speedValue >= 0 ? speedValue : null,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
  };
}

export function createGpsStabilityFilter() {
  let lastGood = null;

  return {
    reset() {
      lastGood = null;
    },

    process(raw) {
      const point = normalizeGpsLocation(raw);
      if (!point) return { accepted: false, reason: "invalid" };

      const now = Date.now();
      if (point.timestamp > now + 10_000 || now - point.timestamp > MAX_SAMPLE_AGE_MS) {
        return { accepted: false, reason: "stale" };
      }
      if (point.accuracy !== null && point.accuracy > MAX_ACCURACY_METERS) {
        return { accepted: false, reason: "accuracy" };
      }

      if (!lastGood) {
        lastGood = point;
        return { accepted: true, point, distance: 0, moving: false, speedKmh: point.speed !== null ? point.speed * 3.6 : 0 };
      }

      const elapsedSeconds = Math.max(0.25, (point.timestamp - lastGood.timestamp) / 1000);
      const distance = distanceMeters(lastGood, point);
      const impliedSpeedKmh = (distance / elapsedSeconds) * 3.6;
      const reportedSpeedKmh = point.speed !== null ? point.speed * 3.6 : null;

      if (distance > MAX_JUMP_METERS || impliedSpeedKmh > MAX_SPEED_KMH || (reportedSpeedKmh !== null && reportedSpeedKmh > MAX_SPEED_KMH)) {
        return { accepted: false, reason: "jump" };
      }

      const effectiveSpeedKmh = reportedSpeedKmh !== null ? reportedSpeedKmh : impliedSpeedKmh;
      const combinedAccuracy = Math.max(lastGood.accuracy || 0, point.accuracy || 0);
      const driftRadius = Math.max(4, Math.min(12, combinedAccuracy * 0.25));
      const isDrift = effectiveSpeedKmh < 5 && distance <= driftRadius;
      const moving = !isDrift && effectiveSpeedKmh >= 5;

      lastGood = point;
      return {
        accepted: true,
        point,
        distance: moving ? distance : 0,
        rawDistance: distance,
        moving,
        speedKmh: effectiveSpeedKmh,
      };
    }
  };
}

export const GPS_LOCATION_EVENT = "remises:gps-location";
