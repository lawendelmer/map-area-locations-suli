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

export const ERBIL_XLSX_GLOB = import.meta.glob("../Erbil/**/*.xlsx", {
  query: "?url",
  import: "default",
});

/** Combined workbooks for the polling-center map (Suli + Duhok + Halbja + Erbil). */
export const ALL_POLLING_XLSX_GLOB = {
  ...SULI_XLSX_GLOB,
  ...DUHOK_XLSX_GLOB,
  ...HALBJA_XLSX_GLOB,
  ...ERBIL_XLSX_GLOB,
};

const REGION_XLSX_GLOB = {
  Suli: SULI_XLSX_GLOB,
  Duhok: DUHOK_XLSX_GLOB,
  Halbja: HALBJA_XLSX_GLOB,
  Erbil: ERBIL_XLSX_GLOB,
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

/** Skip rows used as placeholders: null/empty, non-numeric, or 0,0 (invalid for IQ polling data). */
export function isUsablePollingLatLng(lat, lng) {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 || lng === 0) return false;
  return true;
}

const POLL_CENTER_NAME_HEADERS = ["ناوى بنکەى دەنگدان", "ناوی بنکەی دەنگدان"];
const POLL_CENTER_ADDRESS_HEADERS = [
  "ناونیشانى بنکەى دەنگدان",
  "ناونیشانی بنکەی دەنگدان",
];

function findFirstHeaderIndex(headerCells, candidates) {
  for (const c of candidates) {
    const i = headerCells.findIndex((h) => h === c);
    if (i >= 0) return i;
  }
  return -1;
}

/** One cell with both coordinates (e.g. typo header Latatude.ongitude). */
function headerLooksLikeCombinedLatLng(norm) {
  const compact = norm.replace(/\s+/g, "").replace(/،/g, "");
  const isPureLatCol =
    compact === "latatude" || compact === "latitude" || compact === "lat" || compact === "y";
  const isPureLngCol =
    compact === "longitude" ||
    compact === "long" ||
    compact === "lng" ||
    compact === "lon" ||
    compact === "x";
  if (isPureLatCol || isPureLngCol) return false;
  const hasLat =
    compact.includes("latatude") || compact.includes("latitude");
  const hasLng =
    compact.includes("longitude") || compact.includes("ongitude");
  return hasLat && hasLng;
}

function parseLatLngFromCombinedCell(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { lat: NaN, lng: NaN };
  const split = s
    .split(/[,،;/|]|\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (split.length >= 2) {
    return { lat: Number(split[0]), lng: Number(split[1]) };
  }
  const w = s.split(/\s+/).filter(Boolean);
  if (w.length >= 2) {
    return { lat: Number(w[0]), lng: Number(w[1]) };
  }
  return { lat: NaN, lng: NaN };
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
  if (idxLat !== -1 && idxLng !== -1) return true;
  return headerNorm.some((h) => headerLooksLikeCombinedLatLng(h));
}

/**
 * Parses leaf polling-center workbooks (Kurdish headers, Latatude/Longitude or one combined column).
 * Returns [] if this file is a listing sheet without coordinates.
 */
export function parsePollingCentersXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];

  const headerCells = rows[0].map((c) => String(c ?? "").trim());
  const headerNorm = headerCells.map((c) => c.toLowerCase());

  let idxLat = headerNorm.findIndex(
    (h) => h === "latatude" || h === "latitude" || h === "lat" || h === "y",
  );
  let idxLng = headerNorm.findIndex(
    (h) =>
      h === "longitude" ||
      h === "long" ||
      h === "lng" ||
      h === "lon" ||
      h === "x",
  );
  let idxCombined = -1;
  if (idxLat === -1 || idxLng === -1) {
    idxCombined = headerNorm.findIndex((h) => headerLooksLikeCombinedLatLng(h));
  }
  if (idxCombined === -1 && (idxLat === -1 || idxLng === -1)) return [];

  const idxNahya = headerCells.findIndex((h) => h === "ناحیە" || h === "ناهیە");
  const idxQada = headerCells.findIndex((h) => h === "قەزا");
  const idxName = findFirstHeaderIndex(headerCells, POLL_CENTER_NAME_HEADERS);
  const idxAddress = findFirstHeaderIndex(headerCells, POLL_CENTER_ADDRESS_HEADERS);

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    let lat;
    let lng;
    if (idxCombined >= 0) {
      const pair = parseLatLngFromCombinedCell(row[idxCombined]);
      lat = pair.lat;
      lng = pair.lng;
      if (row[idxCombined] === "" || row[idxCombined] == null) continue;
    } else {
      const rawLat = row[idxLat];
      const rawLng = row[idxLng];
      if (rawLat === "" && rawLng === "") continue;
      lat = Number(rawLat);
      lng = Number(rawLng);
    }
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

