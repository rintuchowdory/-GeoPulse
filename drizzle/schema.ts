import {
  boolean,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const devices = mysqlTable(
  "devices",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    ownerEmail: varchar("owner_email", { length: 320 }).notNull(),
    color: varchar("color", { length: 16 }).notNull().default("#48e0c1"),
    trackingCode: varchar("tracking_code", { length: 6 }).notNull(),
    lastLat: double("last_lat"),
    lastLng: double("last_lng"),
    lastAccuracy: double("last_accuracy"),
    lastSeen: timestamp("last_seen"),
    battery: int("battery"),
    status: mysqlEnum("status", ["active", "idle", "offline"])
      .notNull()
      .default("offline"),
    sharingEnabled: boolean("sharing_enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerSeenIdx: index("devices_owner_seen_idx").on(
      table.ownerEmail,
      table.lastSeen
    ),
    trackingCodeIdx: uniqueIndex("devices_tracking_code_idx").on(
      table.trackingCode
    ),
  })
);

export const locationPings = mysqlTable(
  "location_pings",
  {
    id: int("id").autoincrement().primaryKey(),
    deviceId: int("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    lat: double("lat").notNull(),
    lng: double("lng").notNull(),
    accuracy: double("accuracy").notNull(),
    speed: double("speed"),
    heading: double("heading"),
    source: mysqlEnum("source", ["gps", "owntracks", "network"])
      .notNull()
      .default("gps"),
    recordedAt: timestamp("recorded_at").notNull(),
    flagged: boolean("flagged").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    deviceRecordedIdx: index("pings_device_recorded_idx").on(
      table.deviceId,
      table.recordedAt
    ),
  })
);

export const geofences = mysqlTable(
  "geofences",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerEmail: varchar("owner_email", { length: 320 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    lat: double("lat").notNull(),
    lng: double("lng").notNull(),
    radiusM: double("radius_m").notNull(),
    deviceId: int("device_id").references(() => devices.id, {
      onDelete: "cascade",
    }),
    notifyOn: mysqlEnum("notify_on", ["enter", "exit", "both"])
      .notNull()
      .default("both"),
    lastInside: boolean("last_inside"),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdx: index("geofences_owner_idx").on(table.ownerEmail),
  })
);

export const shareLinks = mysqlTable(
  "share_links",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    deviceId: int("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({ deviceIdx: index("share_device_idx").on(table.deviceId) })
);

export const geofenceEvents = mysqlTable(
  "geofence_events",
  {
    id: int("id").autoincrement().primaryKey(),
    geofenceId: int("geofence_id")
      .notNull()
      .references(() => geofences.id, { onDelete: "cascade" }),
    deviceId: int("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    eventType: mysqlEnum("event_type", ["enter", "exit"]).notNull(),
    recordedAt: timestamp("recorded_at").notNull(),
  },
  table => ({
    ownerReadIdx: index("geofence_events_device_time_idx").on(
      table.deviceId,
      table.recordedAt
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type LocationPing = typeof locationPings.$inferSelect;
export type Geofence = typeof geofences.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
