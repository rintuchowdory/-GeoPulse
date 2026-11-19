import { useEffect, useState } from "react";
import { MapPin, Radio, ShieldCheck } from "lucide-react";
import GeoMap, { type MapPing } from "@/components/GeoMap";
import { api } from "@/lib/api";

type SharedDevice = {
  id: number;
  name: string;
  color: string;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy: number | null;
  lastSeen: string | null;
  battery: number | null;
  status: string;
};
export default function ShareView({ token }: { token: string }) {
  const [data, setData] = useState<{
    device: SharedDevice;
    pings: MapPing[];
  } | null>(null);
  const [error, setError] = useState("");
  const [bounds, setBounds] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ device: SharedDevice; pings: MapPing[] }>(
        `/api/share/${encodeURIComponent(token)}`
      )
        .then(result => {
          if (alive) {
            setData(result);
            setError("");
          }
        })
        .catch(e => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [token]);
  if (error && !data)
    return (
      <div className="share-error">
        <div className="brand-mark">G</div>
        <strong>Freigabe nicht verfügbar</strong>
        <span>{error}</span>
      </div>
    );
  if (!data)
    return (
      <div className="share-error">
        <span className="spinner" />
        Freigabe wird geladen…
      </div>
    );
  const { device, pings } = data;
  return (
    <div className="geo-shell share-shell">
      <GeoMap
        devices={[device]}
        selectedId={device.id}
        trails={{ [device.id]: pings }}
        fences={[]}
        iss={null}
        quakes={[]}
        flights={[]}
        layers={{ iss: false, quakes: false, flights: false, fences: false }}
        onDevice={() => {}}
        onBounds={setBounds}
      />
      <div className="share-top">
        <a className="brand-lockup" href="/">
          <span className="brand-mark">G</span>
          <span>
            GeoPulse<small>LIVE LOCATION</small>
          </span>
        </a>
        <span className="share-readonly">
          <ShieldCheck size={13} /> Read-only link
        </span>
      </div>
      <section className="share-card">
        <div className="device-heading">
          <span
            className="device-swatch"
            style={{ background: device.color }}
          />
          <div>
            <h1>{device.name}</h1>
            <p>
              <span className={`status-dot ${device.status}`} />
              {device.status === "active"
                ? "Live"
                : device.status === "idle"
                  ? "Idle"
                  : "Offline"}
            </p>
          </div>
        </div>
        <div className="share-coord">
          <MapPin size={14} />
          {device.lastLat !== null && device.lastLng !== null
            ? `${device.lastLat.toFixed(5)}, ${device.lastLng.toFixed(5)}`
            : "Standort noch nicht verfügbar"}
        </div>
        <div className="device-metrics">
          <div>
            <span>ACCURACY</span>
            <b>
              {device.lastAccuracy != null
                ? `±${Math.round(device.lastAccuracy)} m`
                : "—"}
            </b>
          </div>
          <div>
            <span>BATTERY</span>
            <b>{device.battery != null ? `${device.battery}%` : "—"}</b>
          </div>
          <div>
            <span>UPDATED</span>
            <b>
              {device.lastSeen
                ? new Date(device.lastSeen).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "—"}
            </b>
          </div>
        </div>
        <div className="share-footer">
          <Radio size={13} /> Updates every 5 seconds
        </div>
      </section>
    </div>
  );
}
