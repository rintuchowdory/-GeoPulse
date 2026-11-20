import { useEffect, useRef } from "react";
import L from "leaflet";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { weatherCondition, type WeatherNow } from "@/lib/weather";

setWorkerUrl(workerUrl);

export type MapDevice = {
  id: number;
  name: string;
  color: string;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy: number | null;
  lastSeen: string | Date | null;
  status: string;
};
export type MapPing = {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number | null;
  recordedAt: string | Date;
};
export type MapFence = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
};
export type Flight = {
  callsign: string;
  lat: number;
  lng: number;
  heading: number | null;
  altitude: number | null;
};
export type Quake = { lat: number; lng: number; mag: number; title: string };
export type ViewBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
  centerLat: number;
  centerLng: number;
};

type Props = {
  devices: MapDevice[];
  selectedId: number | null;
  trails: Record<number, MapPing[]>;
  fences: MapFence[];
  iss: { lat: number; lng: number; name?: string } | null;
  quakes: Quake[];
  flights: Flight[];
  weather: WeatherNow | null;
  layers: {
    iss: boolean;
    quakes: boolean;
    flights: boolean;
    weather: boolean;
    fences: boolean;
  };
  onDevice: (id: number) => void;
  onBounds: (bounds: ViewBounds) => void;
};
const escaped = (s: string) =>
  s.replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
const freshness = (lastSeen: MapDevice["lastSeen"]) =>
  lastSeen ? Date.now() - new Date(lastSeen).getTime() < 60_000 : false;

