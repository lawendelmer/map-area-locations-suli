/**
 * Lists polling-center rows with missing / invalid coordinates (null, empty, non-numeric, or zero).
 * Run from repo root: node scripts/list-missing-coords.mjs
 * Optional: node scripts/list-missing-coords.mjs --json > missing-coords.json
 */
import * as XLSX from "xlsx";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const REGION_DIRS = ["Suli", "Duhok", "Halbja"];

function isUsablePollingLatLng(lat, lng) {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 || lng === 0) return false;
  return true;
}

function walkXlsxFiles(dir, relBase = "") {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const name = ent.name;
    if (name.startsWith("~$")) continue;
    const full = join(dir, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    if (ent.isDirectory()) {
      out.push(...walkXlsxFiles(full, rel));
    } else if (name.endsWith(".xlsx")) {
      out.push({ full, rel: rel.replace(/\\/g, "/") });
    }
  }
  return out;
}

function reasonForInvalid(lat, lng, rawLat, rawLng) {
  if (rawLat === "" && rawLng === "") return "both_empty";
  if (rawLat === "" || rawLng === "") return "one_empty";
  if (rawLat == null || rawLng == null) return "null";
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "not_a_number";
  if (lat === 0 && lng === 0) return "both_zero";
  if (lat === 0) return "latitude_zero";
  if (lng === 0) return "longitude_zero";
  return "unknown";
}

function findMissingInBuffer(buffer, fileRel) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
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

  const missing = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const rawLat = row[idxLat];
    const rawLng = row[idxLng];
    const lat = Number(rawLat);
    const lng = Number(rawLng);

    const name =
      idxName >= 0 && row[idxName] != null ? String(row[idxName]).trim() : "";
    const address =
      idxAddress >= 0 && row[idxAddress] != null
        ? String(row[idxAddress]).trim()
        : "";
    const nahya =
      idxNahya >= 0 && row[idxNahya] != null ? String(row[idxNahya]).trim() : "";
    const qada =
      idxQada >= 0 && row[idxQada] != null ? String(row[idxQada]).trim() : "";

    const hasLabel = Boolean(name || address || nahya || qada);
    const bothCoordEmpty =
      (rawLat === "" || rawLat == null) && (rawLng === "" || rawLng == null);
    if (bothCoordEmpty && !hasLabel) continue;

    if (isUsablePollingLatLng(lat, lng)) continue;

    missing.push({
      file: fileRel,
      sheetRow: i + 1,
      reason: reasonForInvalid(lat, lng, rawLat, rawLng),
      rawLatitude: rawLat === "" ? "(empty)" : rawLat,
      rawLongitude: rawLng === "" ? "(empty)" : rawLng,
      name: name || "—",
      qada: qada || "—",
      nahya: nahya || "—",
      address: address || "—",
    });
  }
  return missing;
}

const jsonOut = process.argv.includes("--json");

const all = [];
for (const region of REGION_DIRS) {
  const dir = join(ROOT, region);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const { full, rel } of walkXlsxFiles(dir, region)) {
    let buffer;
    try {
      buffer = readFileSync(full);
    } catch {
      continue;
    }
    const relFromRoot = relative(ROOT, full).replace(/\\/g, "/");
    all.push(...findMissingInBuffer(buffer, relFromRoot));
  }
}

all.sort((a, b) =>
  a.file.localeCompare(b.file, undefined, { sensitivity: "base" }) ||
  a.sheetRow - b.sheetRow,
);

if (jsonOut) {
  console.log(JSON.stringify(all, null, 2));
  process.exit(0);
}

console.log(
  `Locations with missing or invalid coordinates (null, empty, non-numeric, or zero): ${all.length}\n`,
);
console.log("(Same rules as the map: rows need finite lat/lng and neither may be 0.)\n");

for (const r of all) {
  console.log(
    [
      r.file,
      `row ${r.sheetRow}`,
      `[${r.reason}]`,
      `lat=${r.rawLatitude}`,
      `lng=${r.rawLongitude}`,
      `name=${r.name}`,
      `قەزا=${r.qada}`,
      `ناحیە=${r.nahya}`,
    ].join(" | "),
  );
}
