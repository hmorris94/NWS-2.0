"""Configuration for the NWS weather dashboard server."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # app/config.py → app/ → project/

# Locations to fetch weather data for (matches app.js)
LOCATIONS = [
    {"name": "Sterling, VA", "lat": 39.0067, "lon": -77.4286},
    {"name": "Frederick, MD", "lat": 39.4143, "lon": -77.4105},
    {"name": "Midlothian, VA", "lat": 37.5057, "lon": -77.6499},
    {"name": "Broadway, VA", "lat": 38.6132, "lon": -78.7989},
    {"name": "Hatteras, NC", "lat": 35.2193, "lon": -75.6907},
]

# NWS data refresh interval (30 minutes)
NWS_INTERVAL_SECONDS = 1800

# HRRR/NBM data refresh interval (1 hour)
HRRR_INTERVAL_SECONDS = 3600

# Enable HRRR/NBM downloads (disabled by default)
ENABLE_HRRR = False

# Server port
SERVER_PORT = 5173

# Cache directory for HRRR/NBM data
HRRR_CACHE_DIR = str(PROJECT_ROOT / "wx_cache")
