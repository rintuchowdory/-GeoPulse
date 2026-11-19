# GeoPulse – Implementierungsplan

## Ziel und Architektur

GeoPulse wird als mobile-first React-/Tailwind-Web-App im bestehenden Manus-Projekt (React, Express, tRPC, Drizzle, MySQL) umgesetzt. Die Karte nutzt Leaflet mit CARTO Dark Matter ohne API-Key. Geräte-, Ping-, Geofence- und Share-Link-Daten liegen persistent in der Managed-MySQL-Datenbank. Eigentümer-Routen basieren auf der vorhandenen Manus-Session und filtern zwingend nach `owner_email`; öffentliche Share-Routen sind ausschließlich tokengebunden und geben genau ein Gerät lesend frei. Der unabhängige `POST /ingest` akzeptiert das vereinbarte GeoPulse-JSON und OwnTracks-HTTP-Standortmeldungen. Externe ISS-, USGS- und OpenSky-Layer fragt der Browser unabhängig und in getrennten Intervallen ab.

## Umsetzung und Entscheidungen

- Drizzle-Schema und Migration für `devices`, `location_pings`, `geofences`, `share_links` sowie persistente Geofence-Ereignisse. Tracking-Codes sind eindeutige 6-Zeichen-Codes; Share-Token sind kryptographisch zufällig und Ablauf/Widerruf werden serverseitig geprüft.
- REST-Controller für geschützte Eigentümerverwaltung, öffentlichen `/api/share/:token`-Read-only-Datensatz, `/ingest`-POST, Ping-Aufbewahrung und Geofence-Übergänge. Standortwerte und Zeitstempel werden validiert; veraltete Pings werden zurückgewiesen. Sprünge über 500 km in höchstens 60 Sekunden werden gespeichert und als Ausreißer markiert, aber weder als letzter Geräteort gesetzt noch in Abfragen/Spuren geplottet. Alte Pings werden stündlich sowie beim Ingest bereinigt.
- Geofence-Alarmregeln speichern Eintritt, Austritt oder beide Übergänge pro Zone. Neue Zonen verwenden „Eintritt“ als Voreinstellung; das Owner-Dashboard pollt Ereignisse alle 15 s, zeigt neue OwnTracks- und Browser-Übergänge im Feed und als In-App-/Browsermeldung. Browser-Benachrichtigungen sind opt-in und setzen ein geöffnetes GeoPulse-Tab voraus; Web-Push bei geschlossener App ist nicht eingerichtet.
- Ein großes, kartenfokussiertes Dashboard mit responsive Seitenleiste und mobilen Bottom-Sheets: sortierte Geräte, Zentrumdistanz, Status, Detailkarte mit zehn letzten gültigen Pings, Layer-Schalter/Status/Zeitstempel, Gerät-/Geofence-/Freigabeverwaltung, Geofence-Ereignisse und Browser-Standortfreigabe mit zehnsekündigem Ping-Takt.
- ISS alle 5 s, Erdbeben M2.5+ alle 60 s und OpenSky im aktuellen Bounds alle 30 s. OpenSky nutzt viewport-spezifischen Cache, Fehler-Backoff und abortierbare Requests. Leaflet aktualisiert Map-Bounds für den Flug-Layer.
- Einfache HTTP-Fehlerantworten, mobile Bedienbarkeit, TypeScript-Diagnostik und vorhandene Projekt-Build-Prüfungen.

## Projektstruktur

- `drizzle/schema.ts`, `drizzle/*.sql`: Datenmodell und Migration.
- `server/geopulse.ts`: Persistenz, Berechtigungsfilter, Ingest-Validierung, Retention und Geofence-Übergänge.
- `server/_core/index.ts`: REST-Routen für Ingest, Eigentümer-API und öffentliche Share-Ansicht.
- `client/src/pages/Home.tsx`: Kartenansicht, Layer-Abfragezustände, Device-Liste/Detail und responsive Panels.
- `client/src/components/`: Leaflet-Karte, modale Formulare und wiederverwendete App-Oberfläche.
- `client/src/App.tsx`, `client/src/index.css`, `client/index.html`: Routen, Dark Theme und responsive Gestaltung.
- `public/manus-routes.json`: vollständiges Seitenroutenmanifest.
- `TODO.md`: konkrete Produktkriterien und Lieferstatus.

## Design

Drei alternative Stilrichtungen (jeweils geringe Ausgangswahrscheinlichkeit): **Instrument-Panel, 0,06**; **field-notes/cartographic, 0,04**; **glassmorphic satellite console, 0,03**. Gewählt ist **Instrument-Panel**: eine präzise, nächtliche Lagezentrale mit klaren Kartenebenen und minimalem visuellem Rauschen.

- **Designbewegung:** zeitgenössische Flugverkehrs-/Geodaten-Konsole mit zurückhaltender Editorial-Typografie.
- **Kernprinzipien:** Karte bleibt visuell dominant; Status ist ohne Öffnen eines Geräts erkennbar; Informationsdichte wird über progressive Panels organisiert; mobile Controls bleiben Daumen-erreichbar.
- **Farbphilosophie:** fast-schwarzes Navy und Graphit geben Satelliten- und Straßendaten Raum; kühles Mint signalisiert Live/GeoPulse, warme Bernstein-/Korallentöne reservieren sich für Hinweise und Warnungen. Geräte nutzen unterscheidbare Akzentfarben.
- **Layout-Paradigma:** vollflächige Karte als Arbeitsfläche, schwebende schmale Kopfzeile und linke Desktop-Sidecar-Leiste; auf Mobilgeräten werden Panels zu ausziehbaren, unteren Kartenblättern.
- **Signature-Elemente:** kompakter Pulsring auf frischen Gerätepositionen; feine Koordinaten-/Rasterdetails in Panels; gerichtete, altersverblassende Ping-Spuren.
- **Interaktion:** Map-Pan/Zoom bleibt direkt; Gerät anklicken fokussiert und öffnet Details; Layer sind explizit schaltbar; Bearbeitung und Freigabe erfolgen in klar abgegrenzten Dialogen. Keine Kontrolle wird in der Nur-Lese-Freigabe angezeigt.
- **Animation:** langsamer, gedämpfter Puls nur für <60-Sekunden-Geräte; Trail-Opacity nimmt entlang der Zeit ab; kurze (140–220 ms) Panel- und Hover-Übergänge; keine dauernd bewegte Dekoration.
- **Typografie:** Inter für Interface und Tabellen, `IBM Plex Mono` für Codes, Koordinaten, Messwerte und Zeitstempel; kompakte Tabular Numbers und klare 11/13/15/20-px-Hierarchie.
- **Markenkern:** „Standorte in Echtzeit – auf einen Blick.“ Persönlichkeit: präzise, ruhig, wachsam.
- **Markensprache:** nüchtern und handlungsorientiert. Beispiele: „3 Geräte im Blick“; „Zuletzt vor 12 s · Genauigkeit ±8 m“.
- **Wortmarke/Logo:** GeoPulse mit eigenständigem Radar-Punkt: mintfarbener Kern, zwei unvollständige konzentrische Ringe, ohne Standard-Pin-Silhouette.
- **Signaturfarbe:** elektrisches Mint `#48E0C1` für GeoPulse Live-Status und primäre Aktionen.

## Laufzeit und Serving

Das vorhandene Cloud-Projekt verwendet Port 3000, den Express-Server und die Managed Database. Entwicklung läuft über `pnpm dev`; Container-Build und `/api/health` bleiben im bestehenden Projektcontract. Es wird keine separate Karten-API oder proprietäre Basemap benötigt.
