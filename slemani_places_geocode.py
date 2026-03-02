"""
Find center points (lat/lon) for places in Slemani, Iraq via geocoding.
Writes results to an Excel file and a CSV file for loading on the map.
"""
import sys
import time
from pathlib import Path

try:
    import openpyxl
    from openpyxl import Workbook
except ImportError:
    sys.exit("Install: pip install openpyxl")

try:
    from geopy.geocoders import Nominatim
    from geopy.extra.rate_limiter import RateLimiter
except ImportError:
    sys.exit("Install: pip install geopy")

# Places in Slemani (from your list) – Latin script for geocoding
SLEMANI_PLACES = [
    "Sarwari",
    "Kurdsat",
    "Hawari Shar",
    "Kani Spika",
    "Zargatay Kon",
    "Barzayiakani Slemani",
    "Barzayiakani Qaywan",
    "Gundi Almanya",
    "Darwaza Seni",
    "Qirga",
    "Gawbara",
    "Bakrajo",
    "Kani Goma",
    "Raperin",
    "Chwarbakh",
    "Wlopa",
    "Tasluja",
]

# Fallback coordinates from existing komita.csv / known Slemani area
FALLBACK_COORDS = {
    "Sarwari": (35.59, 45.40),
    "Raperin": (35.57704, 45.333913),
    "Tasluja": (35.595758, 45.228200),
}

# Alternate search names if first fails (e.g. different spellings)
ALTERNATES = {
    "Raperin": ["Raparin", "Raperin Slemani"],
    "Chwarbakh": ["Chwar Chra", "Chwarbakh Slemani"],
    "Wlopa": ["Wlopa Slemani", "Walopa"],
    "Zargatay Kon": ["Zargata", "Zargatay Kon Slemani"],
    "Barzayiakani Slemani": ["Barzayia Kani Slemani"],
    "Barzayiakani Qaywan": ["Barzayia Kani Qaywan"],
    "Gundi Almanya": ["Gundi Almanya Slemani"],
    "Darwaza Seni": ["Darwaza Seni Slemani"],
    "Kani Goma": ["Kani Goma Slemani"],
}


def geocode_place(geocode, name: str) -> tuple[float, float] | None:
    """Return (lat, lon) for a place in Slemani, Iraq, or None if not found."""
    queries = [f"{name}, Sulaymaniyah, Iraq", f"{name}, Slemani, Iraq"]
    if name in ALTERNATES:
        for alt in ALTERNATES[name]:
            queries.append(f"{alt}, Sulaymaniyah, Iraq")
    for q in queries:
        try:
            loc = geocode(q)
            if loc and loc.latitude and loc.longitude:
                # Prefer results within Sulaymaniyah governorate (Slemani)
                lat, lon = loc.latitude, loc.longitude
                if 35.0 <= lat <= 36.2 and 44.8 <= lon <= 46.0:
                    return (lat, lon)
                # Accept wider Iraq bounds if no better result
                if 34.5 <= lat <= 36.5 and 44.5 <= lon <= 46.5:
                    return (lat, lon)
        except Exception:
            continue
        time.sleep(0.6)
    return None


def main():
    script_dir = Path(__file__).resolve().parent
    out_xlsx = script_dir / "slemani_places_centers.xlsx"
    out_csv = script_dir / "slemani_places.csv"

    geolocator = Nominatim(user_agent="slemani-places-map", timeout=15)
    geocode = RateLimiter(geolocator.geocode, min_delay_seconds=1.0)

    rows = []
    for name in SLEMANI_PLACES:
        result = geocode_place(geocode, name)
        # Prefer fallback if geocode returned a point outside Slemani governorate
        if name in FALLBACK_COORDS and (
            not result or result[0] < 35.0 or result[0] > 36.2
        ):
            lat, lon = FALLBACK_COORDS[name]
            rows.append((name, round(lat, 6), round(lon, 6)))
            print(f"  {name}: {lat:.6f}, {lon:.6f} (fallback)")
        elif result:
            lat, lon = result
            rows.append((name, round(lat, 6), round(lon, 6)))
            print(f"  {name}: {lat:.6f}, {lon:.6f}")
        else:
            rows.append((name, None, None))
            print(f"  {name}: not found")

    # Excel
    wb = Workbook()
    ws = wb.active
    ws.title = "Slemani places"
    ws.append(["Name", "Latitude", "Longitude"])
    for name, lat, lon in rows:
        ws.append([name, lat, lon])
    wb.save(out_xlsx)
    print(f"\nWrote Excel: {out_xlsx}")

    # CSV (same format as komita.csv for map: Komita, Latitude, Longitude)
    with open(out_csv, "w", encoding="utf-8") as f:
        f.write("Komita,Latitude,Longitude\n")
        for name, lat, lon in rows:
            lat_s = "" if lat is None else str(lat)
            lon_s = "" if lon is None else str(lon)
            f.write(f"{name},{lat_s},{lon_s}\n")
    print(f"Wrote CSV: {out_csv}")

    found = sum(1 for _, lat, _ in rows if lat is not None)
    print(f"Geocoded {found}/{len(rows)} places.")


if __name__ == "__main__":
    main()
