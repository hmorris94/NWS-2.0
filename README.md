# NWS Forecast Explorer

A lightweight NOAA/NWS forecast dashboard focused on a handful of locations with grouped graphs and daily summaries.

## Features

- Curated location list with saved selection.
- Adjustable time window for hourly graphs.
- Grouped overlays with tooltips and day markers.
- Mouse wheel zoom, click-drag pan, and touch pinch/drag pan synced across charts.
- Collapsible Forecast and Locations sections.
- Day-by-day forecast cards with highs/lows.
- Light/dark theme toggle.

## Quick Start

```bash
pip install -r requirements.txt
python main.py web              # server-side mode (background NWS fetching) at http://localhost:8081
python main.py web --client     # client-only mode (browser fetches NWS directly)
python main.py web --port 8080  # custom port
```

No build step required.

## Modes

**Server-side (default):** A background thread pre-fetches NWS data every 30 minutes and writes it to `server_side/data/locations.json`. The browser polls `/data/locations.json` every 5 minutes. No direct NWS API calls from the browser.

**Client-only (`--client`):** The browser fetches NWS data directly on load and refreshes every 15 minutes.

## Configuration

Edit `app/config.py` to change locations, refresh intervals, or enable HRRR/NBM downloads.

## Data Source

Powered by the National Weather Service API (`api.weather.gov`). No API key required.

## License

MIT.
