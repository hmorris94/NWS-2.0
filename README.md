# NWS Forecast Explorer

A lightweight NOAA/NWS forecast dashboard focused on a handful of locations with grouped graphs and daily summaries.

## Features

- Curated location list with saved selection.
- Adjustable time window for hourly graphs.
- Grouped overlays with tooltips and day markers.
- Collapsible Forecast and Locations sections.
- Day-by-day forecast cards with highs/lows.
- Light/dark theme toggle.
- Auto-refresh every 15 minutes.

## Quick Start

Open `index.html` in a browser, or run:

```bash
python serve.py
```

## Development

This project is intentionally dependency-light. If you want a local server with live reload:

```bash
npm install
npm run dev
```

## Data Source

Powered by the National Weather Service API (`api.weather.gov`).

## License

MIT.
