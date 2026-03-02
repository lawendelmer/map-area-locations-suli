import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMapEvents,
} from "react-leaflet";
import * as XLSX from "xlsx";
import "leaflet/dist/leaflet.css";
import { getMapConfig } from "./mapConfig";
import { useMapType } from "./MapTypeContext";

import boundaryCentersUrl from "../boundary_centers.xlsx?url";

const SLEMANI_CENTER = [35.561355, 45.411612];

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

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function downloadExtraLocationsXlsx(rows) {
  const wsData = [
    ["Address Name", "Latitude", "Longitude"],
    ...rows.map((r) => [
      r.addressName || "",
      r.lat != null && Number.isFinite(r.lat) ? r.lat : "",
      r.lng != null && Number.isFinite(r.lng) ? r.lng : "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Extra Locations");
  XLSX.writeFile(wb, "extra_locations.xlsx");
}

export default function ExtraLocationsPage() {
  const { mapTypeId } = useMapType();
  const mapConfig = getMapConfig(mapTypeId);
  const [rows, setRows] = useState([{ id: 1, addressName: "", lat: null, lng: null }]);
  const [activeRowId, setActiveRowId] = useState(1);
  const [boundaryPoints, setBoundaryPoints] = useState([]);
  const nextIdRef = useRef(2);

  useEffect(() => {
    let cancelled = false;
    fetch(boundaryCentersUrl, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load boundary_centers.xlsx (${res.status})`);
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) setBoundaryPoints(parseBoundaryCentersXlsx(buffer));
      })
      .catch(() => {
        if (!cancelled) setBoundaryPoints([]);
      });
    return () => { cancelled = true; };
  }, []);

  const addRow = useCallback(() => {
    const id = nextIdRef.current++;
    setRows((prev) => [...prev, { id, addressName: "", lat: null, lng: null }]);
    setActiveRowId(id);
  }, []);

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }, []);

  const handleMapClick = useCallback(
    ({ lat, lng }) => {
      setRows((prev) =>
        prev.map((r) =>
          r.id === activeRowId ? { ...r, lat, lng } : r
        )
      );
    },
    [activeRowId]
  );

  const handleDownloadExcel = useCallback(() => {
    downloadExtraLocationsXlsx(rows);
  }, [rows]);

  return (
    <div className="extra-locations-page">
      <style>{`
        .extra-locations-page {
          --bg: #0c0e12;
          --surface: #141820;
          --border: rgba(255,255,255,0.08);
          --text: #e2e8f0;
          --text-muted: #94a3b8;
          --accent: #0ea5e9;
          --focus: rgba(14, 165, 233, 0.4);
        }
        .extra-locations-page {
          width: 100%;
          height: 100vh;
          display: flex;
          background: var(--bg);
          color: var(--text);
          font-family: "DM Sans", system-ui, sans-serif;
        }
        .extra-locations-page .left-panel {
          width: 380px;
          min-width: 320px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border);
          background: var(--surface);
        }
        .extra-locations-page .left-panel h2 {
          margin: 0;
          padding: 16px 20px;
          font-size: 1.1rem;
          font-weight: 700;
          border-bottom: 1px solid var(--border);
        }
        .extra-locations-page .table-wrap {
          flex: 1;
          overflow: auto;
        }
        .extra-locations-page table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .extra-locations-page th {
          text-align: left;
          padding: 10px 12px;
          background: rgba(0,0,0,0.2);
          border: 1px solid var(--border);
          color: var(--text-muted);
          font-weight: 600;
        }
        .extra-locations-page td {
          border: 1px solid var(--border);
          padding: 0;
          vertical-align: middle;
        }
        .extra-locations-page td input {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          background: transparent;
          border: none;
          color: var(--text);
          font: inherit;
          outline: none;
        }
        .extra-locations-page td input:focus {
          box-shadow: inset 0 0 0 2px var(--focus);
        }
        .extra-locations-page td.read-only {
          padding: 10px 12px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }
        .extra-locations-page tr.active td {
          background: rgba(14, 165, 233, 0.08);
        }
        .extra-locations-page tr:hover td {
          background: rgba(255,255,255,0.03);
        }
        .extra-locations-page tr.active:hover td {
          background: rgba(14, 165, 233, 0.12);
        }
        .extra-locations-page .add-row {
          margin: 12px 20px;
          padding: 10px 16px;
          background: var(--accent);
          color: #fff;
          border: none;
          border-radius: 8px;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .extra-locations-page .add-row:hover {
          filter: brightness(1.1);
        }
        .extra-locations-page .download-excel {
          margin: 0 20px 12px;
          padding: 10px 16px;
          background: transparent;
          color: var(--accent);
          border: 1px solid var(--accent);
          border-radius: 8px;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .extra-locations-page .download-excel:hover {
          background: rgba(14, 165, 233, 0.15);
        }
        .extra-locations-page .hint {
          padding: 12px 20px;
          font-size: 12px;
          color: var(--text-muted);
          border-top: 1px solid var(--border);
        }
        .extra-locations-page .map-panel {
          flex: 1;
          min-width: 0;
          position: relative;
        }
        .extra-locations-page .map-panel .map-container {
          width: 100%;
          height: 100%;
        }
      `}</style>

      <div className="left-panel">
        <h2>Extra locations</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Address Name</th>
                <th style={{ width: "110px" }}>Latitude</th>
                <th style={{ width: "110px" }}>Longitude</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === activeRowId ? "active" : ""}
                  onClick={() => setActiveRowId(row.id)}
                >
                  <td>
                    <input
                      type="text"
                      value={row.addressName}
                      onChange={(e) =>
                        updateRow(row.id, "addressName", e.target.value)
                      }
                      placeholder="Type address name..."
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="read-only">
                    {row.lat != null && Number.isFinite(row.lat)
                      ? row.lat.toFixed(6)
                      : "—"}
                  </td>
                  <td className="read-only">
                    {row.lng != null && Number.isFinite(row.lng)
                      ? row.lng.toFixed(6)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="add-row" onClick={addRow}>
          + Add row
        </button>
        <button type="button" className="download-excel" onClick={handleDownloadExcel}>
          Download Excel
        </button>
        <div className="hint">
          Select a row, then click on the map to set its coordinates. Cyan = boundary_centers.xlsx; orange = your extra locations.
        </div>
      </div>

      <div className="map-panel">
        <div className="map-container">
          <MapContainer
            center={SLEMANI_CENTER}
            zoom={12}
            style={{ width: "100%", height: "100%" }}
            scrollWheelZoom
          >
            <TileLayer attribution={mapConfig.attribution} url={mapConfig.url} />
            <MapClickHandler onMapClick={handleMapClick} />
            {boundaryPoints.map((point, idx) => (
              <CircleMarker
                key={`boundary-${idx}-${point.name}`}
                center={[point.lat, point.lng]}
                radius={7}
                pathOptions={{
                  color: "#0e7490",
                  fillColor: "#22d3ee",
                  fillOpacity: 0.95,
                  weight: 1.5,
                }}
              >
                <Popup>{point.name}</Popup>
              </CircleMarker>
            ))}
            {rows
              .filter(
                (r) =>
                  r.lat != null &&
                  Number.isFinite(r.lat) &&
                  r.lng != null &&
                  Number.isFinite(r.lng)
              )
              .map((row) => (
                <CircleMarker
                  key={row.id}
                  center={[row.lat, row.lng]}
                  radius={row.id === activeRowId ? 12 : 9}
                  pathOptions={{
                    color: row.id === activeRowId ? "#c2410c" : "#ea580c",
                    fillColor: row.id === activeRowId ? "#fb923c" : "#fdba74",
                    fillOpacity: 0.95,
                    weight: row.id === activeRowId ? 2.5 : 1.5,
                  }}
                >
                  <Popup>
                    {row.addressName || `Location ${row.id}`}
                    <br />
                    {row.lat?.toFixed(5)}, {row.lng?.toFixed(5)}
                  </Popup>
                </CircleMarker>
              ))}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
