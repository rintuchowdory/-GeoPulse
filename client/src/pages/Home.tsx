import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronDown,
  CircleDot,
  CloudSun,
  Copy,
  Crosshair,
  Droplets,
  ExternalLink,
  Layers3,
  LocateFixed,
  MapPin,
  Menu,
  MonitorDot,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Satellite,
  Share2,
  Shield,
  ShieldCheck,
  Smartphone,
  Thermometer,
  Trash2,
  Wifi,
  Wind,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import GeoMap, {
  type Flight,
  type MapFence,
  type MapPing,
  type Quake,
  type ViewBounds,
} from "@/components/GeoMap";
import {
  weatherCondition,
  windDirectionLabel,
  type WeatherNow,
} from "@/lib/weather";
import { absoluteLink, api, jsonBody } from "@/lib/api";

type Device = {
  id: number;
  name: string;
  ownerEmail: string;
  color: string;
  trackingCode: string;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy: number | null;
  lastSeen: string | null;
  battery: number | null;
  status: "active" | "idle" | "offline";
  sharingEnabled: boolean;
};
type Fence = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  deviceId: number | null;
  notifyOn: "enter" | "exit" | "both";
  lastInside: boolean | null;
};
type FenceEventRow = {
  event: {
    id: number;
    eventType: "enter" | "exit";
    recordedAt: string;
  };
  geofenceName: string;
  deviceName: string;
};
type LayerInfo = {
  on: boolean;
  count: number;
  updated: number | null;
  error: string;
  loading: boolean;
};
type DialogState = {
  kind: "create" | "rename" | "fence" | "fenceEdit" | "delete" | "share";
} | null;
const noLayer: LayerInfo = {
  on: false,
  count: 0,
  updated: null,
  error: "",
  loading: false,
};
const since = (date: string | null) => {
  if (!date) return "No signal";
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  );
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
};
const distanceKm = (a: number, b: number, c: number, d: number) => {
  const rad = (x: number) => (x * Math.PI) / 180;
  const p =
    Math.sin(rad(c - a) / 2) ** 2 +
    Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));
};
const layerLabel = (l: LayerInfo) =>
  l.error
    ? "Retrying"
    : l.loading
      ? "Syncing"
      : l.updated
        ? `Updated ${new Date(l.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
        : "Waiting for data";

function AuthGate({ loading, error }: { loading: boolean; error: string }) {
  const [configError, setConfigError] = useState("");
  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="brand-mark brand-mark-large">G</div>
        <p className="eyebrow">PERSONAL LOCATION INTELLIGENCE</p>
        <h1>
          Your world,
          <br />
          <em>in motion.</em>
        </h1>
        <p className="auth-copy">
          Securely track your devices, share a live view, and see what's moving
          above you.
        </p>
        {error && (
          <div className="auth-error">
            <AlertTriangle size={15} />
            {error}
          </div>
        )}
        <button
          className="primary-btn login-btn"
          disabled={loading}
          onClick={() => {
            try {
              startLogin();
            } catch (e) {
              setConfigError(
                e instanceof Error ? e.message : "Login could not start"
              );
            }
          }}
        >
          {loading ? <span className="spinner" /> : <Shield size={16} />}{" "}
          Continue with Manus
        </button>
        {configError && <p className="auth-error-text">{configError}</p>}
        <div className="auth-secure">
          <ShieldCheck size={13} /> Private to your account · Encrypted session
        </div>
        <div className="auth-decoration">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="auth-side">
        GEOPULSE <span>LIVE LOCATION SYSTEM</span>
      </div>
    </div>
  );
}

function Modal({
  title,
  subtitle,
  children,
  close,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <p className="eyebrow">GEOPULSE CONTROL</p>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const auth = useAuth();
  const user = auth.user;
  const [devices, setDevices] = useState<Device[]>([]);
  const [pings, setPings] = useState<Record<number, MapPing[]>>({});
  const [fences, setFences] = useState<Fence[]>([]);
  const [events, setEvents] = useState<FenceEventRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bounds, setBounds] = useState<ViewBounds | null>(null);
  const [activePane, setActivePane] = useState<"devices" | "fences">("devices");
  const [layersOpen, setLayersOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState("#48e0c1");
  const [formRadius, setFormRadius] = useState("250");
  const [formNotify, setFormNotify] = useState("enter");
  const [formFenceDevice, setFormFenceDevice] = useState("all");
  const [editingFenceId, setEditingFenceId] = useState<number | null>(null);
  const [editingFenceLocation, setEditingFenceLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [layers, setLayers] = useState({
    iss: { ...noLayer },
    quakes: { ...noLayer },
    flights: { ...noLayer },
    weather: { ...noLayer, on: true },
    fences: { ...noLayer, on: true },
  });
  const [iss, setIss] = useState<{ lat: number; lng: number } | null>(null);
  const [quakes, setQuakes] = useState<Quake[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [browserSharing, setBrowserSharing] = useState(false);
  const [trackingDevice, setTrackingDevice] = useState<Device | null>(null);
  const [shareLink, setShareLink] = useState("");
  const [shareToken, setShareToken] = useState("");
  const [shareExpiryHours, setShareExpiryHours] = useState(24);
  const [ingestLink, setIngestLink] = useState("");
  const [localPosition, setLocalPosition] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );
  const [refreshClock, setRefreshClock] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const watchRef = useRef<number | null>(null);
  const lastPostRef = useRef(0);
  const lastFenceEventIdRef = useRef<number | null>(null);
  const flightCache = useRef(new Map<string, { at: number; rows: Flight[] }>());
  const weatherCache = useRef(
    new Map<string, { at: number; data: WeatherNow }>()
  );
  const selected = devices.find(d => d.id === selectedId) ?? null;
  const currentPings = selected ? (pings[selected.id] ?? []) : [];
  const currentWeather = weather
    ? weatherCondition(weather.weatherCode)
    : null;

  const refreshDevices = useCallback(async () => {
    const result = await api<{ devices: Device[] }>("/api/devices");
    setDevices(result.devices);
    setSelectedId(old => old ?? result.devices[0]?.id ?? null);
  }, []);
  const refreshFences = useCallback(async () => {
    const result = await api<{ geofences: Fence[]; events: FenceEventRow[] }>(
      "/api/geofences"
    );
    setFences(result.geofences);
    setEvents(result.events);
    const newestId = result.events.reduce(
      (newest, row) => Math.max(newest, row.event.id),
      0
    );
    const lastId = lastFenceEventIdRef.current;
    if (lastId === null) {
      lastFenceEventIdRef.current = newestId;
      return;
    }
    const freshEvents = result.events
      .filter(row => row.event.id > lastId)
      .sort((a, b) => a.event.id - b.event.id);
    lastFenceEventIdRef.current = Math.max(lastId, newestId);
    for (const row of freshEvents) {
      const entering = row.event.eventType === "enter";
      const title = `${row.deviceName} ${entering ? "entered" : "exited"} ${row.geofenceName}`;
      toast(title, { duration: 8000 });
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          const notification = new Notification(
            entering ? "GeoPulse · Zone entry" : "GeoPulse · Zone exit",
            {
              body: `${row.deviceName} ${entering ? "entered" : "exited"} “${row.geofenceName}”.`,
              tag: `geofence-${row.event.id}`,
              icon: "/geopulse-mark.svg",
            }
          );
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        } catch {
          // The event remains visible in the in-app activity list.
        }
      }
    }
  }, []);
  const enableBrowserAlerts = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      toast.error("This browser does not support notifications");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted")
      toast.success("Browser alerts enabled for new geofence events");
    else
      toast.error(
        "Allow notifications in your browser settings to enable alerts"
      );
  };
  useEffect(() => {
    if (!user) return;
    let live = true;
    const load = () =>
      refreshDevices().catch(e => {
        if (live) toast.error(e.message);
      });
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [user, refreshDevices]);
  useEffect(() => {
    if (!user) return;
    void refreshFences().catch(e => toast.error(e.message));
    const timer = window.setInterval(() => {
      void refreshFences().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [user, refreshFences]);
  useEffect(() => {
    const t = window.setInterval(() => setRefreshClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!selectedId || !user) return;
    let active = true;
    const load = () =>
      api<{ pings: MapPing[] }>(`/api/devices/${selectedId}`)
        .then(r => {
          if (active) setPings(old => ({ ...old, [selectedId]: r.pings }));
        })
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedId, user]);

  // Three independent public data feeds; each has its own cadence and status clock.
  useEffect(() => {
    if (!layers.iss.on) return;
    let active = true;
    let controller: AbortController | null = null;
    const run = async () => {
      controller?.abort();
      controller = new AbortController();
      setLayers(x => ({ ...x, iss: { ...x.iss, loading: true, error: "" } }));
      try {
        const r = await fetch(
          "https://api.wheretheiss.at/v1/satellites/25544",
          { signal: controller.signal }
        );
        if (!r.ok) throw new Error(`ISS ${r.status}`);
        const d = await r.json();
        if (
          active &&
          Number.isFinite(d.latitude) &&
          Number.isFinite(d.longitude)
        ) {
          setIss({ lat: d.latitude, lng: d.longitude });
          setLayers(x => ({
            ...x,
            iss: {
              ...x.iss,
              count: 1,
              updated: Date.now(),
              loading: false,
              error: "",
            },
          }));
        }
      } catch (e) {
        if (active && (e as Error).name !== "AbortError")
          setLayers(x => ({
            ...x,
            iss: { ...x.iss, loading: false, error: "Feed unavailable" },
          }));
      }
    };
    void run();
    const t = window.setInterval(run, 5000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(t);
    };
  }, [layers.iss.on]);
  useEffect(() => {
    if (!layers.quakes.on) return;
    let active = true;
    let controller: AbortController | null = null;
    const run = async () => {
      controller?.abort();
      controller = new AbortController();
      setLayers(x => ({
        ...x,
        quakes: { ...x.quakes, loading: true, error: "" },
      }));
      try {
        const r = await fetch(
          "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
          { signal: controller.signal }
        );
        if (!r.ok) throw new Error(`USGS ${r.status}`);
        const d = await r.json();
        const rows: Quake[] = (d.features ?? []).map((f: any) => ({
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
          mag: f.properties.mag ?? 2.5,
          title: f.properties.place ?? "Earthquake",
        }));
        if (active) {
          setQuakes(rows);
          setLayers(x => ({
            ...x,
            quakes: {
              ...x.quakes,
              count: rows.length,
              updated: Date.now(),
              loading: false,
              error: "",
            },
          }));
        }
      } catch (e) {
        if (active && (e as Error).name !== "AbortError")
          setLayers(x => ({
            ...x,
            quakes: { ...x.quakes, loading: false, error: "Feed unavailable" },
          }));
      }
    };
    void run();
    const t = window.setInterval(run, 60000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(t);
    };
  }, [layers.quakes.on]);
  useEffect(() => {
    if (!layers.flights.on || !bounds) return;
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let failures = 0;
    const run = async () => {
      const rounded = [
        bounds.south,
        bounds.west,
        bounds.north,
        bounds.east,
      ].map(n => Math.round(n * 2) / 2);
      const key = rounded.join(",");
      const cached = flightCache.current.get(key);
      if (cached && Date.now() - cached.at < 30_000) {
        setFlights(cached.rows);
        setLayers(x => ({
          ...x,
          flights: {
            ...x.flights,
            count: cached.rows.length,
            updated: cached.at,
            loading: false,
            error: "",
          },
        }));
        timer = window.setTimeout(run, 30_000);
        return;
      }
      controller?.abort();
      controller = new AbortController();
      setLayers(x => ({
        ...x,
        flights: { ...x.flights, loading: true, error: "" },
      }));
      try {
        const [south, west, north, east] = rounded;
        const url = `https://opensky-network.org/api/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) throw new Error(`OpenSky ${r.status}`);
        const d = await r.json();
        const rows: Flight[] = (d.states ?? [])
          .filter(
            (s: any[]) =>
              Number.isFinite(s[5]) && Number.isFinite(s[6]) && !s[8]
          )
          .map((s: any[]) => ({
            callsign: String(s[1] ?? "").trim(),
            lat: s[6],
            lng: s[5],
            heading: typeof s[10] === "number" ? s[10] : null,
            altitude:
              typeof s[13] === "number"
                ? s[13]
                : typeof s[7] === "number"
                  ? s[7]
                  : null,
          }));
        flightCache.current.set(key, { at: Date.now(), rows });
        failures = 0;
        if (active) {
          setFlights(rows);
          setLayers(x => ({
            ...x,
            flights: {
              ...x.flights,
              count: rows.length,
              updated: Date.now(),
              loading: false,
              error: "",
            },
          }));
        }
        timer = window.setTimeout(run, 30_000);
      } catch (e) {
        if (!active || (e as Error).name === "AbortError") return;
        failures++;
        setLayers(x => ({
          ...x,
          flights: {
            ...x.flights,
            loading: false,
            error: "Rate limited · backing off",
          },
        }));
        timer = window.setTimeout(
          run,
          Math.min(300_000, 30_000 * 2 ** Math.min(failures, 4))
        );
      }
    };
    void run();
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [
    layers.flights.on,
    bounds?.north,
    bounds?.south,
    bounds?.east,
    bounds?.west,
  ]);

  useEffect(() => {
    if (!layers.weather.on || !bounds) return;
    let active = true;
    let debounceTimer: number;
    let refreshTimer: number | undefined;
    let controller: AbortController | null = null;
    const latitude = bounds.centerLat;
    const longitude = bounds.centerLng;
    const key = `${Math.round(latitude * 10) / 10},${Math.round(longitude * 10) / 10}`;

    const run = async () => {
      const cached = weatherCache.current.get(key);
      if (cached && Date.now() - cached.at < 4 * 60_000) {
        if (active) {
          setWeather({ ...cached.data, lat: latitude, lng: longitude });
          setLayers(old => ({
            ...old,
            weather: {
              ...old.weather,
              count: 1,
              updated: cached.at,
              loading: false,
              error: "",
            },
          }));
        }
        return;
      }

      controller?.abort();
      controller = new AbortController();
      setLayers(old => ({
        ...old,
        weather: { ...old.weather, loading: true, error: "" },
      }));
      try {
        const params = new URLSearchParams({
          latitude: latitude.toFixed(3),
          longitude: longitude.toFixed(3),
          current:
            "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
          temperature_unit: "celsius",
          wind_speed_unit: "kmh",
          precipitation_unit: "mm",
          timezone: "auto",
        });
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
        const payload = await response.json();
        const current = payload.current;
        const values = [
          current?.temperature_2m,
          current?.apparent_temperature,
          current?.relative_humidity_2m,
          current?.precipitation,
          current?.weather_code,
          current?.wind_speed_10m,
          current?.wind_direction_10m,
        ];
        if (
          !current ||
          values.some(value => typeof value !== "number" || !Number.isFinite(value))
        )
          throw new Error("Invalid weather response");

        const fetchedAt = Date.now();
        const data: WeatherNow = {
          lat: latitude,
          lng: longitude,
          temperature: current.temperature_2m,
          apparentTemperature: current.apparent_temperature,
          relativeHumidity: current.relative_humidity_2m,
          precipitation: current.precipitation,
          weatherCode: current.weather_code,
          windSpeed: current.wind_speed_10m,
          windDirection: current.wind_direction_10m,
          validAt: current.time,
          timezone: typeof payload.timezone === "string" ? payload.timezone : "UTC",
          fetchedAt,
        };
        weatherCache.current.set(key, { at: fetchedAt, data });
        if (active) {
          setWeather(data);
          setLayers(old => ({
            ...old,
            weather: {
              ...old.weather,
              count: 1,
              updated: fetchedAt,
              loading: false,
              error: "",
            },
          }));
        }
      } catch (error) {
        if (active && (error as Error).name !== "AbortError")
          setLayers(old => ({
            ...old,
            weather: {
              ...old.weather,
              loading: false,
              error: "Weather feed unavailable",
            },
          }));
      }
    };

    debounceTimer = window.setTimeout(() => {
      void run();
      refreshTimer = window.setInterval(() => void run(), 5 * 60_000);
    }, 650);
    return () => {
      active = false;
      controller?.abort();
      window.clearTimeout(debounceTimer);
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    };
  }, [layers.weather.on, bounds?.centerLat, bounds?.centerLng]);

  const toggleLayer = (key: "iss" | "quakes" | "flights" | "weather") =>
    setLayers(old => ({ ...old, [key]: { ...old[key], on: !old[key].on } }));
  const selectDevice = (id: number) => {
    setSelectedId(id);
    setShareOpen(false);
  };
  const createDevice = async () => {
    if (!formName.trim()) return;
    setBusy(true);
    try {
      const { device } = await api<{ device: Device }>("/api/devices", {
        method: "POST",
        body: jsonBody({ name: formName.trim(), color: formColor }),
      });
      await refreshDevices();
      setSelectedId(device.id);
      setDialog(null);
      setFormName("");
      toast.success("Device added");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const renameDevice = async () => {
    if (!selected || !formName.trim()) return;
    setBusy(true);
    try {
      await api(`/api/devices/${selected.id}`, {
        method: "PATCH",
        body: jsonBody({ name: formName.trim() }),
      });
      await refreshDevices();
      setDialog(null);
      toast.success("Device renamed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteDevice = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/api/devices/${selected.id}`, { method: "DELETE" });
      setSelectedId(null);
      setDialog(null);
      await refreshDevices();
      toast.success("Device deleted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const createShare = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api<{ token: string }>(
        `/api/devices/${selected.id}/share`,
        {
          method: "POST",
          body: jsonBody({ expires_in_hours: shareExpiryHours }),
        }
      );
      const path = `/share/${r.token}`;
      setShareToken(r.token);
      setShareLink(absoluteLink(path));
      setDialog({ kind: "share" });
      toast.success(`Share link ready · expires in ${shareExpiryHours} hours`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveFence = async () => {
    if (!formName.trim()) return;
    const lat =
        editingFenceLocation?.lat ?? bounds?.centerLat ?? localPosition?.lat,
      lng =
        editingFenceLocation?.lng ?? bounds?.centerLng ?? localPosition?.lng;
    if (lat === undefined || lng === undefined) {
      toast.error(
        "Move the map or share location first to choose a geofence center"
      );
      return;
    }
    setBusy(true);
    try {
      await api(
        editingFenceId ? `/api/geofences/${editingFenceId}` : "/api/geofences",
        {
          method: editingFenceId ? "PATCH" : "POST",
          body: jsonBody({
            name: formName.trim(),
            lat,
            lng,
            radius_m: Number(formRadius),
            device_id:
              formFenceDevice === "all" ? null : Number(formFenceDevice),
            notify_on: formNotify,
          }),
        }
      );
      await refreshFences();
      setFormName("");
      setEditingFenceId(null);
      setEditingFenceLocation(null);
      setDialog(null);
      toast.success(
        editingFenceId ? "Geofence updated" : "Geofence created at map center"
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const deleteFence = async (id: number) => {
    try {
      await api(`/api/geofences/${id}`, { method: "DELETE" });
      await refreshFences();
      toast.success("Geofence removed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const editFence = (fence: Fence) => {
    setEditingFenceId(fence.id);
    setEditingFenceLocation({ lat: fence.lat, lng: fence.lng });
    setFormName(fence.name);
    setFormRadius(String(fence.radiusM));
    setFormNotify(fence.notifyOn);
    setFormFenceDevice(
      fence.deviceId === null ? "all" : String(fence.deviceId)
    );
    setDialog({ kind: "fenceEdit" });
  };
  const removeShare = async (token: string) => {
    try {
      await api(`/api/share-links/${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      setShareLink("");
      setShareToken("");
      toast.success("Share revoked");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const stopSharing = useCallback(() => {
    if (watchRef.current !== null && navigator.geolocation)
      navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setBrowserSharing(false);
    setTrackingDevice(null);
  }, []);
  useEffect(
    () => () => {
      if (watchRef.current !== null && navigator.geolocation)
        navigator.geolocation.clearWatch(watchRef.current);
    },
    []
  );
  const startSharing = async () => {
    if (!navigator.geolocation) {
      toast.error("This browser does not support location access");
      return;
    }
    let d = selected;
    if (!d) {
      try {
        const result = await api<{ device: Device }>("/api/devices", {
          method: "POST",
          body: jsonBody({ name: "My location", color: "#48e0c1" }),
        });
        d = result.device;
        await refreshDevices();
        setSelectedId(d.id);
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }
    if (!d) return;
    try {
      const share = await api<{ token: string }>(`/api/devices/${d.id}/share`, {
        method: "POST",
        body: jsonBody({ expires_in_hours: shareExpiryHours }),
      });
      const publicPath = `/share/${share.token}`;
      setShareToken(share.token);
      setShareLink(absoluteLink(publicPath));
      setIngestLink(absoluteLink("/ingest"));
      setTrackingDevice(d);
      setShareOpen(true);
      lastPostRef.current = 0;
      watchRef.current = navigator.geolocation.watchPosition(
        async position => {
          const { latitude, longitude, accuracy, speed, heading } =
            position.coords;
          setLocalPosition({ lat: latitude, lng: longitude });
          if (Date.now() - lastPostRef.current < 10_000) return;
          lastPostRef.current = Date.now();
          let battery: number | null = null;
          try {
            const getBattery = (navigator as any).getBattery;
            if (getBattery) {
              const b = await getBattery();
              battery = Math.round(b.level * 100);
            }
          } catch {
            /* battery API is optional */
          }
          try {
            const result = await api<{
              geofence_events?: Array<{
                name: string;
                event: string;
                device: string;
              }>;
            }>("/ingest", {
              method: "POST",
              body: jsonBody({
                code: d!.trackingCode,
                lat: latitude,
                lng: longitude,
                acc: accuracy,
                speed: speed ?? null,
                heading,
                battery,
              }),
            });
            if (result.geofence_events?.length)
              void refreshFences().catch(() => {});
          } catch (e) {
            toast.error(`Location ping failed: ${(e as Error).message}`);
          }
        },
        error => toast.error(`Location permission: ${error.message}`),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
      setBrowserSharing(true);
      toast.success("Live sharing started");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sortedDevices = useMemo(
    () =>
      [...devices].sort(
        (a, b) =>
          new Date(b.lastSeen ?? 0).getTime() -
          new Date(a.lastSeen ?? 0).getTime()
      ),
    [devices]
  );
  const initialLoading = auth.loading;
  if (initialLoading)
    return (
      <div className="boot-screen">
        <span className="spinner" />
        Connecting to GeoPulse…
      </div>
    );
  if (!user)
    return <AuthGate loading={false} error={auth.error?.message ?? ""} />;
  const ownerName = user.name?.split(" ")[0] || "Operator";

  return (
    <main className="geo-shell">
      <GeoMap
        devices={devices}
        selectedId={selectedId}
        trails={pings}
        fences={fences as MapFence[]}
        iss={iss}
        quakes={quakes}
        flights={flights}
        weather={weather}
        layers={{
          iss: layers.iss.on,
          quakes: layers.quakes.on,
          flights: layers.flights.on,
          weather: layers.weather.on,
          fences: layers.fences.on,
        }}
        onDevice={selectDevice}
        onBounds={setBounds}
      />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">G</span>
          <span>
            GeoPulse<small>LIVE LOCATION</small>
          </span>
        </div>
        <div className="topbar-live">
          <span className="live-indicator" />
          <span>LIVE</span>
          <i />
          <span>
            {devices.length} {devices.length === 1 ? "DEVICE" : "DEVICES"}
          </span>
          <i />
          <span>
            {new Date(refreshClock).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
        <div className="topbar-actions">
          <button
            className={`top-action ${layersOpen ? "active" : ""}`}
            onClick={() => {
              setLayersOpen(v => !v);
              setShareOpen(false);
            }}
          >
            <Layers3 size={16} />
            <span>Layers</span>
            <span className="action-count">
              {
                [
                  layers.iss.on,
                  layers.quakes.on,
                  layers.flights.on,
                  layers.weather.on,
                ].filter(Boolean).length
              }
            </span>
          </button>
          <button
            className={`top-action ${shareOpen ? "active" : ""}`}
            onClick={() => {
              setShareOpen(v => !v);
              setLayersOpen(false);
            }}
          >
            <Radio size={16} />
            <span>Share location</span>
          </button>
          <div className="user-chip">
            <span className="user-avatar">
              {ownerName.slice(0, 1).toUpperCase()}
            </span>
            <span>{ownerName}</span>
            <button
              className="user-menu"
              onClick={() => void auth.logout()}
              title="Sign out"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenu(v => !v)}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>
      {mobileMenu && (
        <div className="mobile-menu">
          <button
            onClick={() => {
              setActivePane("devices");
              setMobileMenu(false);
            }}
          >
            Devices
          </button>
          <button
            onClick={() => {
              setActivePane("fences");
              setMobileMenu(false);
            }}
          >
            Geofences
          </button>
          <button
            onClick={() => {
              setLayersOpen(true);
              setMobileMenu(false);
            }}
          >
            Layers
          </button>
          <button
            onClick={() => {
              setShareOpen(true);
              setMobileMenu(false);
            }}
          >
            Share location
          </button>
        </div>
      )}

      <aside className="left-rail panel-glass">
        <div className="rail-tabs">
          <button
            onClick={() => setActivePane("devices")}
            className={activePane === "devices" ? "selected" : ""}
          >
            <Smartphone size={14} />
            DEVICES<span>{devices.length}</span>
          </button>
          <button
            onClick={() => setActivePane("fences")}
            className={activePane === "fences" ? "selected" : ""}
          >
            <CircleDot size={14} />
            GEOFENCES<span>{fences.length}</span>
          </button>
        </div>
        {activePane === "devices" ? (
          <>
            <div className="rail-section-head">
              <div>
                <p className="eyebrow">YOUR FLEET</p>
                <h2>
                  Devices{" "}
                  <span className="subtle-count">({devices.length})</span>
                </h2>
              </div>
              <button
                className="round-add"
                onClick={() => {
                  setFormName("");
                  setDialog({ kind: "create" });
                }}
                title="Add device"
              >
                <Plus size={16} />
              </button>
            </div>
            {devices.length === 0 ? (
              <div className="empty-fleet">
                <div className="empty-radar">
                  <span />
                  <span />
                  <span />
                  <i />
                </div>
                <strong>Your map is waiting</strong>
                <p>Add a device or start sharing this phone's location.</p>
                <button
                  className="small-primary"
                  onClick={() => {
                    setFormName("My phone");
                    setDialog({ kind: "create" });
                  }}
                >
                  <Plus size={14} />
                  Add first device
                </button>
              </div>
            ) : (
              <div className="device-list">
                {sortedDevices.map(d => {
                  const isSelected = d.id === selectedId;
                  const km =
                    bounds && d.lastLat !== null && d.lastLng !== null
                      ? distanceKm(
                          bounds.centerLat,
                          bounds.centerLng,
                          d.lastLat,
                          d.lastLng
                        )
                      : null;
                  return (
                    <button
                      key={d.id}
                      className={`device-row ${isSelected ? "is-selected" : ""}`}
                      onClick={() => selectDevice(d.id)}
                    >
                      <span
                        className={`device-row-marker ${d.status}`}
                        style={
                          {
                            "--device-color":
                              d.status === "active" ? d.color : "#77808c",
                          } as React.CSSProperties
                        }
                      >
                        <span />
                      </span>
                      <span className="device-row-info">
                        <span className="device-row-name">{d.name}</span>
                        <span className="device-row-meta">
                          {d.lastLat !== null
                            ? `${d.lastLat.toFixed(3)}°, ${d.lastLng?.toFixed(3)}°`
                            : "Awaiting first ping"}
                        </span>
                      </span>
                      <span className="device-row-right">
                        <span className={`status-pill ${d.status}`}>
                          {d.status}
                        </span>
                        <span>
                          {km !== null
                            ? `${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}`
                            : since(d.lastSeen)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selected && (
              <div className="rail-device-actions">
                <button
                  onClick={() => {
                    setFormName(selected.name);
                    setDialog({ kind: "rename" });
                  }}
                >
                  <Pencil size={13} />
                  Rename
                </button>
                <button onClick={() => void createShare()}>
                  <Share2 size={13} />
                  Share
                </button>
                <button
                  className="danger-action"
                  onClick={() => setDialog({ kind: "delete" })}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="rail-section-head">
              <div>
                <p className="eyebrow">ARRIVAL & DEPARTURE</p>
                <h2>
                  Geofences{" "}
                  <span className="subtle-count">({fences.length})</span>
                </h2>
              </div>
              <button
                className="round-add"
                onClick={() => {
                  setFormName("");
                  setFormNotify("enter");
                  setEditingFenceId(null);
                  setEditingFenceLocation(null);
                  setDialog({ kind: "fence" });
                }}
                title="Add geofence"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="fence-alert-controls">
              <div className="fence-alert-copy">
                <Bell size={14} />
                <span>
                  <b>Zone alerts</b>
                  <small>
                    {notificationPermission === "granted"
                      ? "Enabled · keep GeoPulse open"
                      : notificationPermission === "denied"
                        ? "Blocked in browser settings"
                        : notificationPermission === "unsupported"
                          ? "Browser notifications unavailable"
                          : "Enable alerts while GeoPulse is open"}
                  </small>
                </span>
              </div>
              <button
                className={`alarm-enable ${notificationPermission === "granted" ? "enabled" : ""}`}
                onClick={() => void enableBrowserAlerts()}
                disabled={notificationPermission !== "default"}
              >
                {notificationPermission === "granted" ? "ON" : "ENABLE"}
              </button>
            </div>
            <div className="fence-note">
              <CircleDot size={15} />
              <span>New boundary is centered on the map crosshair.</span>
            </div>
            <div className="fence-list">
              {fences.map(f => (
                <div className="fence-row" key={f.id}>
                  <span className="fence-dot" />
                  <div>
                    <b>{f.name}</b>
                    <small>
                      {f.radiusM >= 1000
                        ? `${(f.radiusM / 1000).toFixed(1)} km`
                        : `${Math.round(f.radiusM)} m`}{" "}
                      ·{" "}
                      {f.deviceId
                        ? (devices.find(d => d.id === f.deviceId)?.name ??
                          "device")
                        : "All devices"}
                    </small>
                    <span className="fence-rule-pill">
                      {f.notifyOn === "enter"
                        ? "ALERT · ON ENTRY"
                        : f.notifyOn === "exit"
                          ? "ALERT · ON EXIT"
                          : "ALERT · ENTRY + EXIT"}
                    </span>
                  </div>
                  <button
                    className="tiny-icon"
                    onClick={() => editFence(f)}
                    aria-label={`Edit ${f.name}`}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="tiny-icon"
                    onClick={() => void deleteFence(f.id)}
                    aria-label="Delete geofence"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              {!fences.length && (
                <div className="empty-mini">No boundaries set yet.</div>
              )}
            </div>
            <div className="rail-section-head event-head">
              <div>
                <p className="eyebrow">RECENT ACTIVITY</p>
                <h2>Events</h2>
              </div>
            </div>
            <div className="event-list">
              {events.slice(0, 7).map((row, i) => (
                <div className="event-row" key={`${row.event.id}-${i}`}>
                  <span className={`event-icon ${row.event.eventType}`}>
                    <MapPin size={12} />
                  </span>
                  <span>
                    <b>
                      {row.deviceName}{" "}
                      {row.event.eventType === "enter" ? "entered" : "exited"}
                    </b>
                    <small>
                      {row.geofenceName} · {since(row.event.recordedAt)}
                    </small>
                  </span>
                </div>
              ))}
              {!events.length && (
                <div className="empty-mini">
                  Geofence alerts will appear here.
                </div>
              )}
            </div>
          </>
        )}
        <div className="rail-bottom">
          <div className="system-status">
            <span className="status-dot active" />
            <span>All systems operational</span>
            <span className="mono">API · DB</span>
          </div>
          <div className="map-attribution-note">
            <MapPin size={12} /> CARTO Dark Matter · OpenStreetMap
          </div>
        </div>
      </aside>

      {layersOpen && (
        <section className="layers-panel panel-glass">
          <div className="floating-head">
            <div>
              <p className="eyebrow">LIVE DATA</p>
              <h2>Map layers</h2>
            </div>
            <button className="icon-btn" onClick={() => setLayersOpen(false)}>
              <X size={17} />
            </button>
          </div>
          <p className="panel-description">
            Independent feeds refresh on their own cadence.
          </p>
          {[
            {
              key: "iss" as const,
              icon: Satellite,
              label: "International Space Station",
              detail: "Position · every 5 sec",
              cadence: "5s",
            },
            {
              key: "quakes" as const,
              icon: Activity,
              label: "Earthquakes M2.5+",
              detail: "Last 24 hours · USGS",
              cadence: "60s",
            },
            {
              key: "flights" as const,
              icon: MonitorDot,
              label: "Live flights",
              detail: "Current map bounds · OpenSky",
              cadence: "30s",
            },
            {
              key: "weather" as const,
              icon: CloudSun,
              label: "Weather at map center",
              detail: "Current model · Open-Meteo",
              cadence: "5m",
            },
          ].map(({ key, icon: Icon, label, detail, cadence }) => {
            const info = layers[key];
            return (
              <div
                className={`layer-row ${info.on ? "enabled" : ""} ${key === "weather" ? "weather-row" : ""}`}
                key={key}
              >
                <div className="layer-icon">
                  <Icon size={17} />
                </div>
                <div className="layer-info">
                  <b>{label}</b>
                  <span>{detail}</span>
                  <small className={info.error ? "layer-error" : ""}>
                    {info.error || layerLabel(info)}
                  </small>
                </div>
                <div className="layer-count">
                  <b>{info.count.toLocaleString()}</b>
                  <span>{cadence}</span>
                </div>
                <button
                  className={`toggle ${info.on ? "on" : ""}`}
                  onClick={() => toggleLayer(key)}
                  aria-label={`Toggle ${label}`}
                  aria-pressed={info.on}
                >
                  <span />
                </button>
              </div>
            );
          })}
          {layers.weather.on && (
            <div className="weather-snapshot" role="status" aria-live="polite">
              <div className="weather-snapshot-head">
                <span>
                  <CloudSun size={12} /> Center conditions
                </span>
                <small>15-MIN MODEL</small>
              </div>
              {weather && currentWeather ? (
                <>
                  <div
                    className={`weather-snapshot-glyph weather-${currentWeather.kind}`}
                    aria-hidden="true"
                  >
                    {currentWeather.glyph}
                  </div>
                  <div className="weather-snapshot-reading">
                    <strong>{Math.round(weather.temperature)}°</strong>
                    <span>{currentWeather.label}</span>
                  </div>
                  <div className="weather-snapshot-metrics">
                    <span>
                      <Thermometer size={12} /> Feels like
                      <b>{Math.round(weather.apparentTemperature)}°</b>
                    </span>
                    <span>
                      <Droplets size={12} /> Precipitation
                      <b>{weather.precipitation.toFixed(1)} mm</b>
                    </span>
                    <span>
                      <Wind size={12} /> Wind
                      <b>
                        {Math.round(weather.windSpeed)} km/h {windDirectionLabel(weather.windDirection)}
                      </b>
                    </span>
                    <span>
                      <CloudSun size={12} /> Humidity
                      <b>{Math.round(weather.relativeHumidity)}%</b>
                    </span>
                  </div>
                  <div className="weather-snapshot-foot">
                    <a
                      className="weather-source"
                      href="https://open-meteo.com/en/licence"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open-Meteo · CC BY 4.0
                    </a>
                    <span>
                      Model {weather.validAt.slice(11, 16)} {weather.timezone}
                    </span>
                  </div>
                </>
              ) : (
                <div className="weather-snapshot-wait">
                  <span className="spinner" />
                  <span>
                    {layers.weather.error ||
                      (layers.weather.loading
                        ? "Syncing map-center weather…"
                        : "Waiting for map location")}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="layer-footnote">
            <Wifi size={13} /> Public endpoints · no API key
          </div>
        </section>
      )}

      {shareOpen && (
        <section className="share-panel panel-glass">
          <div className="floating-head">
            <div>
              <p className="eyebrow">LOCATION BROADCAST</p>
              <h2>Share my location</h2>
            </div>
            <button className="icon-btn" onClick={() => setShareOpen(false)}>
              <X size={17} />
            </button>
          </div>
          <p className="panel-description">
            Send secure location pings from this browser while the tab stays
            open.
          </p>
          <div className="share-expiry-row">
            <label htmlFor="share-expiry">SHARE LINK EXPIRES</label>
            <select
              id="share-expiry"
              value={shareExpiryHours}
              onChange={e => setShareExpiryHours(Number(e.target.value))}
            >
              <option value={1}>1 hour</option>
              <option value={6}>6 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
              <option value={720}>30 days</option>
            </select>
          </div>
          {!browserSharing ? (
            <button
              className="primary-btn start-sharing"
              onClick={() => void startSharing()}
            >
              <Radio size={16} />
              Start sharing<span className="btn-arrow">→</span>
            </button>
          ) : (
            <button className="stop-sharing" onClick={stopSharing}>
              <span className="live-indicator" />
              Sharing live · tap to stop
            </button>
          )}
          {trackingDevice && (
            <div className="share-device-card">
              <div className="share-device-name">
                <span
                  className="device-swatch"
                  style={{ background: trackingDevice.color }}
                />
                <div>
                  <b>{trackingDevice.name}</b>
                  <small>Broadcasting from this browser</small>
                </div>
                <span className="live-indicator" />
              </div>
              <label>TRACKING CODE</label>
              <div className="copy-field">
                <code>{trackingDevice.trackingCode}</code>
                <button
                  onClick={() =>
                    void copy(
                      trackingDevice!.trackingCode,
                      "Tracking code copied"
                    )
                  }
                >
                  <Copy size={14} />
                </button>
              </div>
              <label>PUBLIC SHARE LINK · EXPIRES IN {shareExpiryHours}H</label>
              <div className="copy-field url-field">
                <span>
                  {shareLink.replace(window.location.origin, "") ||
                    "Generating…"}
                </span>
                <button
                  onClick={() =>
                    shareLink && void copy(shareLink, "Share link copied")
                  }
                >
                  <Copy size={14} />
                </button>
              </div>
              <label>OWNTRACKS HTTP ENDPOINT</label>
              <div className="copy-field url-field">
                <span>{ingestLink || absoluteLink("/ingest")}</span>
                <button
                  onClick={() =>
                    void copy(
                      ingestLink || absoluteLink("/ingest"),
                      "Ingest endpoint copied"
                    )
                  }
                >
                  <Copy size={14} />
                </button>
              </div>
              <div className="share-hint">
                For OwnTracks HTTP mode, use HTTPS and set the tracking code as
                the HTTP Basic Auth username. Leave the password blank.
              </div>
            </div>
          )}
          {shareToken && (
            <button
              className="revoke-share"
              onClick={() => void removeShare(shareToken)}
            >
              <X size={12} /> Revoke public share link
            </button>
          )}
          <div className="privacy-note">
            <ShieldCheck size={14} />
            <span>
              Location stays private unless you create a share link. Stop
              sharing any time.
            </span>
          </div>
        </section>
      )}

      <div className="map-crosshair" title="Map center">
        <Crosshair size={14} />
      </div>
      <button
        className="locate-btn"
        title="Center on my location"
        onClick={() =>
          navigator.geolocation?.getCurrentPosition(
            pos => {
              setLocalPosition({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
              });
              toast.success("Current location acquired");
            },
            e => toast.error(e.message),
            { enableHighAccuracy: true }
          )
        }
      >
        <LocateFixed size={17} />
      </button>
      <div className="map-scale">
        <span />
        Map center{" "}
        {bounds
          ? `${bounds.centerLat.toFixed(3)}°, ${bounds.centerLng.toFixed(3)}°`
          : "—"}
      </div>

      {selected && (
        <section className="detail-card panel-glass">
          <div className="detail-top">
            <div className="device-heading">
              <span
                className="device-swatch"
                style={{ background: selected.color }}
              />
              <div>
                <h2>{selected.name}</h2>
                <p>
                  <span className={`status-dot ${selected.status}`} />
                  {selected.status === "active"
                    ? "Live now"
                    : selected.status === "idle"
                      ? "Idle"
                      : "Offline"}{" "}
                  <span className="detail-dot">·</span>{" "}
                  {since(selected.lastSeen)}
                </p>
              </div>
            </div>
            <button
              className="icon-btn detail-close"
              onClick={() => setSelectedId(null)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="device-metrics">
            <div>
              <span>ACCURACY</span>
              <b>
                {selected.lastAccuracy != null
                  ? `±${Math.round(selected.lastAccuracy)} m`
                  : "—"}
              </b>
            </div>
            <div>
              <span>SPEED</span>
              <b>
                {currentPings[0]?.speed != null
                  ? `${(currentPings[0].speed * 3.6).toFixed(1)} km/h`
                  : "—"}
              </b>
            </div>
            <div>
              <span>BATTERY</span>
              <b>{selected.battery != null ? `${selected.battery}%` : "—"}</b>
            </div>
          </div>
          <div className="detail-coordinate">
            <MapPin size={13} />
            {selected.lastLat !== null && selected.lastLng !== null
              ? `${selected.lastLat.toFixed(5)}, ${selected.lastLng.toFixed(5)}`
              : "Awaiting first location"}
            <span>{currentPings.length} pings</span>
          </div>
          {currentPings.length > 0 ? (
            <div className="ping-list">
              <div className="ping-list-head">
                <span>RECENT PINGS</span>
                <span>10 MAX</span>
              </div>
              {currentPings.slice(0, 10).map((p, i) => (
                <div className="ping-row" key={`${p.recordedAt}-${i}`}>
                  <span
                    className="ping-timeline"
                    style={{ opacity: 1 - i * 0.18 }}
                  />
                  <span>
                    {new Date(p.recordedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span>±{Math.round((p as any).accuracy ?? 0)} m</span>
                  <span>
                    {p.lat.toFixed(4)}°, {p.lng.toFixed(4)}°
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="no-pings">
              First location ping will appear here.
            </div>
          )}
          <div className="detail-actions">
            <button
              onClick={() => {
                setFormName(selected.name);
                setDialog({ kind: "rename" });
              }}
            >
              <Pencil size={13} />
              Edit device
            </button>
            <button onClick={() => void createShare()}>
              <Share2 size={13} />
              Create share link
            </button>
          </div>
        </section>
      )}

      <footer className="bottom-status">
        <span>
          <span className="live-indicator" />
          AUTO-REFRESH · 5 SEC
        </span>
        <span>
          <Radio size={12} /> SECURE CHANNEL
        </span>
        <span>
          <RefreshCw size={12} />{" "}
          {devices.length ? `${devices.length} tracked` : "No active devices"}
        </span>
      </footer>

      {dialog?.kind === "create" && (
        <Modal
          title="Add a device"
          subtitle="Create a tracking identity for a phone, vehicle, or tag."
          close={() => setDialog(null)}
        >
          <form
            className="modal-form"
            onSubmit={e => {
              e.preventDefault();
              void createDevice();
            }}
          >
            <label>DEVICE NAME</label>
            <input
              autoFocus
              maxLength={120}
              placeholder="e.g. My phone"
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />
            <label>MARKER COLOR</label>
            <div className="color-options">
              {[
                "#48e0c1",
                "#6c8cff",
                "#ff9b71",
                "#d98cff",
                "#f4c95d",
                "#54c6eb",
              ].map(color => (
                <button
                  type="button"
                  key={color}
                  className={formColor === color ? "chosen" : ""}
                  style={{ background: color }}
                  onClick={() => setFormColor(color)}
                />
              ))}
            </div>
            <div className="modal-note">
              <Radio size={14} /> A unique 6-character tracking code is
              generated automatically.
            </div>
            <button
              className="primary-btn modal-submit"
              disabled={busy || !formName.trim()}
            >
              {busy ? "Creating…" : "Create device"}
              <span>→</span>
            </button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "rename" && (
        <Modal
          title="Rename device"
          subtitle="This label appears on your map and shared view."
          close={() => setDialog(null)}
        >
          <form
            className="modal-form"
            onSubmit={e => {
              e.preventDefault();
              void renameDevice();
            }}
          >
            <label>DEVICE NAME</label>
            <input
              autoFocus
              maxLength={120}
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />
            <button
              className="primary-btn modal-submit"
              disabled={busy || !formName.trim()}
            >
              {busy ? "Saving…" : "Save changes"}
              <span>→</span>
            </button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "delete" && (
        <Modal
          title="Delete device?"
          subtitle={`“${selected?.name}” and all of its location history will be permanently removed.`}
          close={() => setDialog(null)}
        >
          <div className="confirm-actions">
            <button className="secondary-btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="danger-btn"
              disabled={busy}
              onClick={() => void deleteDevice()}
            >
              <Trash2 size={15} />
              Delete device
            </button>
          </div>
        </Modal>
      )}
      {(dialog?.kind === "fence" || dialog?.kind === "fenceEdit") && (
        <Modal
          title={
            dialog.kind === "fenceEdit" ? "Edit geofence" : "Create geofence"
          }
          subtitle={
            dialog.kind === "fenceEdit"
              ? "Update this boundary without changing its map position."
              : "Draw a circular boundary around the current map center."
          }
          close={() => setDialog(null)}
        >
          <form
            className="modal-form"
            onSubmit={e => {
              e.preventDefault();
              void saveFence();
            }}
          >
            <label>BOUNDARY NAME</label>
            <input
              autoFocus
              maxLength={120}
              placeholder="e.g. Home"
              value={formName}
              onChange={e => setFormName(e.target.value)}
            />
            <div className="form-grid">
              <div>
                <label>RADIUS (METERS)</label>
                <input
                  type="number"
                  min="25"
                  max="100000"
                  value={formRadius}
                  onChange={e => setFormRadius(e.target.value)}
                />
              </div>
              <div>
                <label>DEVICE</label>
                <select
                  value={formFenceDevice}
                  onChange={e => setFormFenceDevice(e.target.value)}
                >
                  <option value="all">All devices</option>
                  {devices.map(d => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label>ALARM RULE</label>
            <select
              value={formNotify}
              onChange={e => setFormNotify(e.target.value)}
            >
              <option value="enter">Alert when entering</option>
              <option value="both">Alert on entry and exit</option>
              <option value="exit">Alert when exiting</option>
            </select>
            <div className="modal-note">
              <Crosshair size={14} /> Center:{" "}
              {editingFenceLocation
                ? `${editingFenceLocation.lat.toFixed(4)}, ${editingFenceLocation.lng.toFixed(4)}`
                : bounds
                  ? `${bounds.centerLat.toFixed(4)}, ${bounds.centerLng.toFixed(4)}`
                  : "move the map to position boundary"}
            </div>
            <button
              className="primary-btn modal-submit"
              disabled={busy || !formName.trim()}
            >
              {busy
                ? "Saving…"
                : dialog.kind === "fenceEdit"
                  ? "Save boundary"
                  : "Create boundary"}
              <span>→</span>
            </button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "share" && (
        <Modal
          title="Share link created"
          subtitle={`${selected?.name ?? "Device"} · read-only access · expires in ${shareExpiryHours} hours`}
          close={() => setDialog(null)}
        >
          <div className="share-created">
            <div className="share-link-display">
              <span>{shareLink}</span>
              <button onClick={() => void copy(shareLink, "Share link copied")}>
                <Copy size={15} />
                Copy
              </button>
            </div>
            <div className="modal-note">
              <ShieldCheck size={14} /> This link shows exactly one device and
              can be revoked at any time.
            </div>
            <button
              className="secondary-btn full-width"
              onClick={() => {
                window.open(shareLink, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink size={14} />
              Open shared view
            </button>
            {shareToken && (
              <button
                className="danger-btn full-width"
                onClick={() => {
                  void removeShare(shareToken);
                  setDialog(null);
                }}
              >
                <X size={14} /> Revoke share link
              </button>
            )}
          </div>
        </Modal>
      )}
    </main>
  );
}