export default function GeoMap({
  devices,
  selectedId,
  trails,
  fences,
  iss,
  quakes,
  flights,
  weather,
  layers,
  onDevice,
  onBounds,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef({
    devices: L.layerGroup(),
    selected: L.layerGroup(),
    fences: L.layerGroup(),
    iss: L.layerGroup(),
    quakes: L.layerGroup(),
    flights: L.layerGroup(),
    weather: L.layerGroup(),
  });
  const boundsCallback = useRef(onBounds);
  boundsCallback.current = onBounds;
  const deviceCallback = useRef(onDevice);
  deviceCallback.current = onDevice;

  useEffect(() => {
    if (!host.current || mapRef.current) return;
    const map = L.map(host.current, {
      zoomControl: false,
      preferCanvas: true,
      minZoom: 2,
      maxBounds: [[180, -Infinity], [-180, Infinity]],
      maxBoundsViscosity: 1,
    }).setView([25, 4], 2);
    mapRef.current = map;
    maplibreGL({ style: "https://tiles.openfreemap.org/styles/dark" }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    Object.values(layerRef.current).forEach(group => group.addTo(map));
    const emitBounds = () => {
      const b = map.getBounds(),
        c = map.getCenter();
      boundsCallback.current({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
        centerLat: c.lat,
        centerLng: c.lng,
      });
    };
    map.on("moveend", emitBounds);
    map.whenReady(emitBounds);
    return () => {
      map.off("moveend", emitBounds);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const group = layerRef.current.devices;
    group.clearLayers();
    for (const d of devices) {
      if (d.lastLat === null || d.lastLng === null) continue;
      const live = d.status === "active" && freshness(d.lastSeen);
      const color = live ? d.color : "#77808c";
      const icon = L.divIcon({
        className: "device-icon-wrap",
        html: `<div class="device-pin ${live ? "is-live" : "is-stale"}" style="--pin:${color}"><span></span></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      L.marker([d.lastLat, d.lastLng], {
        icon,
        title: d.name,
        zIndexOffset: live ? 900 : 400,
      })
        .on("click", () => deviceCallback.current(d.id))
        .addTo(group);
    }
  }, [devices]);

  useEffect(() => {
    const group = layerRef.current.selected;
    group.clearLayers();
    if (!selectedId) return;
    const pings = (trails[selectedId] ?? []).slice().reverse();
    for (let i = 1; i < pings.length; i++) {
      const opacity = 0.12 + (i / pings.length) * 0.68;
      L.polyline(
        [
          [pings[i - 1].lat, pings[i - 1].lng],
          [pings[i].lat, pings[i].lng],
        ],
        { color: "#48e0c1", opacity, weight: 3, lineCap: "round" }
      ).addTo(group);
    }
  }, [selectedId, trails]);

  useEffect(() => {
    const group = layerRef.current.fences;
    group.clearLayers();
    if (!layers.fences) return;
    for (const fence of fences)
      L.circle([fence.lat, fence.lng], {
        radius: fence.radiusM,
        color: "#b193ff",
        weight: 1.5,
        opacity: 0.75,
        fillColor: "#b193ff",
        fillOpacity: 0.08,
      })
        .bindTooltip(escaped(fence.name))
        .addTo(group);
  }, [fences, layers.fences]);

  useEffect(() => {
    const group = layerRef.current.iss;
    group.clearLayers();
    if (!layers.iss || !iss) return;
    const icon = L.divIcon({
      className: "iss-icon-wrap",
      html: '<span class="iss-icon">✦</span>',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    L.marker([iss.lat, iss.lng], { icon })
      .bindTooltip("ISS · Internationale Raumstation")
      .addTo(group);
  }, [iss, layers.iss]);

  useEffect(() => {
    const group = layerRef.current.quakes;
    group.clearLayers();
    if (!layers.quakes) return;
    for (const q of quakes)
      L.circleMarker([q.lat, q.lng], {
        radius: Math.max(4, Math.min(15, q.mag * 2.8)),
        color: "#ff9b71",
        weight: 1,
        fillColor: "#ff9b71",
        fillOpacity: 0.25,
      })
        .bindTooltip(`${escaped(q.title)} · M${q.mag.toFixed(1)}`)
        .addTo(group);
  }, [quakes, layers.quakes]);

  useEffect(() => {
    const group = layerRef.current.flights;
    group.clearLayers();
    if (!layers.flights) return;
    for (const f of flights) {
      const icon = L.divIcon({
        className: "flight-icon-wrap",
        html: `<span class="flight-icon" style="transform:rotate(${(f.heading ?? 0) - 45}deg)">➤</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([f.lat, f.lng], { icon, opacity: 0.88 })
        .bindTooltip(
          `${escaped(f.callsign || "Flug")}${f.altitude !== null ? ` · ${Math.round(f.altitude)} m` : ""}`
        )
        .addTo(group);
    }
  }, [flights, layers.flights]);

  useEffect(() => {
    const group = layerRef.current.weather;
    group.clearLayers();
    if (!layers.weather || !weather) return;
    const condition = weatherCondition(weather.weatherCode);
    const temperature = Math.round(weather.temperature);
    const icon = L.divIcon({
      className: "weather-icon-wrap",
      html: `<div class="weather-map-marker weather-${condition.kind}"><span class="weather-map-glyph">${condition.glyph}</span><span class="weather-map-temp">${temperature}°</span></div>`,
      iconSize: [72, 44],
      iconAnchor: [36, 22],
    });
    L.marker([weather.lat, weather.lng], {
      icon,
      zIndexOffset: 700,
      title: `Weather · ${condition.label} · ${temperature}°C`,
    })
      .bindTooltip(
        `${escaped(condition.label)} · ${temperature}°C · ${Math.round(weather.windSpeed)} km/h wind`
      )
      .addTo(group);
  }, [weather, layers.weather]);

  useEffect(() => {
    if (!selectedId) return;
    const d = devices.find(x => x.id === selectedId);
    if (
      d?.lastLat !== null &&
      d?.lastLat !== undefined &&
      d.lastLng !== null &&
      mapRef.current
    )
      mapRef.current.flyTo(
        [d.lastLat, d.lastLng],
        Math.max(mapRef.current.getZoom(), 12),
        { duration: 0.8 }
      );
  }, [selectedId]);
  return (
    <div className="map-canvas" ref={host} aria-label="GeoPulse Live-Karte" />
  );
}
