import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Pane,
  Polygon,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { getMapConfig } from "./mapConfig";
import { useMapType } from "./MapTypeContext";
import {
  ALL_POLLING_XLSX_GLOB,
  mapDistrictKey,
  mapDistrictQadaLabel,
  mapStyleGroupKey,
  parsePollingCentersXlsx,
  regionFromGlobKey,
  styleKeyGroupLabel,
} from "./suliExcel";

const DEFAULT_CENTER = [35.56, 45.41];
const DEFAULT_ZOOM = 9;

/** Saturations staggered so neighbors differ in both S and L where possible. */
const SUBDISTRICT_SAT_STEPS = [84, 54, 90, 50, 76, 62, 72, 58, 80, 56, 88, 52, 68, 64];

/**
 * Evenly spaced hues on the wheel so each district reads as a different color family.
 */
function hueForDistrictIndex(index, districtCount) {
  if (districtCount <= 0) return 200;
  if (districtCount === 1) return 210;
  const step = 360 / districtCount;
  return (index * step + 7) % 360;
}

/**
 * One shade per subdistrict: same hue, saturation and lightness chosen for clear separation.
 * @param {number} shadeIndex - 0 .. totalInDistrict - 1
 * @param {number} totalInDistrict - number of ناحیە groups in this قەزا
 * @param {number} hue - district hue (0–360)
 */
function pathOptionsForSubdistrictShade(shadeIndex, totalInDistrict, hue) {
  const s = SUBDISTRICT_SAT_STEPS[shadeIndex % SUBDISTRICT_SAT_STEPS.length];
  let l;
  if (totalInDistrict <= 1) {
    l = 50;
  } else {
    const t = shadeIndex / (totalInDistrict - 1);
    l = Math.round(27 + t * 44);
    if (totalInDistrict > 8) {
      const zig = (shadeIndex % 3 - 1) * 3;
      l = Math.max(26, Math.min(74, l + zig));
    }
  }
  const strokeL = Math.max(l - 18, 12);
  const strokeS = Math.min(s + 8, 96);
  return {
    fillColor: `hsl(${hue} ${s}% ${l}%)`,
    color: `hsl(${hue} ${strokeS}% ${strokeL}%)`,
    fillOpacity: 0.92,
    weight: 1.6,
  };
}

/**
 * Maps each mapStyleGroupKey (region + ناحیە group) to Leaflet path options.
 * Districts get distinct hues; subdistricts under one district get different shades of that hue.
 */
