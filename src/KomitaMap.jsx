import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import * as XLSX from "xlsx";
import "leaflet/dist/leaflet.css";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "./mapConfig";

import boundaryCentersUrl from "../boundary_centers.xlsx?url";

function parseBoundaryCentersXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (!rows.length) return [];

  const header = rows[0].map((h) =>
    String(h || "")
      .trim()
      .toLowerCase(),
  );
  const idxName = header.findIndex(
    (h) => h === "name" || h === "نام" || h === "name:en",
  );
  const idxLat = header.findIndex(
    (h) => h === "latitude" || h === "lat" || h === "y",
  );
  const idxLng = header.findIndex(
    (h) =>
      h === "longitude" ||
      h === "long" ||
      h === "lng" ||
      h === "lon" ||
      h === "x",
  );

  if (idxName === -1 || idxLat === -1 || idxLng === -1) return [];

  const points = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[idxName] != null ? String(row[idxName]).trim() : "";
    const lat = Number(row[idxLat]);
    const lng = Number(row[idxLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({ name: name || `Point ${i}`, lat, lng });
  }
  return points;
}

export default function KomitaMap() {
  const [points, setPoints] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError("");
        const res = await fetch(boundaryCentersUrl, { cache: "no-store" });
        if (!res.ok)
          throw new Error(
            `Failed to load boundary_centers.xlsx (${res.status})`,
          );
        const buffer = await res.arrayBuffer();
        const parsed = parseBoundaryCentersXlsx(buffer);
        if (!cancelled) setPoints(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const center = useMemo(() => {
    if (!points.length) return [35.561355, 45.411612];
    const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const avgLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
    return [avgLat, avgLng];
  }, [points]);

  return (
    <div style={{ width: "100%", height: "100%", minHeight: 500 }}>
      <div
        style={{
          padding: "12px 16px",
          textAlign: "left",
          borderBottom: "1px solid rgba(255,255,255,0.15)",
        }}
      >
        <div style={{ fontWeight: 700 }}>Boundary centers</div>
        <div style={{ fontSize: 13 }}>
          {points.length} points from boundary_centers.xlsx
          {error && ` — ${error}`}
        </div>
      </div>

      <div style={{ width: "100%", height: "calc(100% - 56px)" }}>
        <MapContainer
          center={center}
          zoom={10}
          style={{ width: "100%", height: "100%" }}
          scrollWheelZoom
        >
          <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILE_URL} />
          {points.map((point, idx) => (
            <CircleMarker
              key={`${point.name}-${idx}`}
              center={[point.lat, point.lng]}
              radius={10}
              pathOptions={{
                color: "#1e90ff",
                fillColor: "#1e90ff",
                fillOpacity: 0.8,
                weight: 1.5,
              }}
            >
              <Popup>{point.name}</Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
