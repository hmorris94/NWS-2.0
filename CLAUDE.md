# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NWS-2.0 is a single-page weather forecasting application that visualizes NOAA/NWS hourly weather data. Built with vanilla JavaScript, HTML, and CSS—no frameworks or build tools.

## Development Commands

```bash
# Server-side mode (default): background NWS fetching + data serving
python main.py

# Client-only mode: Flask serves static files (port 5173)
python main.py --client

# Custom port
python main.py --port 8080
```

No build step required. Open `index.html` directly in a browser for quick testing.

## Architecture

### Single-File JavaScript (app.js ~1800 lines)

The application uses a **functional, event-driven architecture** with centralized state:

**Global State Object:**
- `state.selectedIndex` - Currently selected location
- `state.data[]` - Loaded location forecast data
- `state.windowSize` - Hourly data points displayed (default 96)
- `state.startIndex` - Starting point in hourly data
- `state.metricVisibility` - Which metrics are hidden/shown

**Data Flow:**
```
User Interaction → Event Listeners → State Updates → renderView() → Canvas Rendering
```

### Canvas Rendering with Retained Scene Pattern

Charts use Canvas API with a **retained scene pattern** for performance:
1. Full hourly data is loaded and y-axis pixel positions are cached per metric
2. On pan/zoom, only the visible portion is redrawn from cache
3. Y-axis stays fixed to min/max of full series per metric group

**Canvas Instance Structure:**
```javascript
{
  groupId, label, unit, canvas, ctx,
  series: [{ key, label, unit, color, values }],
  times: [Date, ...],
  extent: { min, max },
  yValues: Map,       // Cached y-pixel positions
  lastNonNull: Map    // Last non-null value tracking
}
```

### Key Function Groups

| Category | Functions | Lines |
|----------|-----------|-------|
| Data Fetching | `fetchJson()`, `loadLocation()`, `loadAll()` | 798-903 |
| Rendering | `renderView()`, `renderCharts()`, `buildOverlayScene()`, `drawOverlayInstance()` | 934-1115 |
| Interactions | `attachPanZoom()`, `attachTooltip()`, `zoomWindow()` | 437-564, 1242-1506 |
| Timeline | `buildTimelineDays()`, `attachTimelineDrag()`, `updateTimelineMarkers()` | 1578-1781 |

### Metric Grouping

Metrics are grouped for chart organization. Order defined at line 60:
```javascript
["temperature", "precip-prob", "precip", "wind", "sky", "humidity", "pressure", "visibility"]
```

`getGroupForMetric()` categorizes each metric key into these groups.

### Cross-Chart Synchronization

All charts share interaction state for synchronized pan/zoom:
- `interactionState` tracks active pointers, touch gestures, pinch distances
- `scheduleInteractionRender()` debounces render calls during interactions

## Data Source

- API: `api.weather.gov` (public NOAA API, no key required)
- Auto-refresh: Every 15 minutes
- Unit normalization: Converts metric to imperial (°C→°F, m/s→mph)

## Theme System

- CSS custom properties for colors
- `data-theme` attribute on `<html>` element
- System preference detection with localStorage persistence
- Toggle via `initTheme()` function

## Project Structure

```
NWS-2.0/
├── main.py              # Single entry point (server-side default, --client for client-only)
├── app/                 # Python package (all source modules)
│   ├── __init__.py
│   ├── blueprint.py     # Flask blueprint (serves static files + data)
│   ├── background.py    # Background NWS/HRRR fetch threads
│   ├── config.py        # Locations, intervals, feature flags
│   ├── nws_fetcher.py   # Python port of NWS API fetching logic
│   └── hrrr_nbm_dl.py   # HRRR/NBM GRIB2 downloader (optional)
├── index.html           # Client-side HTML
├── app.js               # Client-side JavaScript (~1800 lines)
├── styles.css           # Client-side CSS
├── server_side/         # Server-side client file overrides + data
│   ├── app.js           # Modified: loads from /data/locations.json
│   ├── index.html       # Modified: no refresh button
│   ├── styles.css       # Unchanged copy
│   └── data/            # Pre-fetched weather data (generated)
├── example_data/        # Sample API responses for reference
└── docs/                # Planning and design documents
```

## Server-Side Mode

The default mode. Pre-fetches weather data server-side, eliminating client-side API calls. Use `python main.py --client` for client-only mode instead.

### How It Works

1. **Background NWS Fetching**: Daemon thread fetches all locations every 30 minutes
2. **Atomic Writes**: Uses temp file + rename to prevent corrupted reads
3. **Client Polling**: Browser polls `/data/locations.json` every 5 minutes
4. **No Refresh Button**: Server manages data freshness automatically

### Configuration (`app/config.py`)

| Setting | Default | Description |
|---------|---------|-------------|
| `LOCATIONS` | 5 locations | List of `{name, lat, lon}` dictionaries |
| `NWS_INTERVAL_SECONDS` | 1800 | NWS fetch interval (30 min) |
| `HRRR_INTERVAL_SECONDS` | 3600 | HRRR/NBM fetch interval (1 hour) |
| `ENABLE_HRRR` | False | Enable HRRR/NBM GRIB2 downloads |
| `SERVER_PORT` | 5173 | HTTP server port |

### HRRR/NBM Integration

When `ENABLE_HRRR = True`:
- Downloads subset GRIB2 files from NOMADS for configured locations
- Caches files in `wx_cache/` (skips existing files)
- Currently download-only; data not yet merged into client display
