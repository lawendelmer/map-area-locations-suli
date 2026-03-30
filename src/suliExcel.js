import * as XLSX from "xlsx";

export const SULI_XLSX_GLOB = import.meta.glob("../Suli/**/*.xlsx", {
  query: "?url",
  import: "default",
});

export const DUHOK_XLSX_GLOB = import.meta.glob("../Duhok/**/*.xlsx", {
  query: "?url",
  import: "default",
});

export const HALBJA_XLSX_GLOB = import.meta.glob("../Halbja/**/*.xlsx", {
  query: "?url",
  import: "default",
});

/** Combined workbooks for the polling-center map (Suli + Duhok + Halbja). */
export const ALL_POLLING_XLSX_GLOB = {
  ...SULI_XLSX_GLOB,
  ...DUHOK_XLSX_GLOB,
  ...HALBJA_XLSX_GLOB,
};

const REGION_XLSX_GLOB = {
  Suli: SULI_XLSX_GLOB,
  Duhok: DUHOK_XLSX_GLOB,
  Halbja: HALBJA_XLSX_GLOB,
};

export function getRegionXlsxGlob(regionFolder) {
  const key = String(regionFolder || "Suli").trim();
  return REGION_XLSX_GLOB[key] ?? SULI_XLSX_GLOB;
}

/** First path segment after `../` → folder name (Suli, Duhok, Halbja, …). */
export function regionFromGlobKey(globKey) {
  const rel = globKey.replace(/^\.\.\//, "").replace(/\\/g, "/");
  const first = rel.split("/")[0];
  return first || "Suli";
}

/** Unit separator — unlikely to appear in Kurdish Excel labels. */
const MAP_STYLE_KEY_SEP = "\u001f";

/** Unique district bucket on the map across governorates: `Region/qada`. */
export function mapDistrictKey(p) {
  const r = p.region || "Suli";
  const q = (p.qada && p.qada.trim()) || "—";
  return `${r}/${q}`;
}

/** Stable key for marker colors / subdistrict boundaries across regions. */
export function mapStyleGroupKey(p) {
  const r = p.region || "Suli";
  return `${r}${MAP_STYLE_KEY_SEP}${p.groupKey}`;
}

export function styleKeyGroupLabel(styleKey) {
  const i = styleKey.indexOf(MAP_STYLE_KEY_SEP);
  return i === -1 ? styleKey : styleKey.slice(i + MAP_STYLE_KEY_SEP.length);
}

export function mapDistrictQadaLabel(districtKey) {
  if (!districtKey || !String(districtKey).includes("/")) return districtKey;
  return String(districtKey).split("/").slice(1).join("/");
}

export function districtKeyOf(p) {
  return (p.qada && p.qada.trim()) || "—";
}

/**
 * True if first sheet has polling-style lat/lng columns (leaf workbook).
 */
export function workbookHasPollingCoordColumns(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return false;
  const headerNorm = rows[0].map((c) => String(c ?? "").trim().toLowerCase());
  const idxLat = headerNorm.findIndex(
    (h) => h === "latatude" || h === "latitude" || h === "lat" || h === "y",
  );
  const idxLng = headerNorm.findIndex(
    (h) =>
      h === "longitude" ||
      h === "long" ||
      h === "lng" ||
      h === "lon" ||
      h === "x",
  );
  return idxLat !== -1 && idxLng !== -1;
}

/** Skip rows used as placeholders: null/empty, non-numeric, or 0,0 (invalid for IQ polling data). */
export function isUsablePollingLatLng(lat, lng) {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 || lng === 0) return false;
  return true;
}

/**
 * Parses leaf polling-center workbooks (Kurdish headers, Latatude/Longitude).
 * Returns [] if this file is a listing sheet without coordinates.
 */
