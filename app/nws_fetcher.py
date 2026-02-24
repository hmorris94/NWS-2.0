"""NWS API fetcher - Python port of app.js fetching logic."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# Color palette for metrics (matches app.js)
COLOR_PALETTE = [
    "#ff7b2f",
    "#0f8ea1",
    "#5b56f0",
    "#2f3b52",
    "#e24a3b",
    "#2f9d55",
    "#b065f5",
    "#e6a01a",
    "#1a6fa8",
    "#7c4a2a",
]

# Label overrides for metric keys
LABEL_OVERRIDES = {
    "probabilityOfPrecipitation": "Probability of Precipitation",
    "quantitativePrecipitation": "Precipitation Amount",
    "windSpeed": "Wind Speed",
    "windGust": "Wind Gust",
    "skyCover": "Sky Cover",
    "relativeHumidity": "Relative Humidity",
    "apparentTemperature": "Feels Like",
}

# Metrics to exclude
EXCLUDED_METRICS = {
    "mintemperature",
    "maxtemperature",
    "winddirection",
    "transportwinddirection",
    "transportwindspeed",
    "ceilingheight",
    "mixingheight",
    "visibility",
    "lowvisibilityoccurrenceriskindex",
    "atmosphericdispersionindex",
    "windchill",
    "wetbulbglobetemperature",
    "waveheight",
}

# Group order for chart grouping
GROUP_ORDER = [
    "temperature",
    "precip-prob",
    "precip",
    "wind",
    "sky",
    "humidity",
    "pressure",
    "visibility",
]


def normalize_uom(uom: str) -> Tuple[str, callable]:
    """Normalize unit of measure and return conversion function."""
    cleaned = (uom or "").replace("wmoUnit:", "").replace("unit:", "")

    if cleaned == "percent":
        return ("%", lambda v: v)
    if cleaned == "degC":
        return ("°F", lambda v: v * 1.8 + 32)
    if cleaned == "degF":
        return ("°F", lambda v: v)
    if cleaned == "m_s-1":
        return ("mph", lambda v: v * 2.23694)
    if cleaned == "km_h-1":
        return ("mph", lambda v: v * 0.621371)
    if cleaned == "m":
        return ("mi", lambda v: v / 1609.34)
    if cleaned == "mm":
        return ("in", lambda v: v / 25.4)
    if cleaned == "cm":
        return ("in", lambda v: v / 2.54)
    if cleaned == "kg_m-2":
        return ("in", lambda v: v / 25.4)
    if cleaned == "Pa":
        return ("hPa", lambda v: v / 100)

    return (cleaned or "", lambda v: v)


def parse_duration(duration: str) -> int:
    """Parse ISO 8601 duration to minutes."""
    match = re.match(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", duration or "")
    if not match:
        return 0

    days = int(match.group(1) or 0)
    hours = int(match.group(2) or 0)
    minutes = int(match.group(3) or 0)

    return (days * 24 + hours) * 60 + minutes


def parse_interval_values(values: List[Dict]) -> List[Dict]:
    """Parse NWS interval format values."""
    result = []
    for entry in values:
        if entry.get("value") is None:
            continue

        valid_time = entry.get("validTime", "")
        if "/" not in valid_time:
            continue

        start_str, duration_str = valid_time.split("/", 1)
        try:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            start_ms = int(start_dt.timestamp() * 1000)
        except (ValueError, TypeError):
            continue

        duration_minutes = parse_duration(duration_str)
        end_ms = start_ms + duration_minutes * 60 * 1000

        value = sanitize_value(entry["value"])
        if value is not None:
            result.append({"start": start_ms, "end": end_ms, "duration_hours": duration_minutes / 60, "value": value})

    return result


def is_accumulation_metric(key: str) -> bool:
    """True for metrics that are interval totals (precip, snow, ice) needing per-hour conversion."""
    k = key.lower()
    return (
        ("precip" in k and "probability" not in k)
        or "snow" in k
        or ("ice" in k and "probability" not in k)
    )


def get_interval_value(intervals: List[Dict], time_ms: int, per_hour: bool = False) -> Optional[float]:
    """Get value at a specific timestamp from intervals."""
    for entry in intervals:
        if entry["start"] <= time_ms < entry["end"]:
            if per_hour and entry["duration_hours"] > 1:
                return entry["value"] / entry["duration_hours"]
            return entry["value"]
    return None


def sanitize_value(value: Any) -> Optional[float]:
    """Sanitize a numeric value."""
    if value is None:
        return None
    try:
        num = float(value)
        if not (-9000 < num < 9000):
            return None
        return num
    except (TypeError, ValueError):
        return None


def should_exclude_metric(key: str) -> bool:
    """Check if metric should be excluded."""
    return key.lower() in EXCLUDED_METRICS


def humanize_key(key: str) -> str:
    """Convert camelCase key to human-readable label."""
    if key in LABEL_OVERRIDES:
        return LABEL_OVERRIDES[key]

    # Insert space before uppercase letters
    result = re.sub(r"([A-Z])", r" \1", key)
    # Capitalize first letter
    return result[0].upper() + result[1:] if result else key


def stable_color_index(key: str) -> int:
    """Derive a stable palette index from the metric key."""
    h = 0
    for ch in key:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h % len(COLOR_PALETTE)


def get_metric_color(key: str) -> str:
    """Get color for a metric."""
    normalized = key.lower()

    if "quantitativeprecipitation" in normalized:
        return "#118ab2"
    if "snow" in normalized:
        return "#00bcd4"
    if "ice" in normalized:
        return "#8b5cf6"
    if "rain" in normalized or "liquid" in normalized:
        return "#00a676"
    if "drizzle" in normalized:
        return "#f59e0b"
    if "sleet" in normalized or "freezing" in normalized:
        return "#ef4444"
    if "humidity" in normalized:
        return "#06b6d4"
    if "windgust" in normalized:
        return "#7dd3fc"

    return COLOR_PALETTE[stable_color_index(key)]


def get_group_for_metric(metric: Dict) -> Dict:
    """Categorize metric into a group."""
    key = metric.get("key", "").lower()
    unit = (metric.get("unit") or "").lower()

    if "probabilityofprecipitation" in key:
        return {"id": "precip-prob", "label": "Precipitation"}
    if "probability" in key and "thunder" in key:
        return {"id": "precip-prob", "label": "Precipitation"}
    if any(x in key for x in ["temperature", "dewpoint", "heatindex", "windchill"]):
        return {"id": "temperature", "label": "Temperature"}
    if "wind" in key:
        return {"id": "wind", "label": "Wind"}
    if any(x in key for x in ["precip", "snow", "ice"]):
        return {"id": "precip", "label": "Precipitation"}
    if any(x in key for x in ["sky", "cloud"]):
        return {"id": "sky", "label": "Cloud Cover"}
    if "humidity" in key:
        return {"id": "humidity", "label": "Humidity"}
    if any(x in key for x in ["pressure", "barometric"]):
        return {"id": "pressure", "label": "Pressure"}
    if "visibility" in key:
        return {"id": "visibility", "label": "Visibility"}

    suffix = f" ({metric.get('unit')})" if metric.get("unit") else ""
    return {"id": f"other-{metric.get('unit') or 'misc'}", "label": f"Other{suffix}"}


def build_daily_forecast(periods: List[Dict]) -> List[Dict]:
    """Build 7-day forecast from NWS periods."""
    days: Dict[str, Dict] = {}

    for period in periods:
        start_time = period.get("startTime")
        if not start_time:
            continue

        try:
            date = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue

        key = start_time[:10]
        if key not in days:
            days[key] = {"date": date, "day": None, "night": None}

        if period.get("isDaytime"):
            days[key]["day"] = period
        else:
            days[key]["night"] = period

    result = []
    for entry in days.values():
        day = entry["day"]
        night = entry["night"]

        name = (
            (day and day.get("name"))
            or (night and night.get("name"))
            or entry["date"].strftime("%A")
        )

        high = day.get("temperature") if day else None
        low = night.get("temperature") if night else None
        unit = (
            (day and day.get("temperatureUnit"))
            or (night and night.get("temperatureUnit"))
            or ""
        )

        day_prob = (
            day.get("probabilityOfPrecipitation", {}).get("value") if day else None
        )
        night_prob = (
            night.get("probabilityOfPrecipitation", {}).get("value")
            if night
            else None
        )

        prob_values = [p for p in [day_prob, night_prob] if p is not None]
        precip_prob = max(prob_values) if prob_values else None

        # Build blurb
        blurb = ""
        if day and day.get("shortForecast") and night and night.get("shortForecast"):
            combined = f"{day['shortForecast']} then {night['shortForecast']}"
            tokens = [t.strip() for t in re.split(r"\s+then\s+", combined, flags=re.I)]
            tokens = [t for t in tokens if t]
            # Dedupe consecutive identical tokens
            deduped = []
            for t in tokens:
                if not deduped or t != deduped[-1]:
                    deduped.append(t)
            blurb = " then ".join(deduped)
        else:
            blurb = (
                (day and day.get("shortForecast"))
                or (night and night.get("shortForecast"))
                or ""
            )

        result.append(
            {
                "name": name,
                "high": high,
                "low": low,
                "unit": unit,
                "blurb": blurb,
                "precipProb": precip_prob,
            }
        )

    return result


def fetch_json(url: str, session: Optional[requests.Session] = None) -> Dict:
    """Fetch JSON from URL with proper headers."""
    sess = session or requests.Session()
    headers = {"User-Agent": "focused-forecast-demo"}
    response = sess.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_location(
    location: Dict, session: Optional[requests.Session] = None
) -> Dict:
    """Fetch all weather data for a single location."""
    sess = session or requests.Session()
    lat, lon = location["lat"], location["lon"]

    # Get point metadata
    point = fetch_json(f"https://api.weather.gov/points/{lat},{lon}", sess)
    props = point.get("properties", {})

    # Get hourly forecast
    forecast_hourly = fetch_json(props["forecastHourly"], sess)

    # Get regular forecast (for daily)
    forecast = fetch_json(props["forecast"], sess)

    # Get grid data (detailed metrics)
    grid = fetch_json(props["forecastGridData"], sess)

    updated = forecast_hourly.get("properties", {}).get("updateTime")

    # Build metric metadata
    grid_props = grid.get("properties", {})
    metric_meta = []

    for key, prop in grid_props.items():
        if not isinstance(prop, dict):
            continue
        if not isinstance(prop.get("values"), list):
            continue
        if should_exclude_metric(key):
            continue

        unit, convert = normalize_uom(prop.get("uom", ""))
        if not unit and "probability" in key.lower():
            unit = "%"

        intervals = parse_interval_values(prop["values"])
        metric_meta.append(
            {
                "key": key,
                "label": humanize_key(key),
                "unit": unit,
                "convert": convert,
                "intervals": intervals,
            }
        )

    # Build hourly data
    hourly_periods = forecast_hourly.get("properties", {}).get("periods", [])
    hourly = []

    for period in hourly_periods:
        start_time = period.get("startTime")
        if not start_time:
            continue

        try:
            time_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue

        time_ms = int(time_dt.timestamp() * 1000)
        metrics = {}

        for meta in metric_meta:
            raw = get_interval_value(meta["intervals"], time_ms, is_accumulation_metric(meta["key"]))
            if raw is None:
                metrics[meta["key"]] = None
            else:
                converted = meta["convert"](raw)
                metrics[meta["key"]] = sanitize_value(converted)

        hourly.append(
            {
                "time": time_dt.isoformat(),
                "shortForecast": period.get("shortForecast"),
                "windDirection": period.get("windDirection"),
                "windSpeedText": period.get("windSpeed"),
                "metrics": metrics,
            }
        )

    # Subtract estimated liquid equivalent of snowfall from quantitative precipitation (10:1 SLR).
    for entry in hourly:
        qpf = entry["metrics"].get("quantitativePrecipitation")
        snow = entry["metrics"].get("snowfallAmount")
        if qpf is not None and snow is not None:
            entry["metrics"]["quantitativePrecipitation"] = max(0.0, qpf - snow / 10.0)

    # Trim past hours
    now = datetime.now(timezone.utc)
    current_hour = now.replace(minute=0, second=0, microsecond=0)

    if hourly:
        first_time = datetime.fromisoformat(hourly[0]["time"])
        if current_hour > first_time:
            hourly = [
                entry
                for entry in hourly
                if datetime.fromisoformat(entry["time"]) >= current_hour
            ]

    # Filter metrics that have data
    filtered_meta = [
        meta
        for meta in metric_meta
        if any(
            entry["metrics"].get(meta["key"]) is not None
            for entry in hourly
        )
    ]

    # Sort and build final metrics list
    filtered_meta.sort(key=lambda m: m["label"])
    metrics = []
    for i, meta in enumerate(filtered_meta):
        metrics.append(
            {
                "key": meta["key"],
                "label": meta["label"],
                "unit": meta["unit"],
                "color": get_metric_color(meta["key"]),
            }
        )

    # Calculate extents
    metric_extents = {}
    group_extents = {}

    for metric in metrics:
        values = [
            entry["metrics"].get(metric["key"])
            for entry in hourly
            if entry["metrics"].get(metric["key"]) is not None
        ]
        if not values:
            continue

        min_val = min(values)
        max_val = max(values)
        metric_extents[metric["key"]] = {"min": min_val, "max": max_val}

        group = get_group_for_metric(metric)
        group_key = f"{group['id']}|{metric.get('unit') or 'unitless'}"

        if group_key not in group_extents:
            group_extents[group_key] = {"min": min_val, "max": max_val}
        else:
            group_extents[group_key]["min"] = min(
                group_extents[group_key]["min"], min_val
            )
            group_extents[group_key]["max"] = max(
                group_extents[group_key]["max"], max_val
            )

    # Build daily forecast
    daily_periods = forecast.get("properties", {}).get("periods", [])
    daily_forecast = build_daily_forecast(daily_periods)

    return {
        "name": location["name"],
        "lat": location["lat"],
        "lon": location["lon"],
        "updated": updated,
        "hourly": hourly,
        "metrics": metrics,
        "metricExtents": metric_extents,
        "groupExtents": group_extents,
        "dailyForecast": daily_forecast,
    }


def fetch_all_locations(
    locations: List[Dict], session: Optional[requests.Session] = None
) -> Dict:
    """Fetch weather data for all locations."""
    sess = session or requests.Session()
    fetched_at = datetime.now(timezone.utc).isoformat()

    results = []
    for location in locations:
        try:
            data = fetch_location(location, sess)
            results.append(data)
        except Exception as e:
            logger.error("Error fetching %s: %s", location["name"], e)
            # Include location with error flag
            results.append(
                {
                    "name": location["name"],
                    "lat": location["lat"],
                    "lon": location["lon"],
                    "error": str(e),
                    "hourly": [],
                    "metrics": [],
                    "metricExtents": {},
                    "groupExtents": {},
                    "dailyForecast": [],
                }
            )

    return {"fetchedAt": fetched_at, "locations": results}


if __name__ == "__main__":
    # Quick test
    from app.config import LOCATIONS

    result = fetch_all_locations(LOCATIONS)
    print(f"Fetched at: {result['fetchedAt']}")
    for loc in result["locations"]:
        print(f"  {loc['name']}: {len(loc['hourly'])} hours, {len(loc['metrics'])} metrics")
