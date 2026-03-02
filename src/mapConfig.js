/**
 * Shared map tile layer config.
 * Multiple map types; selection is stored in MapTypeContext (main index page).
 */

export const MAP_TYPES = [
  {
    id: "hot",
    label: "Humanitarian OSM (HOT)",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://hot.openstreetmap.org/">Humanitarian OSM Team</a>',
  },
  {
    id: "osm",
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
];

const DEFAULT_MAP_TYPE_ID = "hot";

export function getMapConfig(mapTypeId) {
  const found = MAP_TYPES.find((t) => t.id === mapTypeId);
  return found ?? MAP_TYPES.find((t) => t.id === DEFAULT_MAP_TYPE_ID);
}

/** @deprecated Use getMapConfig(mapTypeId) from MapTypeContext instead */
export const MAP_TILE_URL = MAP_TYPES[0].url;
/** @deprecated Use getMapConfig(mapTypeId) from MapTypeContext instead */
export const MAP_ATTRIBUTION = MAP_TYPES[0].attribution;