export function parsePollingCentersXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];

  const headerCells = rows[0].map((c) => String(c ?? "").trim());
  const headerNorm = headerCells.map((c) => c.toLowerCase());

  const idxLat = headerNorm.findIndex(
    (h) => h === "latatude" || h === "latitude" || h === "lat" || h === "y",
  );
  const idxLng = headerNorm.findIndex(
    (h) =>
      h === "longitude" ||
      h === "long" ||
      h === "lng" ||
      h === "lon" ||
      h === "x",
  );
  if (idxLat === -1 || idxLng === -1) return [];

  const idxNahya = headerCells.findIndex((h) => h === "ناحیە");
  const idxQada = headerCells.findIndex((h) => h === "قەزا");
  const idxName = headerCells.findIndex((h) => h === "ناوى بنکەى دەنگدان");
  const idxAddress = headerCells.findIndex((h) => h === "ناونیشانى بنکەى دەنگدان");

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawLat = row[idxLat];
    const rawLng = row[idxLng];
    if (rawLat === "" && rawLng === "") continue;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!isUsablePollingLatLng(lat, lng)) continue;

    const nahya =
      idxNahya >= 0 && row[idxNahya] != null
        ? String(row[idxNahya]).trim()
        : "";
    const qada =
      idxQada >= 0 && row[idxQada] != null ? String(row[idxQada]).trim() : "";
    const name =
      idxName >= 0 && row[idxName] != null
        ? String(row[idxName]).trim()
        : "";
    const address =
      idxAddress >= 0 && row[idxAddress] != null
        ? String(row[idxAddress]).trim()
        : "";

    const groupKey =
      nahya || qada
        ? [qada, nahya].filter(Boolean).join(" — ") || nahya || qada || "ناونیشان نییە"
        : "ناونیشان نییە";

    out.push({
      lat,
      lng,
      name: name || `بنکە ${i}`,
      nahya,
      qada,
      address,
      groupKey,
    });
  }
  return out;
}

/** Vite glob key `../Suli/...` → zip entry path `Suli/...` (any region root). */
export function globKeyToSuliZipPath(globKey) {
  return globKey.replace(/^\.\.\//, "").replace(/\\/g, "/");
}

export const globKeyToRegionZipPath = globKeyToSuliZipPath;

/**
 * Extract district label from path segments (folder `District-Name`).
 */
export function districtNameFromZipPath(zipPath) {
  const parts = zipPath.split("/");
  for (const seg of parts) {
    const m = seg.match(/^District-\s*(.+)$/i);
    if (m) return m[1].trim();
    const m2 = seg.match(/^district\s*-\s*(.+)$/i);
    if (m2) return m2[1].trim();
  }
  return null;
}

export function isProvinceListingPath(zipPath) {
  const base = zipPath.split("/").pop() || "";
  return /^Province-/i.test(base) || /^province-/i.test(base);
}

/**
 * Add/update Longitude & Latitude on first sheet; name column = 0.
 * @param {(trimmedName: string) => { lat: number, lng: number } | null} lookupCoords
 */
export function enrichListingWorkbook(buffer, lookupCoords) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) {
    return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  }

  const header = rows[0].map((c) => String(c ?? "").trim());
  let idxLng = header.findIndex((h) => h.toLowerCase() === "longitude");
  let idxLat = header.findIndex((h) => h.toLowerCase() === "latitude");

  let width = 0;
  for (const row of rows) {
    width = Math.max(width, row.length);
  }

  if (idxLng === -1 || idxLat === -1) {
    idxLng = width;
    idxLat = width + 1;
    for (let r = 0; r < rows.length; r++) {
      while (rows[r].length <= idxLat) rows[r].push("");
    }
    rows[0][idxLng] = "Longitude";
    rows[0][idxLat] = "Latitude";
  }

  const nameCol = 0;
  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][nameCol] ?? "").trim();
    if (!name) continue;
    const coords = lookupCoords(name);
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
      while (rows[i].length <= idxLat) rows[i].push("");
      rows[i][idxLng] = coords.lng;
      rows[i][idxLat] = coords.lat;
    }
  }

  let maxCol = 0;
  for (const row of rows) {
    maxCol = Math.max(maxCol, row.length);
  }
  for (const row of rows) {
    while (row.length < maxCol) row.push("");
  }

  const newSheet = XLSX.utils.aoa_to_sheet(rows);
  workbook.Sheets[sheetName] = newSheet;
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}