function buildColorStyleByGroupKey(points) {
  const map = new Map();
  if (!points.length) return map;

  const districtSet = new Set();
  for (const p of points) districtSet.add(mapDistrictKey(p));
  const districts = [...districtSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const groupKeysByDistrict = new Map();
  for (const d of districts) groupKeysByDistrict.set(d, new Set());
  for (const p of points) {
    groupKeysByDistrict.get(mapDistrictKey(p)).add(mapStyleGroupKey(p));
  }

  districts.forEach((d, dIdx) => {
    const hue = hueForDistrictIndex(dIdx, districts.length);
    const keys = [...groupKeysByDistrict.get(d)].sort((a, b) =>
      styleKeyGroupLabel(a).localeCompare(styleKeyGroupLabel(b), undefined, {
        sensitivity: "base",
      }),
    );
    keys.forEach((styleKey, shadeIdx) => {
      map.set(
        styleKey,
        pathOptionsForSubdistrictShade(shadeIdx, keys.length, hue),
      );
    });
  });

  return map;
}

/** Stable district list and hue per district name (same spacing as markers). */
function buildDistrictHueByName(points) {
  const districtSet = new Set();
  for (const p of points) districtSet.add(mapDistrictKey(p));
  const districts = [...districtSet].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const hueByDistrict = new Map();
  districts.forEach((d, i) => {
    hueByDistrict.set(d, hueForDistrictIndex(i, districts.length));
  });
  return { districts, hueByDistrict };
}

function dedupeLatLngPoints(points) {
  const m = new Map();
  for (const p of points) {
    const k = `${p.lat.toFixed(5)}_${p.lng.toFixed(5)}`;
    if (!m.has(k)) m.set(k, p);
  }
  return [...m.values()];
}

function cross2(o, a, b) {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

/** Convex hull in map plane (lng/lat); returns [[lat,lng], ...]. */
function convexHullLatLngRing(points) {
  const pts = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (pts.length === 0) return [];
  if (pts.length === 1) return [[pts[0].lat, pts[0].lng]];
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.map((p) => [p.lat, p.lng]);
}

function quadStripAroundSegment(a, b, offset = 0.0018) {
  let dx = b.lng - a.lng;
  let dy = b.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1e-9;
  dx /= len;
  dy /= len;
  const px = -dy * offset;
  const py = dx * offset;
  return [
    [a.lat + px, a.lng + py],
    [b.lat + px, b.lng + py],
    [b.lat - px, b.lng - py],
    [a.lat - px, a.lng - py],
  ];
}

function boxAroundLatLng(p, s = 0.002) {
  return [
    [p.lat - s, p.lng - s],
    [p.lat - s, p.lng + s],
    [p.lat + s, p.lng + s],
    [p.lat + s, p.lng - s],
  ];
}

/** Closed ring for Polygon: convex hull, or padded strip / box for degenerate sets. */
function boundaryRingForPoints(points) {
  const u = dedupeLatLngPoints(points);
  if (u.length === 0) return null;
  if (u.length === 1) return boxAroundLatLng(u[0]);
  if (u.length === 2) return quadStripAroundSegment(u[0], u[1]);
  const ring = convexHullLatLngRing(u);
  if (ring.length < 3) return quadStripAroundSegment(u[0], u[1]);
  return ring;
}

function districtPolygonPathOptions(hue) {
  return {
    color: `hsl(${hue} 72% 44%)`,
    fillColor: `hsl(${hue} 65% 50%)`,
    fillOpacity: 0.16,
    weight: 2.5,
  };
}

function subdistrictPolygonPathOptions(markerPathOptions) {
  return {
    color: markerPathOptions.color,
    fillColor: markerPathOptions.fillColor,
    fillOpacity: 0.14,
    weight: 2,
  };
}

function FitPollingBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (!bounds.isValid()) return;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (map.getContainer()?.offsetParent == null) return;
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
      });
    });
    return () => cancelAnimationFrame(id);
  }, [map, points]);
  return null;
}

