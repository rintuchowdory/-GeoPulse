import { customAlphabet, nanoid } from "nanoid";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import {
  devices,
  geofenceEvents,
  geofences,
  locationPings,
  shareLinks,
} from "../drizzle/schema";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";

const trackingCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const MAX_AGE_MS = 5 * 60_000;
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const palette = [
  "#48e0c1",
  "#6c8cff",
  "#ff9b71",
  "#d98cff",
  "#f4c95d",
  "#54c6eb",
];

type Handler = (req: Request, res: Response) => Promise<void>;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
const endpoint = (handler: Handler) => async (req: Request, res: Response) => {
  try {
    await handler(req, res);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error("[GeoPulse]", error);
    res.status(status).json({
      error:
        error instanceof HttpError ? error.message : "Interner Serverfehler",
    });
  }
};
const requireDb = async () => {
  const db = await getDb();
  if (!db) throw new HttpError(503, "Datenbank ist nicht verfügbar");
  return db;
};
const sameOriginMutation = (req: Request) => {
  const origin = req.get("origin");
  if (req.method === "GET" || !origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = (req.get("x-forwarded-host") ?? req.get("host") ?? "")
      .split(",")[0]
      .trim();
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
};
const ownerEmail = async (req: Request, res: Response) => {
  if (!sameOriginMutation(req)) {
    res.status(403).json({ error: "Cross-origin mutation rejected." });
    return null;
  }
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.email) {
      res.status(403).json({
        error: "Für GeoPulse wird ein Konto mit E-Mail-Adresse benötigt.",
      });
      return null;
    }
    return user.email.toLowerCase();
  } catch {
    res
      .status(401)
      .json({ error: "Bitte anmelden, um GeoPulse zu verwenden." });
    return null;
  }
};
const asId = (value: string) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new HttpError(400, "Ungültige ID");
  return id;
};
const validPoint = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" &&
  Number.isFinite(lat) &&
  lat >= -90 &&
  lat <= 90 &&
  typeof lng === "number" &&
  Number.isFinite(lng) &&
  lng >= -180 &&
  lng <= 180;
const validName = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.trim().length <= 120;
const distanceM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(lat2 - lat1),
    dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
const statusFor = (lastSeen: Date | null) =>
  !lastSeen
    ? "offline"
    : Date.now() - lastSeen.getTime() <= 60_000
      ? "active"
      : Date.now() - lastSeen.getTime() <= 5 * 60_000
        ? "idle"
        : "offline";
const trimPings = async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(locationPings)
    .where(lt(locationPings.recordedAt, new Date(Date.now() - RETENTION_MS)));
};

