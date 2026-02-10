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
- Auto-refresh every 15 minutes.

## Chart Interaction Notes

- Charts use a retained scene: y-axis values are cached for the full series and each redraw reuses them.
- Pan/zoom re-renders ticks and labels while reusing cached y positions for smooth interactions.
- Vertical axes stay fixed to full-series min/max for each metric group.

## Quick Start

Open `index.html` directly in a browser, or start a local server:

```bash
python main.py               # client-only mode at http://localhost:5173
python main.py --server      # server-side mode (background NWS fetching)
python main.py --port 8080   # custom port
```

No build step required—the project is intentionally dependency-light.

## Data Source

Powered by the National Weather Service API (`api.weather.gov`).

## License

MIT.
