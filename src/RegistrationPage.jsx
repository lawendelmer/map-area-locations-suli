import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import * as XLSX from "xlsx";
import "leaflet/dist/leaflet.css";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "./mapConfig";

import boundaryCentersUrl from "../boundary_centers.xlsx?url";

const MAX_DROPDOWN_ITEMS = 100;

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

function MapCenterController({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] != null && center[1] != null) {
      map.setView(center, map.getZoom());
    }
  }, [map, center]);
  return null;
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

const defaultCenter = [35.561355, 45.411612];

export default function RegistrationPage() {
  const [points, setPoints] = useState([]);
  const [error, setError] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [locationSearch, setLocationSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const locationDropdownRef = useRef(null);
  // Saved location: place name + lat/lng (default from dropdown center, or from map click)
  const [savedLocation, setSavedLocation] = useState(null);

  // Dummy form state
  const [form, setForm] = useState({
    fullName: "",
    gender: "",
    phoneNumber: "",
    email: "",
    dateOfBirth: "",
    address: "",
    occupation: "",
  });

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

  const filteredLocations = useMemo(() => {
    const q = (locationSearch || "").trim().toLowerCase();
    if (!points.length) return [];
    if (!q) return points.slice(0, MAX_DROPDOWN_ITEMS);
    return points
      .filter((p) => p.name && p.name.toLowerCase().includes(q))
      .slice(0, MAX_DROPDOWN_ITEMS);
  }, [points, locationSearch]);

  const mapCenter = useMemo(() => {
    if (savedLocation) return [savedLocation.lat, savedLocation.lng];
    if (selectedLocation) return [selectedLocation.lat, selectedLocation.lng];
    return defaultCenter;
  }, [savedLocation, selectedLocation]);

  const handleLocationSelect = useCallback((point) => {
    setSelectedLocation(point);
    setSavedLocation({
      placeName: point.name,
      lat: point.lat,
      lng: point.lng,
    });
    setLocationSearch("");
    setDropdownOpen(false);
  }, []);

  const handleMapClick = useCallback(({ lat, lng }) => {
    setSavedLocation((prev) =>
      prev ? { ...prev, lat, lng } : { placeName: "", lat, lng },
    );
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        locationDropdownRef.current &&
        !locationDropdownRef.current.contains(e.target)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const updateForm = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  return (
    <div className="reg-page">
      <style>{`
        .reg-page {
          --bg: #0c0e12;
          --surface: #141820;
          --surface-elevated: #1a1f2a;
          --border: rgba(255,255,255,0.08);
          --border-focus: rgba(14, 165, 233, 0.6);
          --text: #e2e8f0;
          --text-muted: #94a3b8;
          --accent: #0ea5e9;
          --accent-soft: rgba(14, 165, 233, 0.15);
          --success: #34d399;
          --error: #f87171;
        }
        .reg-page {
          width: 100%;
          min-height: 100vh;
          background: var(--bg);
          background-image:
            radial-gradient(ellipse 120% 80% at 50% -20%, rgba(14, 165, 233, 0.12), transparent),
            radial-gradient(ellipse 60% 50% at 100% 50%, rgba(14, 165, 233, 0.06), transparent);
          color: var(--text);
          font-family: "DM Sans", system-ui, sans-serif;
          padding: 24px 20px 32px;
          box-sizing: border-box;
        }
        .reg-page input,
        .reg-page select {
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .reg-page input:focus,
        .reg-page select:focus {
          outline: none;
          border-color: var(--border-focus);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .reg-page .reg-btn-primary {
          transition: transform 0.15s, box-shadow 0.2s;
        }
        .reg-page .reg-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(14, 165, 233, 0.35);
        }
        .reg-page .reg-btn-primary:active {
          transform: translateY(0);
        }
        .reg-page .reg-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 14px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.25);
        }
        .reg-page .reg-map-wrapper {
          position: relative;
        }
        .reg-page .reg-map-wrapper .leaflet-container {
          height: 100% !important;
          min-height: 420px;
        }
        @media (max-width: 720px) {
          .registration-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
      <div style={{ maxWidth: 1160, margin: "0 auto" }}>
        <header style={{ marginBottom: 28, textAlign: "center" }}>
          <div
            style={{
              display: "inline-block",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--accent)",
              background: "var(--accent-soft)",
              padding: "6px 12px",
              borderRadius: 20,
              marginBottom: 12,
            }}
          >
            Demo
          </div>
          <h1
            style={{
              fontSize: "1.85rem",
              fontWeight: 700,
              margin: 0,
              letterSpacing: "-0.03em",
              background: "linear-gradient(180deg, #fff 0%, #cbd5e1 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            تۆمارکردن
          </h1>
          <p style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 15 }}>
            Registration form with location picker
          </p>
        </header>

        <div
          className="registration-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 1fr) minmax(340px, 1.2fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          <section className="reg-card" style={{ padding: 20 }}>
            <h2
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                marginBottom: 14,
                color: "var(--text)",
                letterSpacing: "-0.01em",
              }}
            >
              Personal information
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <label style={labelStyle}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Full name
                </span>
                <input
                  type="text"
                  value={form.fullName}
                  onChange={(e) => updateForm("fullName", e.target.value)}
                  placeholder="e.g. Ahmed Mohammed"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Gender
                </span>
                <select
                  value={form.gender}
                  onChange={(e) => updateForm("gender", e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Phone number
                </span>
                <input
                  type="tel"
                  value={form.phoneNumber}
                  onChange={(e) => updateForm("phoneNumber", e.target.value)}
                  placeholder="e.g. +964 770 123 4567"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Email
                </span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateForm("email", e.target.value)}
                  placeholder="example@email.com"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Date of birth
                </span>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => updateForm("dateOfBirth", e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Address
                </span>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => updateForm("address", e.target.value)}
                  placeholder="Street, district, city"
                  style={inputStyle}
                />
              </label>
              <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Occupation
                </span>
                <input
                  type="text"
                  value={form.occupation}
                  onChange={(e) => updateForm("occupation", e.target.value)}
                  placeholder="e.g. Teacher, Engineer"
                  style={inputStyle}
                />
              </label>
            </div>
          </section>

          <section
            className="reg-card"
            style={{
              padding: 20,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <h2
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                marginBottom: 8,
                color: "var(--text)",
                letterSpacing: "-0.01em",
              }}
            >
              Location
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                marginBottom: 12,
                lineHeight: 1.45,
              }}
            >
              Search or select a place, then click the map to set your exact
              address.
            </p>
            <div
              ref={locationDropdownRef}
              style={{
                position: "relative",
                marginBottom: 10,
              }}
            >
              <input
                type="text"
                value={
                  dropdownOpen ? locationSearch : (selectedLocation?.name ?? "")
                }
                onChange={(e) => {
                  setLocationSearch(e.target.value);
                  setDropdownOpen(true);
                  if (!e.target.value) {
                    setSelectedLocation(null);
                    setSavedLocation(null);
                  }
                }}
                onFocus={() => {
                  setDropdownOpen(true);
                  setLocationSearch("");
                }}
                placeholder="Search or select place..."
                style={{
                  ...inputStyle,
                  width: "100%",
                  boxSizing: "border-box",
                }}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(!dropdownOpen);
                  if (!dropdownOpen) setLocationSearch("");
                }}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 4,
                  fontSize: 12,
                }}
                aria-label={dropdownOpen ? "Close" : "Open"}
              >
                {dropdownOpen ? "▲" : "▼"}
              </button>
              {dropdownOpen && (
                <ul
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    maxHeight: 240,
                    overflowY: "auto",
                    background: "var(--surface-elevated)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
                    zIndex: 1000,
                    marginTop: 6,
                  }}
                >
                  {filteredLocations.length === 0 ? (
                    <li
                      style={{
                        padding: "14px 16px",
                        fontSize: 14,
                        color: "var(--text-muted)",
                      }}
                    >
                      No places match. Type to search.
                    </li>
                  ) : (
                    filteredLocations.map((point) => (
                      <li
                        key={`${point.name}-${point.lat}-${point.lng}`}
                        onClick={() => handleLocationSelect(point)}
                        style={{
                          padding: "11px 16px",
                          fontSize: 14,
                          cursor: "pointer",
                          borderBottom: "1px solid var(--border)",
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "var(--accent-soft)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {point.name}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            {error && (
              <p
                style={{ fontSize: 12, color: "var(--error)", marginBottom: 8 }}
              >
                {error}
              </p>
            )}
            {savedLocation && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--success)",
                  marginBottom: 10,
                  padding: "8px 10px",
                  background: "rgba(52, 211, 153, 0.1)",
                  borderRadius: 8,
                  border: "1px solid rgba(52, 211, 153, 0.2)",
                }}
              >
                {savedLocation.placeName || "(no name)"} —{" "}
                {savedLocation.lat.toFixed(5)}, {savedLocation.lng.toFixed(5)}
              </p>
            )}
            <div
              className="reg-map-wrapper"
              style={{
                width: "100%",
                height: 420,
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid var(--border)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
              }}
            >
              <MapContainer
                center={mapCenter}
                zoom={12}
                style={{ width: "100%", height: "100%", minHeight: 420 }}
                scrollWheelZoom
                zoomControl={false}
              >
                <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILE_URL} />
                <MapCenterController center={mapCenter} />
                <MapClickHandler onMapClick={handleMapClick} />
                {savedLocation && (
                  <CircleMarker
                    center={[savedLocation.lat, savedLocation.lng]}
                    radius={10}
                    pathOptions={{
                      color: "#16a34a",
                      fillColor: "#22c55e",
                      fillOpacity: 1,
                      weight: 1.5,
                    }}
                  >
                    <Popup>
                      <strong>Your selected location</strong>
                      <br />
                      {savedLocation.placeName && (
                        <>
                          {savedLocation.placeName}
                          <br />
                        </>
                      )}
                      {savedLocation.lat.toFixed(5)},{" "}
                      {savedLocation.lng.toFixed(5)}
                    </Popup>
                  </CircleMarker>
                )}
              </MapContainer>
            </div>
          </section>
        </div>

        <div style={{ textAlign: "center", marginTop: 28 }}>
          <button
            type="button"
            className="reg-btn-primary"
            style={{
              padding: "14px 32px",
              fontSize: 15,
              fontWeight: 600,
              border: "none",
              borderRadius: 12,
              background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
              color: "#fff",
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(14, 165, 233, 0.25)",
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-elevated)",
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
};
