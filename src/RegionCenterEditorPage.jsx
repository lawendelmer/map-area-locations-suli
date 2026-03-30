import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import JSZip from "jszip";
import "leaflet/dist/leaflet.css";

import { getMapConfig } from "./mapConfig";
import { useMapType } from "./MapTypeContext";
import {
  districtKeyOf,
  districtNameFromZipPath,
  enrichListingWorkbook,
  getRegionXlsxGlob,
  globKeyToSuliZipPath,
  isProvinceListingPath,
  parsePollingCentersXlsx,
  workbookHasPollingCoordColumns,
} from "./suliExcel";

const DEFAULT_CENTER = [35.56, 45.41];
const DEFAULT_ZOOM = 9;

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** One-time fit when data loads; does not refit when user edits coordinates. */
function FitCentersOnce({ centers, when }) {
  const map = useMap();
  const doneRef = useRef(false);
  useEffect(() => {
    if (!when || doneRef.current) return;
    const pts = centers.filter(
      (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng),
    );
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((c) => [c.lat, c.lng]));
    if (!bounds.isValid()) return;
    doneRef.current = true;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (map.getContainer()?.offsetParent == null) return;
        map.fitBounds(bounds, { padding: [56, 56], maxZoom: 11 });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [map, centers, when]);
  return null;
}

const PAN_ZOOM_DISTRICT = 10;
const PAN_ZOOM_SUBDISTRICT = 12;

function PanToActiveSelection({ activeKey, districtCenters, subCenters }) {
  const map = useMap();
  const lastPannedForKeyRef = useRef(null);

  useEffect(() => {
    if (!activeKey) {
      lastPannedForKeyRef.current = null;
      return;
    }
    if (lastPannedForKeyRef.current === activeKey) return;

    let lat;
    let lng;
    let zoom = PAN_ZOOM_DISTRICT;

    if (activeKey.startsWith("d:")) {
      const name = activeKey.slice(2);
      const c = districtCenters[name];
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      lat = c.lat;
      lng = c.lng;
      zoom = PAN_ZOOM_DISTRICT;
    } else if (activeKey.startsWith("s:")) {
      const gk = activeKey.slice(2);
      const c = subCenters[gk];
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return;
      lat = c.lat;
      lng = c.lng;
      zoom = PAN_ZOOM_SUBDISTRICT;
    } else {
      return;
    }

    lastPannedForKeyRef.current = activeKey;
    const id = requestAnimationFrame(() => {
      if (map.getContainer()?.offsetParent == null) return;
      map.setView([lat, lng], zoom, { animate: true });
    });
    return () => cancelAnimationFrame(id);
  }, [map, activeKey, districtCenters, subCenters]);
  return null;
}

function findSubCenterCoords(rowNameTrimmed, districtFromPath, subCentersRecord) {
  const d = districtFromPath.trim();
  const n = rowNameTrimmed.trim();
  for (const c of Object.values(subCentersRecord)) {
    if (!c) continue;
    if (String(c.qada || "").trim() === d && String(c.nahya || "").trim() === n) {
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
        return { lat: c.lat, lng: c.lng };
      }
    }
  }
  return null;
}

/**
 * @param {{ regionFolder: string, pageTitle: string, exportZipFilename: string }} props
 */
