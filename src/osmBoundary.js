/**
 * Load OSM relation boundaries via the Overpass API.
 * Overpass returns relations with member ways and inline geometry (out geom).
 * We convert that to GeoJSON MultiPolygon for use with Leaflet.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** One boundary at a time; longer delay to avoid Overpass 429 rate limit. */
const BATCH_SIZE = 1;
const DELAY_BETWEEN_BATCHES_MS = 45000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CACHE_KEY_PREFIX = "osm-boundaries-geojson-";

export function getCacheKey(idStart, idEnd) {
  return `${CACHE_KEY_PREFIX}${idStart}-${idEnd}`;
}

/**
 * Load cached FeatureCollection from localStorage. Returns null if missing or invalid.
 * @returns {object|null} - GeoJSON FeatureCollection or null
 */
export function getCachedBoundaries(cacheKey) {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.type !== "FeatureCollection" || !Array.isArray(data.features))
      return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save FeatureCollection to localStorage as GeoJSON.
 */
export function setCachedBoundaries(cacheKey, featureCollection) {
  try {
    const json = JSON.stringify(
      {
        type: "FeatureCollection",
        features: featureCollection.features ?? [],
      },
      null,
      2,
    );
    localStorage.setItem(cacheKey, json);
  } catch (e) {
    console.warn("Failed to cache OSM boundaries:", e);
  }
}

function getCachedOsmIds(featureCollection) {
  const ids = new Set();
  for (const f of featureCollection?.features ?? []) {
    const id = f.properties?.osm_id;
    if (id != null) ids.add(Number(id));
  }
  return ids;
}

/**
 * Fetch a relation by ID from Overpass with full geometry.
 * @param {number|string} relationId - OSM relation ID (e.g. 18201548)
 * @returns {Promise<object>} - The relation object from Overpass (elements[0])
 */