/**
 * Writes edited قەزا/ناحیە center coordinates back into a polling-format sheet (same layout as parse).
 * @param {Record<string, { lat?: number, lng?: number }>} subCentersRecord - keys = point.groupKey from parse
 * @param {Record<string, { lat?: number, lng?: number }>} districtCentersRecord - keys = trimmed قەزا name
 */
export function applyPollingCenterCoordsToWorkbookBuffer(
  buffer,
  subCentersRecord,
  districtCentersRecord,
) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) {
    return new Uint8Array(buffer);
  }

  const headerCells = rows[0].map((c) => String(c ?? "").trim());
  const headerNorm = headerCells.map((c) => c.toLowerCase());

  let idxLat = headerNorm.findIndex(
    (h) => h === "latatude" || h === "latitude" || h === "lat" || h === "y",
  );
  let idxLng = headerNorm.findIndex(
    (h) =>
      h === "longitude" ||
      h === "long" ||
      h === "lng" ||
      h === "lon" ||
      h === "x",
  );
  let idxCombined = -1;
  if (idxLat === -1 || idxLng === -1) {
    idxCombined = headerNorm.findIndex((h) => headerLooksLikeCombinedLatLng(h));
  }
  if (idxCombined === -1 && (idxLat === -1 || idxLng === -1)) {
    return new Uint8Array(buffer);
  }

  const idxNahya = headerCells.findIndex((h) => h === "ناحیە" || h === "ناهیە");
  const idxQada = headerCells.findIndex((h) => h === "قەزا");

  let maxIdx = 0;
  for (const row of rows) {
    maxIdx = Math.max(maxIdx, row.length);
  }
  const needIdx =
    idxCombined >= 0 ? idxCombined : Math.max(idxLat, idxLng);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    while (row.length <= needIdx) row.push("");

    const nahya =
      idxNahya >= 0 && row[idxNahya] != null
        ? String(row[idxNahya]).trim()
        : "";
    const qada =
      idxQada >= 0 && row[idxQada] != null ? String(row[idxQada]).trim() : "";
    const groupKey =
      nahya || qada
        ? [qada, nahya].filter(Boolean).join(" — ") || nahya || qada || "ناونیشان نییە"
        : "ناونیشان نییە";

    const sub = subCentersRecord[groupKey];
    const dist = qada ? districtCentersRecord[qada] : null;
    let lat;
    let lng;
    if (sub && Number.isFinite(sub.lat) && Number.isFinite(sub.lng)) {
      lat = sub.lat;
      lng = sub.lng;
    } else if (dist && Number.isFinite(dist.lat) && Number.isFinite(dist.lng)) {
      lat = dist.lat;
      lng = dist.lng;
    } else {
      continue;
    }

    if (idxCombined >= 0) {
      row[idxCombined] = `${lat},${lng}`;
    } else {
      row[idxLat] = lat;
      row[idxLng] = lng;
    }
  }

  let maxCol = 0;
  for (const row of rows) {
    maxCol = Math.max(maxCol, row.length);
  }
  for (const row of rows) {
    while (row.length < maxCol) row.push("");
  }

  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

/**
 * One sheet: only edited قەزا / ناحیە center points (Longitude, Latitude as numbers).
 * Rows are grouped by قەزا (district row, then its ناحیە rows). No polling stations.
 * @param {string[]} sortedDistrictHierarchy - sorted قەزا keys (as in the editor sidebar)
 * @param {Record<string, { lat?: number, lng?: number }>} districtCenters
 * @param {Map<string, Array<{ lat?: number, lng?: number, qada?: string, nahya?: string }>>} subsByDistrict
 */
export function buildEditedCentersSummaryBuffer(
  sortedDistrictHierarchy,
  districtCenters,
  subsByDistrict,
) {
  const rows = [["Level", "قەزا", "ناحیە", "Longitude", "Latitude"]];

  for (const d of sortedDistrictHierarchy || []) {
    const dc = districtCenters[d];
    if (dc && Number.isFinite(dc.lat) && Number.isFinite(dc.lng)) {
      rows.push(["district", d, "", dc.lng, dc.lat]);
    }
    const subs = subsByDistrict?.get(d) || [];
    for (const c of subs) {
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
      rows.push([
        "subdistrict",
        String(c.qada ?? "").trim(),
        String(c.nahya ?? "").trim(),
        c.lng,
        c.lat,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ناوەندەکان");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
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