export function registerGeoPulseRoutes(app: Express) {
  const maintenance = setInterval(() => {
    void trimPings().catch(e =>
      console.error("[GeoPulse] Retention cleanup failed", e)
    );
  }, 60 * 60_000);
  maintenance.unref();

  app.get(
    "/api/devices",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb();
      const rows = await db
        .select()
        .from(devices)
        .where(eq(devices.ownerEmail, email))
        .orderBy(desc(devices.lastSeen));
      const normalized = rows.map(d => ({
        ...d,
        status: statusFor(d.lastSeen),
      }));
      res.json({ devices: normalized });
    })
  );

  app.post(
    "/api/devices",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const name = req.body?.name;
      if (!validName(name))
        throw new HttpError(400, "Name muss 1–120 Zeichen lang sein.");
      const db = await requireDb();
      let code = trackingCode();
      for (let attempt = 0; attempt < 5; attempt++) {
        const [existing] = await db
          .select({ id: devices.id })
          .from(devices)
          .where(eq(devices.trackingCode, code))
          .limit(1);
        if (!existing) break;
        code = trackingCode();
      }
      const color =
        typeof req.body.color === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(req.body.color)
          ? req.body.color
          : palette[Math.floor(Math.random() * palette.length)];
      const result = await db.insert(devices).values({
        name: name.trim(),
        ownerEmail: email,
        color,
        trackingCode: code,
        status: "offline",
        sharingEnabled: true,
      });
      const id = Number(result[0].insertId);
      const [device] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, id))
        .limit(1);
      res.status(201).json({ device });
    })
  );

  app.get(
    "/api/devices/:id",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb(),
        id = asId(req.params.id);
      const [device] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.ownerEmail, email)))
        .limit(1);
      if (!device) throw new HttpError(404, "Gerät nicht gefunden");
      const pings = await db
        .select()
        .from(locationPings)
        .where(
          and(eq(locationPings.deviceId, id), eq(locationPings.flagged, false))
        )
        .orderBy(desc(locationPings.recordedAt))
        .limit(10);
      const links = await db
        .select()
        .from(shareLinks)
        .where(eq(shareLinks.deviceId, id))
        .orderBy(desc(shareLinks.createdAt));
      res.json({
        device: { ...device, status: statusFor(device.lastSeen) },
        pings,
        shareLinks: links,
      });
    })
  );

  app.patch(
    "/api/devices/:id",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb(),
        id = asId(req.params.id);
      const [device] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.ownerEmail, email)))
        .limit(1);
      if (!device) throw new HttpError(404, "Gerät nicht gefunden");
      const update: Partial<typeof devices.$inferInsert> = {};
      if (req.body?.name !== undefined) {
        if (!validName(req.body.name))
          throw new HttpError(400, "Ungültiger Gerätename");
        update.name = req.body.name.trim();
      }
      if (req.body?.color !== undefined) {
        if (
          typeof req.body.color !== "string" ||
          !/^#[0-9a-fA-F]{6}$/.test(req.body.color)
        )
          throw new HttpError(400, "Ungültige Gerätefarbe");
        update.color = req.body.color;
      }
      if (req.body?.sharing_enabled !== undefined) {
        if (typeof req.body.sharing_enabled !== "boolean")
          throw new HttpError(400, "sharing_enabled muss boolean sein");
        update.sharingEnabled = req.body.sharing_enabled;
      }
      if (!Object.keys(update).length)
        throw new HttpError(400, "Keine Änderungen angegeben");
      await db.update(devices).set(update).where(eq(devices.id, id));
      const [updated] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, id))
        .limit(1);
      res.json({ device: updated });
    })
  );

  app.delete(
    "/api/devices/:id",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb(),
        id = asId(req.params.id);
      const result = await db
        .delete(devices)
        .where(and(eq(devices.id, id), eq(devices.ownerEmail, email)));
      if (!result[0].affectedRows)
        throw new HttpError(404, "Gerät nicht gefunden");
      res.json({ success: true });
    })
  );

  app.post(
    "/api/devices/:id/share",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb(),
        id = asId(req.params.id);
      const [device] = await db
        .select()
        .from(devices)
        .where(and(eq(devices.id, id), eq(devices.ownerEmail, email)))
        .limit(1);
      if (!device) throw new HttpError(404, "Gerät nicht gefunden");
      const hours = Number(req.body?.expires_in_hours ?? 24);
      if (![1, 6, 24, 72, 168, 720].includes(hours))
        throw new HttpError(400, "Ungültige Laufzeit");
      const token = nanoid(40),
        expiresAt = new Date(Date.now() + hours * 60 * 60_000);
      await db
        .insert(shareLinks)
        .values({ token, deviceId: id, expiresAt, revoked: false });
      await db
        .update(devices)
        .set({ sharingEnabled: true })
        .where(eq(devices.id, id));
      res.status(201).json({ token, expires_at: expiresAt });
    })
  );

  app.delete(
    "/api/share-links/:token",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb();
      const [link] = await db
        .select({ token: shareLinks.token })
        .from(shareLinks)
        .innerJoin(devices, eq(shareLinks.deviceId, devices.id))
        .where(
          and(
            eq(shareLinks.token, req.params.token),
            eq(devices.ownerEmail, email)
          )
        )
        .limit(1);
      if (!link) throw new HttpError(404, "Freigabe nicht gefunden");
      await db
        .update(shareLinks)
        .set({ revoked: true })
        .where(eq(shareLinks.token, link.token));
      res.json({ success: true });
    })
  );

  app.get(
    "/api/share/:token",
    endpoint(async (req, res) => {
      const db = await requireDb();
      const [row] = await db
        .select({ link: shareLinks, device: devices })
        .from(shareLinks)
        .innerJoin(devices, eq(shareLinks.deviceId, devices.id))
        .where(eq(shareLinks.token, req.params.token))
        .limit(1);
      if (
        !row ||
        row.link.revoked ||
        row.link.expiresAt.getTime() <= Date.now() ||
        !row.device.sharingEnabled
      )
        throw new HttpError(
          404,
          "Dieser Freigabelink ist abgelaufen oder wurde widerrufen."
        );
      const pings = await db
        .select()
        .from(locationPings)
        .where(
          and(
            eq(locationPings.deviceId, row.device.id),
            eq(locationPings.flagged, false)
          )
        )
        .orderBy(desc(locationPings.recordedAt))
        .limit(10);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        device: {
          id: row.device.id,
          name: row.device.name,
          color: row.device.color,
          lastLat: row.device.lastLat,
          lastLng: row.device.lastLng,
          lastAccuracy: row.device.lastAccuracy,
          lastSeen: row.device.lastSeen,
          battery: row.device.battery,
          status: statusFor(row.device.lastSeen),
        },
        pings,
      });
    })
  );

  app.get(
    "/api/geofences",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb();
      const [rows, events] = await Promise.all([
        db.select().from(geofences).where(eq(geofences.ownerEmail, email)),
        db
          .select({
            event: geofenceEvents,
            geofenceName: geofences.name,
            deviceName: devices.name,
          })
          .from(geofenceEvents)
          .innerJoin(geofences, eq(geofenceEvents.geofenceId, geofences.id))
          .innerJoin(devices, eq(geofenceEvents.deviceId, devices.id))
          .where(eq(geofences.ownerEmail, email))
          .orderBy(desc(geofenceEvents.recordedAt))
          .limit(20),
      ]);
      res.json({ geofences: rows, events });
    })
  );

  app.post(
    "/api/geofences",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const { name, lat, lng, radius_m, device_id, notify_on } = req.body ?? {};
      if (
        !validName(name) ||
        !validPoint(lat, lng) ||
        typeof radius_m !== "number" ||
        !Number.isFinite(radius_m) ||
        radius_m < 25 ||
        radius_m > 100_000 ||
        !["enter", "exit", "both"].includes(notify_on)
      )
        throw new HttpError(400, "Ungültige Geofence-Daten");
      const db = await requireDb();
      const deviceId =
        device_id === null || device_id === undefined || device_id === ""
          ? null
          : Number(device_id);
      if (deviceId !== null) {
        const [d] = await db
          .select({ id: devices.id })
          .from(devices)
          .where(and(eq(devices.id, deviceId), eq(devices.ownerEmail, email)))
          .limit(1);
        if (!d) throw new HttpError(404, "Gerät nicht gefunden");
      }
      const result = await db.insert(geofences).values({
        ownerEmail: email,
        name: name.trim(),
        lat,
        lng,
        radiusM: radius_m,
        deviceId,
        notifyOn: notify_on,
        lastInside: null,
      });
      const [created] = await db
        .select()
        .from(geofences)
        .where(eq(geofences.id, Number(result[0].insertId)))
        .limit(1);
      res.status(201).json({ geofence: created });
    })
  );

  app.patch(
    "/api/geofences/:id",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb(),
        id = asId(req.params.id);
      const [existing] = await db
        .select()
        .from(geofences)
        .where(and(eq(geofences.id, id), eq(geofences.ownerEmail, email)))
        .limit(1);
      if (!existing) throw new HttpError(404, "Geofence nicht gefunden");
      const b = req.body ?? {},
        update: Partial<typeof geofences.$inferInsert> = {};
      if (b.name !== undefined) {
        if (!validName(b.name)) throw new HttpError(400, "Ungültiger Name");
        update.name = b.name.trim();
      }
      if (b.lat !== undefined || b.lng !== undefined) {
        const lat = b.lat ?? existing.lat,
          lng = b.lng ?? existing.lng;
        if (!validPoint(lat, lng))
          throw new HttpError(400, "Ungültige Koordinaten");
        update.lat = lat;
        update.lng = lng;
      }
      if (b.radius_m !== undefined) {
        if (
          typeof b.radius_m !== "number" ||
          b.radius_m < 25 ||
          b.radius_m > 100_000
        )
          throw new HttpError(
            400,
            "Radius muss zwischen 25 m und 100 km liegen"
          );
        update.radiusM = b.radius_m;
      }
      if (b.notify_on !== undefined) {
        if (!["enter", "exit", "both"].includes(b.notify_on))
          throw new HttpError(400, "Ungültige Benachrichtigung");
        update.notifyOn = b.notify_on;
      }
      if (b.device_id !== undefined) {
        const deviceId = b.device_id === null ? null : Number(b.device_id);
        if (deviceId !== null) {
          const [d] = await db
            .select({ id: devices.id })
            .from(devices)
            .where(and(eq(devices.id, deviceId), eq(devices.ownerEmail, email)))
            .limit(1);
          if (!d) throw new HttpError(404, "Gerät nicht gefunden");
        }
        update.deviceId = deviceId;
      }
      await db.update(geofences).set(update).where(eq(geofences.id, id));
      const [updated] = await db
        .select()
        .from(geofences)
        .where(eq(geofences.id, id))
        .limit(1);
      res.json({ geofence: updated });
    })
  );

  app.delete(
    "/api/geofences/:id",
    endpoint(async (req, res) => {
      const email = await ownerEmail(req, res);
      if (!email) return;
      const db = await requireDb(),
        id = asId(req.params.id);
      const result = await db
        .delete(geofences)
        .where(and(eq(geofences.id, id), eq(geofences.ownerEmail, email)));
      if (!result[0].affectedRows)
        throw new HttpError(404, "Geofence nicht gefunden");
      res.json({ success: true });
    })
  );

  const ingest: Handler = async (req, res) => {
    const b = req.body ?? {};
    let basicCode: string | undefined;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Basic ")) {
      try {
        basicCode = Buffer.from(auth.slice(6), "base64")
          .toString("utf8")
          .split(":", 1)[0];
      } catch {
        /* malformed header */
      }
    }
    const code = String(
      b.code ??
        req.query.code ??
        req.header("x-tracking-code") ??
        basicCode ??
        ""
    ).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code))
      throw new HttpError(401, "Tracking-Code fehlt oder ist ungültig");
    const latValue = b.lat,
      lngValue = b.lng ?? b.lon;
    const lat = typeof latValue === "string" ? Number(latValue) : latValue;
    const lng = typeof lngValue === "string" ? Number(lngValue) : lngValue;
    const accRaw = b.acc ?? b.accuracy ?? 0,
      speedRaw = b.speed ?? b.vel ?? null,
      batteryRaw = b.battery ?? b.batt ?? null;
    const accuracy = Number(accRaw),
      speed = speedRaw === null || speedRaw === "" ? null : Number(speedRaw),
      battery =
        batteryRaw === null || batteryRaw === "" ? null : Number(batteryRaw);
    if (
      !validPoint(lat, lng) ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > 100_000 ||
      (speed !== null &&
        (!Number.isFinite(speed) || speed < 0 || speed > 500)) ||
      (battery !== null &&
        (!Number.isInteger(battery) || battery < 0 || battery > 100))
    )
      throw new HttpError(
        400,
        "Standort oder Messwerte außerhalb des gültigen Bereichs"
      );
    const timeInput = b.recorded_at ?? b.timestamp ?? b.tst;
    let recordedAt = new Date();
    if (timeInput !== undefined) {
      const parsed =
        typeof timeInput === "number"
          ? new Date(timeInput < 100_000_000_000 ? timeInput * 1000 : timeInput)
          : new Date(timeInput);
      if (Number.isNaN(parsed.getTime()))
        throw new HttpError(400, "Ungültiger Zeitstempel");
      recordedAt = parsed;
    }
    if (Date.now() - recordedAt.getTime() > MAX_AGE_MS)
      throw new HttpError(422, "Ping ist älter als 5 Minuten");
    if (recordedAt.getTime() > Date.now() + 60_000)
      throw new HttpError(422, "Ping-Zeitstempel liegt zu weit in der Zukunft");
    const db = await requireDb();
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.trackingCode, code))
      .limit(1);
    if (!device)
      throw new HttpError(404, "Kein Gerät zu diesem Tracking-Code gefunden");
    const advancesDevice =
      !device.lastSeen || recordedAt.getTime() > device.lastSeen.getTime();
    const recentPrevious =
      !!device.lastSeen &&
      recordedAt.getTime() - device.lastSeen.getTime() <= 60_000 &&
      recordedAt.getTime() >= device.lastSeen.getTime();
    const flagged =
      device.lastLat !== null &&
      device.lastLng !== null &&
      recentPrevious &&
      distanceM(device.lastLat, device.lastLng, lat, lng) > 500_000;
    const ownTracks =
      b._type === "location" ||
      b.lon !== undefined ||
      b.vel !== undefined ||
      b.tst !== undefined;
    const source = ["gps", "owntracks", "network"].includes(b.source)
      ? b.source
      : ownTracks
        ? "owntracks"
        : "gps";
    await db.insert(locationPings).values({
      deviceId: device.id,
      lat,
      lng,
      accuracy,
      speed,
      heading: Number.isFinite(Number(b.heading ?? b.cog))
        ? Number(b.heading ?? b.cog)
        : null,
      source,
      recordedAt,
      flagged,
    });
    const geofenceAlerts: Array<{
      id: number;
      name: string;
      event: string;
      device: string;
      recordedAt: Date;
    }> = [];
    if (!flagged && advancesDevice) {
      await db
        .update(devices)
        .set({
          lastLat: lat,
          lastLng: lng,
          lastAccuracy: accuracy,
          lastSeen: recordedAt,
          battery,
          status: statusFor(recordedAt),
        })
        .where(eq(devices.id, device.id));
      const fences = await db
        .select()
        .from(geofences)
        .where(
          and(
            eq(geofences.ownerEmail, device.ownerEmail),
            or(isNull(geofences.deviceId), eq(geofences.deviceId, device.id))
          )
        );
      for (const fence of fences) {
        const inside =
          distanceM(fence.lat, fence.lng, lat, lng) <= fence.radiusM;
        const wasInside =
          device.lastLat !== null &&
          device.lastLng !== null &&
          distanceM(fence.lat, fence.lng, device.lastLat, device.lastLng) <=
            fence.radiusM;
        if (inside !== wasInside) {
          await db
            .update(geofences)
            .set({ lastInside: inside })
            .where(eq(geofences.id, fence.id));
          const event = inside ? "enter" : "exit";
          if (fence.notifyOn === "both" || fence.notifyOn === event) {
            await db.insert(geofenceEvents).values({
              geofenceId: fence.id,
              deviceId: device.id,
              eventType: event,
              recordedAt,
            });
            geofenceAlerts.push({
              id: fence.id,
              name: fence.name,
              event,
              device: device.name,
              recordedAt,
            });
          }
        }
      }
    }
    await db
      .delete(locationPings)
      .where(
        and(
          eq(locationPings.deviceId, device.id),
          lt(locationPings.recordedAt, new Date(Date.now() - RETENTION_MS))
        )
      );
    res.status(201).json({
      success: true,
      flagged,
      plotted: !flagged,
      geofence_events: geofenceAlerts,
      device_id: device.id,
    });
  };
  app.post("/ingest", endpoint(ingest));
  app.post("/api/ingest", endpoint(ingest));
}