export async function fetchOsmRelationById(relationId) {
  const id = String(relationId).trim();
  if (!id) throw new Error("Relation ID is required");
  const query = `[out:json];rel(${id});out geom;`;
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`);
  const data = await res.json();
  if (!data.elements?.length)
    throw new Error(`No relation found for ID ${relationId}`);
  const relation = data.elements[0];
  if (relation.type !== "relation")
    throw new Error(`ID ${relationId} is not a relation`);
  return relation;
}

/**
 * Simple point-in-polygon (ray casting). Polygon is array of [lon, lat].
 */
function pointInPolygon(lon, lat, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Close a ring (ensure first point equals last). Coords as [lon, lat].
 */
function closeRing(coords) {
  if (coords.length < 3) return coords;
  const [a, b] = coords[0];
  const [z, w] = coords[coords.length - 1];
  if (a === z && b === w) return coords;
  return [...coords, [a, b]];
}

/**
 * Convert OSM relation (with way members that have geometry) to a GeoJSON Feature.
 * Handles multipolygon: outer and inner roles, matches inners to containing outer.
 * @param {object} relation - Overpass relation (with members[].geometry)
 * @returns {object} - GeoJSON Feature with geometry.type MultiPolygon
 */
export function relationToGeoJSON(relation) {
  const outers = [];
  const inners = [];
  for (const member of relation.members || []) {
    if (member.type !== "way" || !member.geometry?.length) continue;
    const coords = member.geometry.map((p) => [Number(p.lon), Number(p.lat)]);
    const closed = closeRing(coords);
    if (closed.length < 4) continue;
    if (member.role === "outer") outers.push(closed);
    else if (member.role === "inner") inners.push(closed);
  }

  if (outers.length === 0) {
    return {
      type: "Feature",
      properties: relation.tags || {},
      geometry: { type: "MultiPolygon", coordinates: [] },
    };
  }

  const polygons = [];
  for (const outer of outers) {
    const holes = inners.filter((inner) => {
      const [lon, lat] = inner[0];
      return pointInPolygon(lon, lat, outer);
    });
    polygons.push([outer, ...holes]);
  }

  const properties = {
    ...(relation.tags || {}),
    osm_id: relation.id,
    osm_type: "relation",
  };
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "MultiPolygon",
      coordinates: polygons,
    },
  };
}

/**
 * Load an OSM relation by ID and return a GeoJSON Feature (MultiPolygon).
 * @param {number|string} relationId
 * @returns {Promise<object>} - GeoJSON Feature
 */
export async function loadOsmBoundaryGeoJSON(relationId) {
  const relation = await fetchOsmRelationById(relationId);
  return relationToGeoJSON(relation);
}

/**
 * Fetch multiple relations by ID in one Overpass query.
 * @param {number[]} relationIds - OSM relation IDs
 * @returns {Promise<object[]>} - Array of relation objects from Overpass
 */
export async function fetchOsmRelationsByIds(relationIds) {
  if (!relationIds?.length)
    throw new Error("At least one relation ID is required");
  const ids = relationIds.map((id) => Number(id));
  // Overpass: wrap in ( ... ) so the union collects all relations before output.
  const relStatements = ids.map((id) => `rel(${id});`).join("");
  const query = `[out:json];(${relStatements});out geom;`;
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error || "Overpass API error");
  }
  if (data.remark && data.remark.includes("rate_limited"))
    throw new Error("Overpass rate limited – try again later");
  const relations = (data.elements || []).filter(
    (el) => el.type === "relation",
  );
  return relations;
}

/**
 * Merge cached features with newly fetched features by osm_id. Order by relationIds.
 */
function mergeFeatures(relationIds, cachedFeatures, newFeatures) {
  const byId = new Map();
  for (const f of cachedFeatures) {
    const id = f.properties?.osm_id;
    if (id != null) byId.set(Number(id), f);
  }
  for (const f of newFeatures) {
    const id = f.properties?.osm_id;
    if (id != null) byId.set(Number(id), f);
  }
  const features = relationIds.map((id) => byId.get(id)).filter(Boolean);
  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * @typedef {Object} OsmLoadProgress
 * @property {'idle'|'cache'|'fetching'|'done'|'error'} phase
 * @property {number} total - Total boundaries desired (e.g. 61)
 * @property {number} [cachedCount] - Count already in cache
 * @property {number} [missingCount] - Count to fetch from API
 * @property {number} [fetchedSoFar] - Fetched in this run so far
 * @property {number} [batchIndex] - Current batch (1-based)
 * @property {number} [batchTotal] - Total batches
 * @property {string} [error] - Error message when phase === 'error'
 * @property {number} [loadedSoFar] - Total loaded (cached + fetched) when error
 */

/**
 * Load OSM relations as GeoJSON FeatureCollection. Uses localStorage cache when
 * cacheKey is provided: only fetches relation IDs not already in cache, then merges.
 * @param {number[]} relationIds - Full list of desired relation IDs (e.g. 18201500..18201560)
 * @param {{ cacheKey?: string, onProgress?: (p: OsmLoadProgress) => void }} [options]
 * @returns {Promise<object>} - GeoJSON FeatureCollection
 */
export async function loadOsmBoundariesGeoJSON(relationIds, options = {}) {
  const rawIds = relationIds ?? [];
  const relationIdsNorm = rawIds.map((id) => Number(id)).filter((id) => id > 0);
  const total = relationIdsNorm.length;
  const onProgress = options.onProgress ?? (() => {});

  if (!relationIdsNorm.length) {
    onProgress({ phase: "done", total: 0, cachedCount: 0, missingCount: 0 });
    return { type: "FeatureCollection", features: [] };
  }

  const cacheKey = options.cacheKey ?? null;
  const cached = cacheKey ? getCachedBoundaries(cacheKey) : null;
  const cachedIds = cached ? getCachedOsmIds(cached) : new Set();
  // Only fetch IDs not in cache so retries continue from the last completed request
  const missingIds = relationIdsNorm.filter((id) => !cachedIds.has(id));
  const cachedCount = cachedIds.size;

  onProgress({
    phase: "cache",
    total,
    cachedCount,
    missingCount: missingIds.length,
  });

  if (missingIds.length === 0 && cached) {
    onProgress({ phase: "done", total, cachedCount: total, missingCount: 0 });
    return cached;
  }

  let newFeatures = [];
  const batchTotal = Math.ceil(missingIds.length / BATCH_SIZE);

  try {
    for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
      const chunk = missingIds.slice(i, i + BATCH_SIZE);
      const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
      onProgress({
        phase: "fetching",
        total,
        cachedCount,
        missingCount: missingIds.length,
        fetchedSoFar: newFeatures.length,
        batchIndex,
        batchTotal,
      });

      const relations = await fetchOsmRelationsByIds(chunk);
      const batchFeatures = relations.map((rel) => relationToGeoJSON(rel));
      newFeatures = newFeatures.concat(batchFeatures);

      // Persist after every successful batch so retry continues from here (no redo)
      if (cacheKey) {
        const cachedFeatures = cached?.features ?? [];
        const partial = mergeFeatures(
          relationIdsNorm,
          cachedFeatures,
          newFeatures,
        );
        setCachedBoundaries(cacheKey, partial);
      }

      if (i + BATCH_SIZE < missingIds.length) {
        await delay(DELAY_BETWEEN_BATCHES_MS);
      }
    }
  } catch (err) {
    const loadedSoFar = cachedCount + newFeatures.length;
    onProgress({
      phase: "error",
      total,
      cachedCount,
      fetchedSoFar: newFeatures.length,
      loadedSoFar,
      error: err instanceof Error ? err.message : String(err),
    });
    // Save partial so retry only fetches missing IDs (continues from last success)
    if (cacheKey && (cached?.features?.length || newFeatures.length)) {
      const cachedFeatures = cached?.features ?? [];
      const partial = mergeFeatures(
        relationIdsNorm,
        cachedFeatures,
        newFeatures,
      );
      setCachedBoundaries(cacheKey, partial);
    }
    throw err;
  }

  const cachedFeatures = cached?.features ?? [];
  const result = mergeFeatures(relationIdsNorm, cachedFeatures, newFeatures);

  if (cacheKey) {
    setCachedBoundaries(cacheKey, result);
  }

  onProgress({
    phase: "done",
    total: result.features.length,
    cachedCount,
    missingCount: 0,
  });

  return result;
}

/**
 * Trigger browser download of a GeoJSON FeatureCollection.
 */
export function downloadGeoJSON(featureCollection, filename) {
  const fc =
    featureCollection?.type === "FeatureCollection"
      ? featureCollection
      : {
          type: "FeatureCollection",
          features: [featureCollection].filter(Boolean),
        };
  const json = JSON.stringify(fc, null, 2);
  const blob = new Blob([json], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