export default function PollingCenterPage() {
  const { mapTypeId, setMapTypeId, MAP_TYPES } = useMapType();
  const mapConfig = getMapConfig(mapTypeId);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadDetail, setLoadDetail] = useState("");
  const [boundaryLevel, setBoundaryLevel] = useState("off");

  useEffect(() => {
    let cancelled = false;
    const loaders = ALL_POLLING_XLSX_GLOB;

    async function run() {
      setLoading(true);
      setError("");
      setLoadDetail("");
      const entries = Object.entries(loaders);
      const all = [];
      let filesWithCoords = 0;

      for (let i = 0; i < entries.length; i++) {
        const [globKey, loadUrl] = entries[i];
        if (cancelled) return;
        setLoadDetail(`${i + 1} / ${entries.length}`);
        try {
          const url = await loadUrl();
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const buffer = await res.arrayBuffer();
          const parsed = parsePollingCentersXlsx(buffer);
          if (parsed.length) {
            filesWithCoords += 1;
            const region = regionFromGlobKey(globKey);
            for (const pt of parsed) {
              all.push({ ...pt, region });
            }
          }
        } catch {
          /* skip broken file */
        }
      }

      if (!cancelled) {
        setPoints(all);
        setLoadDetail(
          all.length
            ? `${all.length} بنکە لە ${filesWithCoords} فایل`
            : "هیچ بنکەیەک نەدۆزرایەوە",
        );
        if (!all.length) {
          setError("هیچ خاڵێکی لە فایلەکانی Excel نەدۆزرایەوە (پێویست بە ستوونەکانی Latatude و Longitude).");
        }
      }
      if (!cancelled) setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const colorStyleByGroupKey = useMemo(
    () => buildColorStyleByGroupKey(points),
    [points],
  );

  const legendByRegionAndDistrict = useMemo(() => {
    const byRegion = new Map();
    for (const p of points) {
      const r = p.region || "Suli";
      const dk = mapDistrictKey(p);
      const sk = mapStyleGroupKey(p);
      if (!byRegion.has(r)) byRegion.set(r, new Map());
      const dm = byRegion.get(r);
      if (!dm.has(dk)) dm.set(dk, new Set());
      dm.get(dk).add(sk);
    }
    const regions = [...byRegion.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    return regions.map((region) => {
      const dm = byRegion.get(region);
      const districtKeys = [...dm.keys()].sort((a, b) =>
        mapDistrictQadaLabel(a).localeCompare(mapDistrictQadaLabel(b), undefined, {
          sensitivity: "base",
        }),
      );
      return {
        region,
        districts: districtKeys.map((dk) => ({
          districtKey: dk,
          qadaLabel: mapDistrictQadaLabel(dk),
          styleKeys: [...dm.get(dk)].sort((a, b) =>
            styleKeyGroupLabel(a).localeCompare(styleKeyGroupLabel(b), undefined, {
              sensitivity: "base",
            }),
          ),
        })),
      };
    });
  }, [points]);

  const boundaryPolygons = useMemo(() => {
    if (boundaryLevel === "off" || !points.length) return [];

    if (boundaryLevel === "district") {
      const { districts, hueByDistrict } = buildDistrictHueByName(points);
      return districts
        .map((d) => {
          const grp = points.filter((p) => mapDistrictKey(p) === d);
          const ring = boundaryRingForPoints(grp);
          if (!ring) return null;
          const hue = hueByDistrict.get(d);
          if (hue === undefined) return null;
          const region = grp[0]?.region || "Suli";
          const qada = mapDistrictQadaLabel(d);
          return {
            key: `dist-${d}`,
            positions: ring,
            pathOptions: districtPolygonPathOptions(hue),
            label: `${region} — ${qada}`,
          };
        })
        .filter(Boolean);
    }

    const styleKeys = [...new Set(points.map((p) => mapStyleGroupKey(p)))].sort((a, b) =>
      styleKeyGroupLabel(a).localeCompare(styleKeyGroupLabel(b), undefined, {
        sensitivity: "base",
      }),
    );
    return styleKeys
      .map((styleKey) => {
        const grp = points.filter((p) => mapStyleGroupKey(p) === styleKey);
        const ring = boundaryRingForPoints(grp);
        if (!ring) return null;
        const markerOpts =
          colorStyleByGroupKey.get(styleKey) ??
          pathOptionsForSubdistrictShade(0, 1, 200);
        const region = grp[0]?.region || "Suli";
        return {
          key: `sub-${styleKey}`,
          positions: ring,
          pathOptions: subdistrictPolygonPathOptions(markerOpts),
          label: `${region} — ${styleKeyGroupLabel(styleKey)}`,
        };
      })
      .filter(Boolean);
  }, [points, boundaryLevel, colorStyleByGroupKey]);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0c0e12",
        color: "#e2e8f0",
        fontFamily: '"DM Sans", system-ui, sans-serif',
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.25)",
        }}
      >
        <a
          href="/"
          style={{ color: "rgba(255,255,255,0.9)", textDecoration: "none", fontWeight: 600 }}
        >
          ← OSM boundaries
        </a>
        <span style={{ fontWeight: 700 }}>بنکەکانی دەنگدان — Suli · Duhok · Halbja</span>
        <a
          href="/suli-centers"
          style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontSize: 13 }}
        >
          Suli centers
        </a>
        <a
          href="/duhok-centers"
          style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontSize: 13 }}
        >
          Duhok centers
        </a>
        <a
          href="/halbja-centers"
          style={{ color: "rgba(255,255,255,0.85)", textDecoration: "none", fontSize: 13 }}
        >
          Halbja centers
        </a>
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
                name="mapTypePc"
                value={t.id}
                checked={mapTypeId === t.id}
                onChange={() => setMapTypeId(t.id)}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        <fieldset
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 8,
            padding: "6px 12px",
            margin: 0,
          }}
        >
          <legend style={{ fontSize: 12, opacity: 0.9 }}>Boundaries</legend>
          {[
            { value: "off", label: "Off" },
            { value: "district", label: "By district (قەزا)" },
            { value: "subdistrict", label: "By subdistrict (ناحیە)" },
          ].map(({ value, label }) => (
            <label
              key={value}
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
                name="boundaryLevelPc"
                value={value}
                checked={boundaryLevel === value}
                onChange={() => setBoundaryLevel(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {loading && (
          <span style={{ fontSize: 13, opacity: 0.9 }}>
            بارکردن… {loadDetail}
          </span>
        )}
        {!loading && !error && (
          <span style={{ fontSize: 13, opacity: 0.9 }}>{loadDetail}</span>
        )}
        {error && !loading && (
          <span style={{ fontSize: 13, color: "#ffb3b3" }}>{error}</span>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside
          style={{
            width: 280,
            flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,0.1)",
            overflow: "auto",
            padding: "12px 14px",
            fontSize: 12,
            background: "#141820",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>
            هەرێم → قەزا → ناحیە
          </div>
          <p style={{ margin: "0 0 12px", color: "#94a3b8", lineHeight: 1.45 }}>
            هەر قەزایەک ڕەنگی سەرەکی جیاواز؛ ناحیەکانی ناو هەمان قەزا وشێنە جیاوازەکانی
            هەمان ڕەنگن. لەسەر نەخشەکە دەتوانیت سنووری کۆنڤێکس (چوارگۆشەی بازنەیی) بۆ
            هەموو بنکەکانی هەر قەزا یان هەر ناحیەیەک ببینیت.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {legendByRegionAndDistrict.map(({ region, districts: distRows }) => (
              <section key={region}>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 11,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "#94a3b8",
                    marginBottom: 10,
                    paddingBottom: 6,
                    borderBottom: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  {region}
                </div>
                {distRows.map(({ districtKey, qadaLabel, styleKeys }) => (
                  <div key={districtKey} style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        color: "#cbd5e1",
                        marginBottom: 6,
                      }}
                    >
                      قەزا: {qadaLabel}
                    </div>
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {styleKeys.map((sk) => {
                        const n = points.filter((p) => mapStyleGroupKey(p) === sk).length;
                        const po =
                          colorStyleByGroupKey.get(sk) ??
                          pathOptionsForSubdistrictShade(0, 1, 200);
                        return (
                          <li
                            key={sk}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 8,
                              lineHeight: 1.35,
                            }}
                          >
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: "50%",
                                flexShrink: 0,
                                background: po.fillColor,
                                border: `2px solid ${po.color}`,
                              }}
                              aria-hidden
                            />
                            <span>
                              {styleKeyGroupLabel(sk)}
                              <span style={{ color: "#64748b" }}> ({n})</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </aside>

        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            style={{ width: "100%", height: "100%" }}
            scrollWheelZoom
          >
            <TileLayer attribution={mapConfig.attribution} url={mapConfig.url} />
            {points.length > 0 && <FitPollingBounds points={points} />}
            {/* Lower z-index than markers so convex hull fills don’t steal clicks from points. */}
            <Pane name="pollingBoundaries" style={{ zIndex: 390 }}>
              {boundaryPolygons.map((layer) => (
                <Polygon
                  key={layer.key}
                  positions={layer.positions}
                  pathOptions={layer.pathOptions}
                >
                  <Popup>
                    <div style={{ fontSize: 13, maxWidth: 280 }}>{layer.label}</div>
                  </Popup>
                </Polygon>
              ))}
            </Pane>
            <Pane name="pollingMarkers" style={{ zIndex: 650 }}>
              {points.map((p, idx) => {
                const sk = mapStyleGroupKey(p);
                return (
                  <CircleMarker
                    key={`${sk}-${idx}-${p.lat}-${p.lng}`}
                    center={[p.lat, p.lng]}
                    radius={6}
                    pathOptions={
                      colorStyleByGroupKey.get(sk) ??
                      pathOptionsForSubdistrictShade(0, 1, 200)
                    }
                  >
                    <Popup>
                      <div style={{ minWidth: 200, fontSize: 13 }}>
                        <span style={{ fontSize: 11, opacity: 0.75 }}>{p.region || "Suli"}</span>
                        <br />
                        <strong>{p.name}</strong>
                        {p.address && (
                          <>
                            <br />
                            {p.address}
                          </>
                        )}
                        {(p.qada || p.nahya) && (
                          <>
                            <br />
                            <span style={{ opacity: 0.85 }}>
                              {p.qada && <>{p.qada}</>}
                              {p.qada && p.nahya && " · "}
                              {p.nahya && <>{p.nahya}</>}
                            </span>
                          </>
                        )}
                        <br />
                        <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.8 }}>
                          {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                        </span>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </Pane>
          </MapContainer>
        </div>
      </div>
    </div>
  );
}
