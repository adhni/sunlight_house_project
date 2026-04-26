from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


YEAR = 2025
PARAMETERS = ("T2M", "ALLSKY_SFC_UV_INDEX", "ALLSKY_SFC_SW_DWN")
LOCATIONS = {
    "melbourne": {
        "label": "Melbourne",
        "latitude": -37.8136,
        "longitude": 144.9631,
        "timezone": "Australia/Melbourne",
    },
    "jakarta": {
        "label": "Jakarta",
        "latitude": -6.2088,
        "longitude": 106.8456,
        "timezone": "Asia/Jakarta",
    },
    "boston": {
        "label": "Boston",
        "latitude": 42.3601,
        "longitude": -71.0589,
        "timezone": "America/New_York",
    },
}


def clean_number(value: object) -> float | None:
    number = float(value)
    if number <= -900:
        return None
    return round(number, 2)


def power_url(latitude: float, longitude: float) -> str:
    query = urlencode(
        {
            "parameters": ",".join(PARAMETERS),
            "community": "RE",
            "latitude": latitude,
            "longitude": longitude,
            "start": f"{YEAR}0101",
            "end": f"{YEAR}1231",
            "format": "JSON",
            "time-standard": "UTC",
        }
    )
    return f"https://power.larc.nasa.gov/api/temporal/hourly/point?{query}"


def fetch_power_payload(latitude: float, longitude: float) -> dict:
    with urlopen(power_url(latitude, longitude), timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def compact_payload(location_key: str, location: dict, payload: dict) -> dict:
    parameters = payload["properties"]["parameter"]
    temperatures = parameters["T2M"]
    uv_indexes = parameters["ALLSKY_SFC_UV_INDEX"]
    solar_radiation = parameters["ALLSKY_SFC_SW_DWN"]
    hour_keys = sorted(temperatures)

    return {
        "meta": {
            "locationKey": location_key,
            "locationName": location["label"],
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "timezone": location["timezone"],
            "year": YEAR,
            "cadence": "hourly",
            "source": "NASA POWER",
            "parameters": list(PARAMETERS),
            "start": f"{YEAR}-01-01T00:00",
            "hours": len(hour_keys),
            "timeStandard": "UTC",
            "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        },
        "columns": ["tempC", "uvIndex", "solarRadiation"],
        "values": [
            [
                clean_number(temperatures[hour_key]),
                clean_number(uv_indexes[hour_key]),
                clean_number(solar_radiation[hour_key]),
            ]
            for hour_key in hour_keys
        ],
    }


def main() -> None:
    output_dir = Path("static/env")
    output_dir.mkdir(parents=True, exist_ok=True)

    for location_key, location in LOCATIONS.items():
        print(f"Fetching {location_key}...")
        payload = fetch_power_payload(location["latitude"], location["longitude"])
        compact = compact_payload(location_key, location, payload)
        output_path = output_dir / f"{location_key}-{YEAR}.json"
        output_path.write_text(
            json.dumps(compact, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"Wrote {output_path} ({compact['meta']['hours']} hours)")


if __name__ == "__main__":
    main()