export default function RegionCenterEditorPage({ regionFolder, pageTitle, exportZipFilename }) {
  const { mapTypeId, setMapTypeId, MAP_TYPES } = useMapType();
  const mapConfig = getMapConfig(mapTypeId);
  const [loading, setLoading] = useState(true);
  const [loadDetail, setLoadDetail] = useState("");
  const [error, setError] = useState("");
  const [points, setPoints] = useState([]);
  const [districtCenters, setDistrictCenters] = useState({});
  const [subCenters, setSubCenters] = useState({});
  const [activeKey, setActiveKey] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    setSeeded(false);
    setDistrictCenters({});
    setSubCenters({});
    setActiveKey(null);
    setPoints([]);
  }, [regionFolder]);

  useEffect(() => {
    let cancelled = false;
    const loaders = getRegionXlsxGlob(regionFolder);

    async function run() {
      setLoading(true);
      setError("");
      setLoadDetail("");
      const entries = Object.entries(loaders);
      const all = [];

      for (let i = 0; i < entries.length; i++) {
        const [, loadUrl] = entries[i];
        if (cancelled) return;
        setLoadDetail(`${i + 1} / ${entries.length}`);
        try {
          const url = await loadUrl();
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const buffer = await res.arrayBuffer();
          const parsed = parsePollingCentersXlsx(buffer);
          if (parsed.length) {
            for (const pt of parsed) {
              all.push({ ...pt, region: regionFolder });
            }
          }
        } catch {
          /* skip */
        }
      }

      if (!cancelled) {
        setPoints(all);
        setLoadDetail(all.length ? `${all.length} بنکە` : "هیچ بنکەیەک نییە");
        if (!all.length) {
          setError("هیچ خاڵێکی تۆمارکراو نەدۆزرایەوە.");
        }
      }
      if (!cancelled) setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [regionFolder]);

  useEffect(() => {
    if (!points.length || seeded) return;
    const dAgg = new Map();
    const sAgg = new Map();
    for (const p of points) {
      const d = districtKeyOf(p);
      if (!dAgg.has(d)) dAgg.set(d, { slat: 0, slng: 0, n: 0 });
      const da = dAgg.get(d);
      da.slat += p.lat;
      da.slng += p.lng;
      da.n += 1;

      const gk = p.groupKey;
      if (!sAgg.has(gk)) {
        sAgg.set(gk, {
          slat: 0,
          slng: 0,
          n: 0,
          qada: p.qada,
          nahya: p.nahya,
        });
      }
      const sa = sAgg.get(gk);
      sa.slat += p.lat;
      sa.slng += p.lng;
      sa.n += 1;
    }

    const dc = {};
    for (const [k, v] of dAgg) {
      dc[k] = { lat: v.slat / v.n, lng: v.slng / v.n };
    }
    const sc = {};
    for (const [k, v] of sAgg) {
      sc[k] = {
        lat: v.slat / v.n,
        lng: v.slng / v.n,
        qada: v.qada,
        nahya: v.nahya,
      };
    }
    setDistrictCenters(dc);
    setSubCenters(sc);
    setSeeded(true);
  }, [points, seeded, regionFolder]);

  const sortedDistricts = useMemo(() => {
    return Object.keys(districtCenters).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [districtCenters]);

  const subsByDistrict = useMemo(() => {
    const m = new Map();
    for (const [gk, c] of Object.entries(subCenters)) {
      const d = String(c.qada || "").trim() || "—";
      if (!m.has(d)) m.set(d, []);
      m.get(d).push({ groupKey: gk, ...c });
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const na = String(a.nahya || "");
        const nb = String(b.nahya || "");
        const byNahya = na.localeCompare(nb, undefined, { sensitivity: "base" });
        if (byNahya !== 0) return byNahya;
        return String(a.groupKey).localeCompare(String(b.groupKey), undefined, {
          sensitivity: "base",
        });
      });
    }
    return m;
  }, [subCenters]);

  /** Districts that have centers and/or subdistricts, sorted for the left list. */
  const sortedDistrictHierarchy = useMemo(() => {
    const keys = new Set(Object.keys(districtCenters));
    for (const d of subsByDistrict.keys()) {
      keys.add(d);
    }
    return [...keys].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [districtCenters, subsByDistrict]);

  const allCenterPoints = useMemo(() => {
    const out = [];
    for (const c of Object.values(districtCenters)) {
      if (c && Number.isFinite(c.lat)) out.push(c);
    }
    for (const c of Object.values(subCenters)) {
      if (c && Number.isFinite(c.lat)) out.push(c);
    }
    return out;
  }, [districtCenters, subCenters]);

  const handleMapClick = useCallback(
    ({ lat, lng }) => {
      if (!activeKey) return;
      if (activeKey.startsWith("d:")) {
        const name = activeKey.slice(2);
        setDistrictCenters((prev) => ({
          ...prev,
          [name]: { lat, lng },
        }));
        return;
      }
      if (activeKey.startsWith("s:")) {
        const gk = activeKey.slice(2);
        setSubCenters((prev) => {
          const cur = prev[gk];
          if (!cur) return prev;
          return { ...prev, [gk]: { ...cur, lat, lng } };
        });
      }
    },
    [activeKey],
  );

  const exportZip = useCallback(async () => {
    setExporting(true);
    setError("");
    try {
      const zip = new JSZip();
      const entries = Object.entries(getRegionXlsxGlob(regionFolder));

      for (const [globKey, loadUrl] of entries) {
        const zipPath = globKeyToSuliZipPath(globKey);
        const url = await loadUrl();
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const buffer = await res.arrayBuffer();

        if (workbookHasPollingCoordColumns(buffer)) {
          zip.file(zipPath, new Uint8Array(buffer));
          continue;
        }

        const lookupCoords = (name) => {
          const t = String(name || "").trim();
          if (!t) return null;

          if (isProvinceListingPath(zipPath)) {
            const c = districtCenters[t];
            if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) {
              return { lat: c.lat, lng: c.lng };
            }
            for (const [dk, dc] of Object.entries(districtCenters)) {
              if (dk.trim() === t && Number.isFinite(dc.lat)) {
                return { lat: dc.lat, lng: dc.lng };
              }
            }
            return null;
          }

          const dPath = districtNameFromZipPath(zipPath);
          if (dPath) {
            return findSubCenterCoords(t, dPath, subCenters);
          }

          return null;
        };

        const outBytes = enrichListingWorkbook(buffer, lookupCoords);
        zip.file(zipPath, outBytes);
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = exportZipFilename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [districtCenters, subCenters, regionFolder, exportZipFilename]);

  const activeHint = activeKey
    ? "کلیک لەسەر نەخشە بکە بۆ دانانی پێگەی هەڵبژێردراو."
    : "لە لیستەکە هەڵبژاردەیەک هەڵبژێرە، پاشان کلیک لەسەر نەخشە.";

  return (
    <div className="suli-center-editor">
      <style>{`
        .suli-center-editor {
          --bg: #0c0e12;
          --surface: #141820;
          --border: rgba(255,255,255,0.08);
          --text: #e2e8f0;
          --text-muted: #94a3b8;
          --accent: #a855f7;
          --accent-dim: #7c3aed;
          --focus: rgba(168, 85, 247, 0.35);
        }
        .suli-center-editor {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--bg);
          color: var(--text);
          font-family: "DM Sans", system-ui, sans-serif;
        }
        .suli-center-editor .toolbar {
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--border);
          background: rgba(0,0,0,0.25);
        }
        .suli-center-editor .toolbar a {
          color: rgba(255,255,255,0.9);
          text-decoration: none;
          font-weight: 600;
        }
        .suli-center-editor .toolbar fieldset {
          display: flex;
          align-items: center;
          gap: 12px;
          border: 1px solid rgba(255,255,255,0.3);
          border-radius: 8px;
          padding: 6px 12px;
          margin: 0;
        }
        .suli-center-editor .toolbar legend {
          font-size: 12px;
          opacity: 0.9;
        }
        .suli-center-editor .export-btn {
          padding: 8px 16px;
          border-radius: 8px;
          border: none;
          background: var(--accent);
          color: #fff;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .suli-center-editor .export-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .suli-center-editor .export-btn:hover:not(:disabled) {
          filter: brightness(1.08);
        }
        .suli-center-editor .body {
          flex: 1;
          display: flex;
          min-height: 0;
        }
        .suli-center-editor .left-panel {
          width: 400px;
          min-width: 300px;
          flex-shrink: 0;
          border-right: 1px solid var(--border);
          background: var(--surface);
          display: flex;
          flex-direction: column;
        }
        .suli-center-editor .left-panel h2 {
          margin: 0;
          padding: 14px 16px;
          font-size: 1rem;
          font-weight: 700;
          border-bottom: 1px solid var(--border);
        }
        .suli-center-editor .hint {
          padding: 10px 16px;
          font-size: 12px;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          line-height: 1.45;
        }
        .suli-center-editor .scroll {
          flex: 1;
          overflow: auto;
          padding: 8px 0 16px;
        }
        .suli-center-editor .section-title {
          padding: 8px 16px 4px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
        }
        .suli-center-editor .row {
          padding: 10px 16px;
          margin: 0 8px 4px;
          border-radius: 8px;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .suli-center-editor .row:hover {
          background: rgba(255,255,255,0.04);
        }
        .suli-center-editor .row.active {
          background: rgba(168, 85, 247, 0.12);
          border-color: var(--focus);
        }
        .suli-center-editor .row .name {
          font-weight: 600;
          font-size: 13px;
          margin-bottom: 4px;
        }
        .suli-center-editor .row .coords {
          font-size: 12px;
          font-variant-numeric: tabular-nums;
          color: var(--text-muted);
        }
        .suli-center-editor .district-block {
          margin-bottom: 12px;
        }
        .suli-center-editor .district-block .district-row {
          margin-bottom: 2px;
        }
        .suli-center-editor .row-badge {
          display: inline-block;
          margin-inline-end: 8px;
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          background: rgba(168, 85, 247, 0.25);
          color: #e9d5ff;
          vertical-align: middle;
        }
        .suli-center-editor .row-badge-sub {
          background: rgba(6, 182, 212, 0.22);
          color: #a5f3fc;
        }
        .suli-center-editor .sub-wrap {
          margin-left: 12px;
          padding-left: 10px;
          border-left: 2px solid rgba(255,255,255,0.08);
        }
        .suli-center-editor .sub-row {
          margin-bottom: 4px;
        }
        .suli-center-editor .map-panel {
          flex: 1;
          min-width: 0;
          position: relative;
        }
      `}</style>

      <div className="toolbar">
        <a href="/">← OSM boundaries</a>
        <a href="/polling-center">→ Polling centers</a>
        <a href="/suli-centers" style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontSize: 13 }}>
          Suli
        </a>
        <a href="/duhok-centers" style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontSize: 13 }}>
          Duhok
        </a>
        <a href="/halbja-centers" style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontSize: 13 }}>
          Halbja
        </a>
        <span style={{ fontWeight: 700 }}>{pageTitle}</span>
        <fieldset>
          <legend>Map type</legend>
          {MAP_TYPES.map((t) => (
            <label
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                name="mapTypeSce"
                checked={mapTypeId === t.id}
                onChange={() => setMapTypeId(t.id)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className="export-btn"
          disabled={loading || !seeded || exporting}
          onClick={exportZip}
        >
          {exporting ? "ئامادەکردن…" : `داگرتنی ZIP (${regionFolder})`}
        </button>
        {loading && <span style={{ fontSize: 13 }}>بارکردن… {loadDetail}</span>}
        {!loading && error && (
          <span style={{ fontSize: 13, color: "#ffb3b3" }}>{error}</span>
        )}
      </div>

      <div className="body">
        <div className="left-panel">
          <h2>ناوەندەکان</h2>
          <div className="hint">
            {activeHint}
          </div>
          <div className="scroll">
            <div className="section-title">قەزا و ناحیە (ڕیزکراو بەپێی قەزا)</div>
            {sortedDistrictHierarchy.map((d) => {
              const c = districtCenters[d];
              const subs = subsByDistrict.get(d) || [];
              const dKey = `d:${d}`;
              const dActive = activeKey === dKey;
              return (
                <div key={`block-${d}`} className="district-block">
                  <div
                    className={`row district-row${dActive ? " active" : ""}`}
                    onClick={() => setActiveKey(dKey)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveKey(dKey);
                      }
                    }}
                  >
                    <div className="name">
                      <span className="row-badge">قەزا</span>
                      {d}
                    </div>
                    <div className="coords">
                      {c && Number.isFinite(c.lat)
                        ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`
                        : "—"}
                    </div>
                  </div>
                  {subs.length > 0 && (
                    <div className="sub-wrap">
                      {subs.map((s) => {
                        const sKey = `s:${s.groupKey}`;
                        const sActive = activeKey === sKey;
                        return (
                          <div
                            key={sKey}
                            className={`row sub-row${sActive ? " active" : ""}`}
                            onClick={() => setActiveKey(sKey)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setActiveKey(sKey);
                              }
                            }}
                          >
                            <div className="name">
                              <span className="row-badge row-badge-sub">ناحیە</span>
                              {s.nahya || s.groupKey}
                            </div>
                            <div className="coords">
                              {Number.isFinite(s.lat)
                                ? `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`
                                : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="map-panel">
          <MapContainer
            key={regionFolder}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            style={{ width: "100%", height: "100%" }}
            scrollWheelZoom
          >
            <TileLayer attribution={mapConfig.attribution} url={mapConfig.url} />
            <MapClickHandler onMapClick={handleMapClick} />
            {allCenterPoints.length > 0 && (
              <FitCentersOnce centers={allCenterPoints} when={seeded} />
            )}
            <PanToActiveSelection
              activeKey={activeKey}
              districtCenters={districtCenters}
              subCenters={subCenters}
            />
            {sortedDistricts.map((d) => {
              const c = districtCenters[d];
              if (!c || !Number.isFinite(c.lat)) return null;
              const key = `d:${d}`;
              const active = activeKey === key;
              return (
                <CircleMarker
                  key={key}
                  center={[c.lat, c.lng]}
                  radius={active ? 14 : 10}
                  pathOptions={{
                    color: active ? "#faf5ff" : "#6b21a8",
                    fillColor: active ? "#c084fc" : "#9333ea",
                    fillOpacity: 0.9,
                    weight: active ? 3 : 2,
                  }}
                >
                  <Popup>
                    <strong>قەزا:</strong> {d}
                    <br />
                    {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                  </Popup>
                </CircleMarker>
              );
            })}
            {Object.entries(subCenters).map(([gk, c]) => {
              if (!c || !Number.isFinite(c.lat)) return null;
              const key = `s:${gk}`;
              const active = activeKey === key;
              return (
                <CircleMarker
                  key={key}
                  center={[c.lat, c.lng]}
                  radius={active ? 10 : 6}
                  pathOptions={{
                    color: active ? "#fff" : "#0e7490",
                    fillColor: active ? "#22d3ee" : "#06b6d4",
                    fillOpacity: 0.92,
                    weight: active ? 2.5 : 1.5,
                  }}
                >
                  <Popup>
                    <div style={{ fontSize: 13 }}>
                      {c.nahya || gk}
                      <br />
                      <span style={{ opacity: 0.85 }}>
                        {c.qada}
                        {c.qada && c.nahya ? " · " : ""}
                        {c.nahya}
                      </span>
                      <br />
                      {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
