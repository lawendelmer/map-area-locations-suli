"""
Read OSM boundaries GeoJSON, compute center (centroid) of each boundary,
and write an Excel file with columns: Name, Latitude, Longitude.
"""
import json
import sys
from pathlib import Path

try:
    from shapely.geometry import shape
except ImportError:
    sys.exit("Install dependencies: pip install shapely openpyxl")

try:
    import openpyxl
    from openpyxl import Workbook
except ImportError:
    sys.exit("Install dependencies: pip install openpyxl")


def get_centroid(geojson_geometry):
    """Return (longitude, latitude) of the centroid using Shapely."""
    geom = shape(geojson_geometry)
    cent = geom.centroid
    return (cent.x, cent.y)


def main():
    script_dir = Path(__file__).resolve().parent
    geojson_path = script_dir / "irq_admin_boundaries.geojson" / "osm-boundaries-18201500-18201560.geojson"
    out_path = script_dir / "boundary_centers.xlsx"

    if not geojson_path.exists():
        print(f"GeoJSON not found: {geojson_path}")
        sys.exit(1)

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if data.get("type") != "FeatureCollection" or "features" not in data:
        print("Invalid GeoJSON: expected FeatureCollection with features")
        sys.exit(1)

    rows = []
    for feature in data["features"]:
        props = feature.get("properties") or {}
        name = props.get("name") or props.get("name:en") or ""
        geom = feature.get("geometry")
        if not geom:
            continue
        try:
            lon, lat = get_centroid(geom)
            rows.append((name, lat, lon))
        except Exception as e:
            print(f"Skipping feature (no name or invalid geometry): {e}")
            continue

    wb = Workbook()
    ws = wb.active
    ws.title = "Boundary centers"
    ws.append(["Name", "Latitude", "Longitude"])
    for name, lat, lon in rows:
        ws.append([name, round(lat, 6), round(lon, 6)])

    # Write CSV first (for the map; browsers can't read xlsx)
    csv_path = script_dir / "boundary_centers.csv"
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write("Name,Latitude,Longitude\n")
        for name, lat, lon in rows:
            f.write(f"{name},{round(lat, 6)},{round(lon, 6)}\n")
    print(f"Wrote {len(rows)} rows to {csv_path}")

    wb.save(out_path)
    print(f"Wrote {len(rows)} rows to {out_path}")


if __name__ == "__main__":
    main()
