# GeoPulse – Implementierungsplan

## Ziel und Architektur

GeoPulse wird als mobile-first React-/Tailwind-Web-App im bestehenden Manus-Projekt (React, Express, tRPC, Drizzle, MySQL) umgesetzt. Die Karte nutzt Leaflet mit dem dunklen OpenFreeMap-Vektorstil über MapLibre GL Leaflet, ohne API-Schlüssel; die Vite-Build-Ausgabe liefert den MapLibre-Worker mit aus. Geräte-, Ping-, Geofence- und Share-Link-Daten liegen persistent in der Managed-MySQL-Datenbank. Eigentümer-Routen basieren auf der vorhandenen Manus-Session und filtern zwingend nach `owner_email`; öffentliche Share-Routen sind ausschließlich tokengebunden und geben genau ein Gerät lesend frei. Der unabhängige `POST /ingest` akzeptiert das vereinbarte GeoPulse-JSON und OwnTracks-HTTP-Standortmeldungen. Externe ISS-, USGS- und OpenSky-Layer fragt der Browser unabhängig und in getrennten Intervallen ab.

## Umsetzung und Entscheidungen

- Drizzle-Schema und Migration für `devices`, `location_pings`, `geofences`, `share_links` sowie persistente Geofence-Ereignisse. Tracking-Codes sind eindeutige 6-Zeichen-Codes; Share-Token sind kryptographisch zufällig und Ablauf/Widerruf werden serverseitig geprüft.
- REST-Controller für geschützte Eigentümerverwaltung, öffentlichen `/api/share/:token`-Read-only-Datensatz, `/ingest`-POST, Ping-Aufbewahrung und Geofence-Übergänge. Standortwerte und Zeitstempel werden validiert; veraltete Pings werden zurückgewiesen. Sprünge über 500 km in höchstens 60 Sekunden werden gespeichert und als Ausreißer markiert, aber weder als letzter Geräteort gesetzt noch in Abfragen/Spuren geplottet. Alte Pings werden stündlich sowie beim Ingest bereinigt.
- Geofence-Alarmregeln speichern Eintritt, Austritt oder beide Übergänge pro Zone. Neue Zonen verwenden „Eintritt“ als Voreinstellung; das Owner-Dashboard pollt Ereignisse alle 15 s, zeigt neue OwnTracks- und Browser-Übergänge im Feed und als In-App-/Browsermeldung. Browser-Benachrichtigungen sind opt-in und setzen ein geöffnetes GeoPulse-Tab voraus; Web-Push bei geschlossener App ist nicht eingerichtet.
- Ein großes, kartenfokussiertes Dashboard mit responsive Seitenleiste und mobilen Bottom-Sheets: sortierte Geräte, Zentrumdistanz, Status, Detailkarte mit zehn letzten gültigen Pings, Layer-Schalter/Status/Zeitstempel, Gerät-/Geofence-/Freigabeverwaltung, Geofence-Ereignisse und Browser-Standortfreigabe mit zehnsekündigem Ping-Takt.
- ISS alle 5 s, Erdbeben M2.5+ alle 60 s und OpenSky im aktuellen Bounds alle 30 s. OpenSky nutzt viewport-spezifischen Cache, Fehler-Backoff und abortierbare Requests. Leaflet aktualisiert Map-Bounds für den Flug-Layer.
- Ein zuschaltbarer Open-Meteo-Wetterlayer holt modellbasierte aktuelle Bedingungen für den Kartenmittelpunkt, zeigt Temperatur und Wettersymbol in einem dezent pulsierenden Leaflet-Marker und ergänzt Temperaturgefühl, Niederschlag, Wind sowie Luftfeuchtigkeit im Layerpanel. Der Feed wird alle 5 Minuten erneuert, nach Kartenbewegung entprellt und pro Standortzelle kurzzeitig gecacht; die UI nennt Anbieter und Modellcharakter transparent. Open-Meteo beschreibt die Current-Felder als 15-minütliche Wettermodellwerte ([API-Dokumentation](https://open-meteo.com/en/docs)); die offene API ist für nichtkommerzielle Nutzung vorgesehen und auf 10.000 Aufrufe pro Tag begrenzt ([Tarife und Limits](https://open-meteo.com/en/pricing)). Datenattribution folgt CC BY 4.0 ([Lizenz](https://open-meteo.com/en/licence)).
- CARTO verlangt seit 25. September 2026 für Rastertiles einen Basemap-Schlüssel; der übermittelte Entwicklerzugang lieferte für den Tile-Endpunkt weiterhin das „API KEY REQUIRED“-Bild. Daher verwendet GeoPulse den öffentlich kostenlosen OpenFreeMap-Dark-Stil ohne Registrierung oder Schlüssel; OpenFreeMap dokumentiert den Dark-Style und die Integration über MapLibre GL Leaflet ([CARTO-FAQ](https://docs.carto.com/faqs/carto-basemaps), [OpenFreeMap](https://openfreemap.org/), [Quick Start](https://openfreemap.org/quick_start/)).
- Einfache HTTP-Fehlerantworten, mobile Bedienbarkeit, TypeScript-Diagnostik und vorhandene Projekt-Build-Prüfungen.

## Projektstruktur

- `drizzle/schema.ts`, `drizzle/*.sql`: Datenmodell und Migration.
- `server/geopulse.ts`: Persistenz, Berechtigungsfilter, Ingest-Validierung, Retention und Geofence-Übergänge.
- `server/_core/index.ts`: REST-Routen für Ingest, Eigentümer-API und öffentliche Share-Ansicht.
- `client/src/pages/Home.tsx`: Kartenansicht, Layer-Abfragezustände, Device-Liste/Detail und responsive Panels.
- `client/src/components/`: Leaflet-/MapLibre-Karte, modale Formulare und wiederverwendete App-Oberfläche.
- `client/src/App.tsx`, `client/src/index.css`, `client/index.html`: Routen, Dark Theme und responsive Gestaltung.
- `public/manus-routes.json`: vollständiges Seitenroutenmanifest.
- `TODO.md`: konkrete Produktkriterien und Lieferstatus.

## Design

- **Designbewegung:** farbige Digital-Command-Konsole mit klaren Geodaten- und HUD-Anklängen.
- **Kernprinzipien:** Karte bleibt die dominante Arbeitsfläche; kräftige Farben zeigen Status und Funktionen statt Dekoration; Informationsdichte bleibt in lesbaren, schwebenden Panels; mobil erreichbare Controls behalten ihre Hierarchie.
- **Farbphilosophie:** tiefes Nachtblau hält die Karte ruhig; elektrisches Cyan/Mint markiert Live-Daten, Violett codiert Ebenen und Zonen, Pink/Koralle signalisiert Freigaben und Ereignisse, Lime und Amber setzen gezielte Impulse. Markerfarben bleiben pro Gerät unterscheidbar.
- **Layout-Paradigma:** Vollbildkarte unter einer transparenten Kommandoleiste; links ein kompaktes Fleet-Panel, rechts schaltbare Layer/Share-Panels und ein Geräte-Detail; mobil werden die Flächen zu gestapelten Bottom-Sheets.
- **Signature-Elemente:** feines Koordinatenraster über der Karte; farbcodierte Pulsringe und weich leuchtende Marker; dünne, horizontale Signal- und Statuslinien in Panels.
- **Interaktion:** Pan/Zoom bleibt direkt; Marker und Buttons erhalten klare Farb- und Fokuszustände; Hover/Selection hebt die zugehörige Gerätefarbe hervor; öffentliche Freigaben behalten eine sichtbare Read-only-Grenze.
- **Animation:** kurzer Panel-Einflug, weicher Live-Puls und dezent auslaufende Ping-Spuren; keine ununterbrochenen Scan-Animationen, Beachtung von `prefers-reduced-motion`.
- **Typografie:** Space Grotesk für UI und Überschriften, DM Mono für Tracking-Code, Koordinaten, Messwerte und Timestamps; hohe Kontraste und kompakte Tabular Numbers.
- **Markenkern:** „Standorte in Echtzeit – sichtbar in Farbe.“ Persönlichkeit: digital, wachsam, klar.
- **Markensprache:** knapp, technisch und unmittelbar. Beispiele: „LIVE · 4 Geräte“; „Zuletzt vor 12 s · Genauigkeit ±8 m“.
- **Wortmarke/Logo:** ein helles GeoPulse-Glyph in einem cyan-mintfarbenen Radar-Kachelrahmen mit zwei zurückhaltenden Ringdetails.
- **Signaturfarbe:** leuchtendes Cyan `#3BE7FF`; Mint, Violett, Pink, Lime und Amber ergänzen es nach Datenrolle.

## Laufzeit und Serving

Das vorhandene Cloud-Projekt verwendet Port 3000, den Express-Server und die Managed Database. Entwicklung läuft über `pnpm dev`; Container-Build und `/api/health` bleiben im bestehenden Projektcontract. Es wird keine separate Karten-API oder proprietäre Basemap benötigt.
