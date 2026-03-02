import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MapTypeProvider } from "./MapTypeContext";
import KomitaMap from "./KomitaMap";
import OsmBoundariesPage from "./OsmBoundariesPage";
import RegistrationPage from "./RegistrationPage";
import ExtraLocationsPage from "./ExtraLocationsPage";

function App() {
  return (
    <MapTypeProvider>
      <BrowserRouter>
        <div style={{ width: "100%", height: "100vh", margin: 0, padding: 0 }}>
          <Routes>
          <Route path="/" element={<OsmBoundariesPage />} />
          <Route path="/extract" element={<KomitaMap />} />
          <Route path="/register" element={<RegistrationPage />} />
          <Route path="/extra-locations" element={<ExtraLocationsPage />} />
          </Routes>
        </div>
      </BrowserRouter>
    </MapTypeProvider>
  );
}

export default App;
