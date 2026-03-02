import { useEffect, useState } from "react";
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import * as XLSX from "xlsx";
import "leaflet/dist/leaflet.css";

import geojsonUrl from "../irq_admin_boundaries.geojson/osm-boundaries-18201500-18201560.geojson?url";
import { getMapConfig } from "./mapConfig";
import { useMapType } from "./MapTypeContext";
import boundaryCentersXlsxUrl from "../boundary_centers.xlsx?url";

function parseBoundaryCentersXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h || "").trim().toLowerCase());
  const idxName = header.findIndex((h) => h === "name" || h === "نام" || h === "name:en");
  const idxLat = header.findIndex((h) => h === "latitude" || h === "lat" || h === "y");
  const idxLng = header.findIndex((h) => h === "longitude" || h === "long" || h === "lng" || h === "lon" || h === "x");
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

function FitBounds({ data }) {
  const map = useMap();
  useEffect(() => {
    if (!data?.features?.length) return;
    const layer = L.geoJSON(data);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (map.getContainer()?.offsetParent == null) return;
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [map, data]);
  return null;
}

export default function OsmBoundariesPage() {
  const { mapTypeId, setMapTypeId, MAP_TYPES } = useMapType();
  const mapConfig = getMapConfig(mapTypeId);
  const [data, setData] = useState(null);
  const [boundaryPoints, setBoundaryPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBorders, setShowBorders] = useState(true);
  const [showPoints, setShowPoints] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      fetch(geojsonUrl).then((r) => {
        if (!r.ok) throw new Error(`Failed to load GeoJSON: ${r.status}`);
        return r.json();
      }),
      fetch(boundaryCentersXlsxUrl, { cache: "no-store" })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.resolve(null)))
        .catch(() => null),
    ])
      .then(([json, buffer]) => {
        if (!cancelled && json?.type === "FeatureCollection") {
          setData(json);
        }
        if (!cancelled && buffer) {
          setBoundaryPoints(parseBoundaryCentersXlsx(buffer));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const center = [35.56, 45.41];
  const zoom = 10;

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          borderBottom: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <a
          href="/extract"
          style={{ color: "rgba(255,255,255,0.9)", textDecoration: "none", fontWeight: 600 }}
        >
          → Extraction
        </a>
        <a
          href="/extra-locations"
          style={{ color: "rgba(255,255,255,0.9)", textDecoration: "none", fontWeight: 600 }}
        >
          → Extra locations
        </a>
        <span style={{ fontWeight: 700 }}>
          OSM boundaries (saved GeoJSON)
        </span>
        <fieldset
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 8,
            padding: "6px 12px",
            margin: 0,
          }}
        >
          <legend style={{ fontSize: 12, opacity: 0.9 }}>Map type</legend>
          {MAP_TYPES.map((t) => (
            <label
              key={t.id}
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}
            >
              <input
                type="radio"
                name="mapType"
                value={t.id}
                checked={mapTypeId === t.id}
                onChange={() => setMapTypeId(t.id)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        {loading && <span style={{ fontSize: 13 }}>Loading…</span>}
        {error && <span style={{ fontSize: 13, color: "#ffb3b3" }}>{error}</span>}
        {data && !loading && (
          <span style={{ fontSize: 13, opacity: 0.9 }}>
            {data.features?.length ?? 0} shapes
          </span>
        )}
        {boundaryPoints.length > 0 && (
          <span style={{ fontSize: 13, opacity: 0.9 }}>
            {boundaryPoints.length} points (boundary_centers.xlsx)
          </span>
        )}
        {data && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showBorders}
              onChange={(e) => setShowBorders(e.target.checked)}
            />
            Borders
          </label>
        )}
        {boundaryPoints.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => setShowPoints(e.target.checked)}
            />
            Points
          </label>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MapContainer
          center={center}
          zoom={zoom}
          style={{ width: "100%", height: "100%" }}
          scrollWheelZoom
        >
          <TileLayer attribution={mapConfig.attribution} url={mapConfig.url} />
          {data && <FitBounds data={data} />}
          {data && showBorders && (
            <GeoJSON
              data={data}
              style={{
                color: "#e67e22",
                weight: 2,
                opacity: 0.95,
                fillColor: "#e67e22",
                fillOpacity: 0.2,
              }}
              onEachFeature={(feature, layer) => {
                const props = feature.properties || {};
                const lines = [
                  props.name && `Name: ${props.name}`,
                  props.admin_level != null && `Admin level: ${props.admin_level}`,
                  props.landuse && `Land use: ${props.landuse}`,
                  props.osm_id != null && `OSM relation: ${props.osm_id}`,
                ].filter(Boolean);
                layer.bindPopup(lines.join("<br/>") || "OSM boundary", {
                  maxWidth: 320,
                });
              }}
            />
          )}
          {showPoints && boundaryPoints.map((point, i) => (
            <CircleMarker
              key={i}
              center={[point.lat, point.lng]}
              radius={6}
              pathOptions={{
                color: "#2c3e50",
                fillColor: "#f1c40f",
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.9,
              }}
            >
              <Popup>
                <strong>{point.name || "Unnamed"}</strong>
                <br />
                {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
