import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { MAP_TYPES } from "./mapConfig";

const STORAGE_KEY = "mapAreaMapType";

const MapTypeContext = createContext(null);

export function MapTypeProvider({ children }) {
  const [mapTypeId, setMapTypeIdState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && MAP_TYPES.some((t) => t.id === stored)) return stored;
    } catch (_) {}
    return "hot";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mapTypeId);
    } catch (_) {}
  }, [mapTypeId]);

  const setMapTypeId = useCallback((id) => {
    if (MAP_TYPES.some((t) => t.id === id)) setMapTypeIdState(id);
  }, []);

  const value = { mapTypeId, setMapTypeId, MAP_TYPES };
  return (
    <MapTypeContext.Provider value={value}>{children}</MapTypeContext.Provider>
  );
}

export function useMapType() {
  const ctx = useContext(MapTypeContext);
  if (!ctx) throw new Error("useMapType must be used within MapTypeProvider");
  return ctx;
}
