const locations = [
  { name: "Sterling, VA", lat: 39.0067, lon: -77.4286 },
  { name: "Frederick, MD", lat: 39.4143, lon: -77.4105 },
  { name: "Midlothian, VA", lat: 37.5057, lon: -77.6499 },
  { name: "Hatteras, NC", lat: 35.2193, lon: -75.6907 }
];

const state = {
  selectedIndex: 0,
  data: [],
  windowSize: 24,
  startIndex: 0,
  chartMode: "overlay",
  metricVisibility: {}
};

const statusEl = document.getElementById("status");
const locationListEl = document.getElementById("locationList");
const locationNameEl = document.getElementById("locationName");
const locationMetaEl = document.getElementById("locationMeta");
const refreshBtn = document.getElementById("refresh");
const windowSizeEl = document.getElementById("windowSize");
const windowLabelEl = document.getElementById("windowLabel");
const startIndexEl = document.getElementById("startIndex");
const timeRangeEl = document.getElementById("timeRange");
const detailCardsEl = document.getElementById("detailCards");
const chartsEl = document.getElementById("charts");
const legendEl = document.getElementById("legend");
const overlayNoteEl = document.getElementById("overlayNote");
const modeSeparateBtn = document.getElementById("modeSeparate");
const modeOverlayBtn = document.getElementById("modeOverlay");
const tooltipEl = document.getElementById("tooltip");

const colorPalette = [
  "#ff7b2f",
  "#0f8ea1",
  "#5b56f0",
  "#2f3b52",
  "#e24a3b",
  "#2f9d55",
  "#b065f5",
  "#e6a01a",
  "#1a6fa8",
  "#7c4a2a"
];

const labelOverrides = {
  probabilityOfPrecipitation: "Precip Probability",
  quantitativePrecipitation: "Precip Amount",
  windSpeed: "Wind Speed",
  windGust: "Wind Gust",
  skyCover: "Sky Cover",
  relativeHumidity: "Relative Humidity",
  apparentTemperature: "Feels Like"
};

const groupOrder = ["temperature", "precip-prob", "precip", "wind", "sky", "humidity", "pressure", "visibility"];
const chartPadding = { top: 28, right: 16, bottom: 24, left: 46 };
const overlayPadding = { top: 28, right: 16, bottom: 24, left: 54 };

function getGroupForMetric(metric) {
  const key = metric.key.toLowerCase();
  const unit = (metric.unit || "").toLowerCase();
  if (key.includes("probabilityofprecipitation")) {
    return { id: "precip-prob", label: "Precipitation" };
  }
  if (key.includes("probability") && key.includes("thunder")) {
    return { id: "precip-prob", label: "Precipitation" };
  }
  if (key.includes("temperature") || key.includes("dewpoint") || key.includes("heatindex") || key.includes("windchill")) {
    return { id: "temperature", label: "Temperature" };
  }
  if (key.includes("wind")) {
    return { id: "wind", label: "Wind" };
  }
  if (key.includes("precip") || key.includes("snow") || key.includes("ice")) {
    return { id: "precip", label: "Precipitation" };
  }
  if (key.includes("sky") || key.includes("cloud")) {
    return { id: "sky", label: "Cloud Cover" };
  }
  if (key.includes("humidity")) {
    return { id: "humidity", label: "Humidity" };
  }
  if (key.includes("pressure") || key.includes("barometric")) {
    return { id: "pressure", label: "Pressure" };
  }
  if (key.includes("visibility")) {
    return { id: "visibility", label: "Visibility" };
  }
  const suffix = metric.unit ? ` (${metric.unit})` : "";
  return { id: `other-${metric.unit || "misc"}`, label: `Other${suffix}` };
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showTooltip(content, x, y) {
  tooltipEl.innerHTML = content;
  const padding = 12;
  const maxX = window.innerWidth - tooltipEl.offsetWidth - padding;
  const maxY = window.innerHeight - tooltipEl.offsetHeight - padding;
  const left = Math.min(x + 14, maxX);
  const top = Math.min(y + 14, maxY);
  tooltipEl.style.left = `${Math.max(padding, left)}px`;
  tooltipEl.style.top = `${Math.max(padding, top)}px`;
  tooltipEl.classList.add("visible");
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
}

function formatTooltipValue(value) {
  if (value === null || value === undefined) return "--";
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getIndexFromEvent(event, canvas, count, padding) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const chartWidth = rect.width - padding.left - padding.right;
  if (chartWidth <= 0 || count <= 1) return 0;
  const clamped = Math.min(Math.max(x - padding.left, 0), chartWidth);
  return Math.round((clamped / chartWidth) * (count - 1));
}

function getTickIndices(times, intervalHours = 6) {
  const indices = [];
  times.forEach((time, index) => {
    if (!time) return;
    if (time.getMinutes() !== 0) return;
    if (time.getHours() % intervalHours !== 0) return;
    indices.push(index);
  });
  if (indices.length < 2 && times.length > 1) {
    const step = Math.max(1, Math.floor(times.length / 6));
    for (let i = 0; i < times.length; i += step) {
      indices.push(i);
    }
  }
  return indices;
}

function getTickIntervalHours() {
  if (state.windowSize <= 12) return 1;
  if (state.windowSize <= 36) return 3;
  return 6;
}

function getMidnightIndices(times) {
  const indices = [];
  times.forEach((time, index) => {
    if (!time) return;
    if (time.getHours() === 0 && time.getMinutes() === 0) {
      indices.push(index);
    }
  });
  return indices;
}

function getDayMark(time) {
  if (!time) return "";
  return time.toLocaleDateString(undefined, { weekday: "short" });
}

function getDaySegments(times) {
  if (!times.length) return [];
  const segments = [];
  const midnights = getMidnightIndices(times);
  const indices = [0, ...midnights.filter((index) => index !== 0), times.length - 1];
  for (let i = 0; i < indices.length - 1; i += 1) {
    const start = indices[i];
    const end = indices[i + 1];
    if (end <= start) continue;
    const label = getDayMark(times[start]);
    segments.push({ start, end, label });
  }
  return segments;
}

function attachTooltip(canvas, payload) {
  canvas.addEventListener("mousemove", (event) => {
    const index = getIndexFromEvent(event, canvas, payload.times.length, payload.padding);
    const time = payload.times[index];
    if (!time) return;
    const timeLabel = time.toLocaleString(undefined, { weekday: "short", hour: "numeric" });

    if (payload.type === "single") {
      const value = payload.values[index];
      const display = formatTooltipValue(value);
      showTooltip(
        `<div class="tooltip-time">${timeLabel}</div><div>${payload.label}: ${display}</div>`,
        event.clientX,
        event.clientY
      );
      return;
    }

    const rows = payload.series
      .map((metric) => {
        const value = metric.values[index];
        if (value === null || value === undefined) return null;
        const display = formatTooltipValue(value);
        return `
          <div class="tooltip-row">
            <span class="tooltip-swatch" style="background:${metric.color}"></span>
            <span>${metric.label}: ${display}${metric.unit ? ` ${metric.unit}` : ""}</span>
          </div>
        `;
      })
      .filter(Boolean)
      .join("");

    if (!rows) return;
    showTooltip(`<div class="tooltip-time">${timeLabel}</div>${rows}`, event.clientX, event.clientY);
  });

  canvas.addEventListener("mouseleave", hideTooltip);
  canvas.addEventListener("blur", hideTooltip);
}

function formatTimeRange(start, end) {
  const opts = { weekday: "short", hour: "numeric" };
  return `${start.toLocaleString(undefined, opts)} to ${end.toLocaleString(undefined, opts)}`;
}

function parseDuration(duration) {
  const match = duration.match(/P(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  return hours * 60 + minutes;
}

function parseIntervalValues(values) {
  return values
    .filter((entry) => entry.value !== null)
    .map((entry) => {
      const [startStr, durationStr] = entry.validTime.split("/");
      const start = new Date(startStr).getTime();
      const durationMinutes = parseDuration(durationStr);
      const end = start + durationMinutes * 60 * 1000;
      const value = sanitizeValue(entry.value);
      return { start, end, value };
    });
}

function getIntervalValue(intervals, timeMs) {
  const found = intervals.find((entry) => timeMs >= entry.start && timeMs < entry.end);
  return found ? found.value : null;
}

function normalizeWindSpeed(speedText) {
  if (!speedText) return null;
  const match = speedText.match(/(\d+)(?:\s*to\s*(\d+))?/i);
  if (!match) return null;
  const low = parseInt(match[1], 10);
  const high = parseInt(match[2] || match[1], 10);
  return Math.round((low + high) / 2);
}

function formatUpdated(value) {
  if (!value) return "Updated time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated time unavailable";
  return `Updated ${date.toLocaleString()}`;
}

function humanizeKey(key) {
  if (labelOverrides[key]) return labelOverrides[key];
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (match) => match.toUpperCase());
}

function normalizeUom(uom) {
  const cleaned = (uom || "").replace("wmoUnit:", "").replace("unit:", "");
  if (cleaned === "percent") {
    return { unit: "%", convert: (value) => value };
  }
  if (cleaned === "degC") {
    return { unit: "°F", convert: (value) => value * 1.8 + 32 };
  }
  if (cleaned === "degF") {
    return { unit: "°F", convert: (value) => value };
  }
  if (cleaned === "m_s-1") {
    return { unit: "mph", convert: (value) => value * 2.23694 };
  }
  if (cleaned === "km_h-1") {
    return { unit: "mph", convert: (value) => value * 0.621371 };
  }
  if (cleaned === "m") {
    return { unit: "mi", convert: (value) => value / 1609.34 };
  }
  if (cleaned === "mm") {
    return { unit: "in", convert: (value) => value / 25.4 };
  }
  if (cleaned === "cm") {
    return { unit: "in", convert: (value) => value / 2.54 };
  }
  if (cleaned === "kg_m-2") {
    return { unit: "in", convert: (value) => value / 25.4 };
  }
  if (cleaned === "Pa") {
    return { unit: "hPa", convert: (value) => value / 100 };
  }
  return { unit: cleaned || "", convert: (value) => value };
}

function sanitizeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (Math.abs(value) > 9000) return null;
  return value;
}

function shouldExcludeMetric(key) {
  const normalized = key.toLowerCase();
  return (
    normalized === "mintemperature" ||
    normalized === "maxtemperature" ||
    normalized === "winddirection" ||
    normalized === "transportwinddirection" ||
    normalized === "transportwindspeed" ||
    normalized === "ceilingheight" ||
    normalized === "mixingheight" ||
    normalized === "visibility" ||
    normalized === "lowvisibilityoccurrenceriskindex" ||
    normalized === "atmosphericdispersionindex"
  );
}

function clampStartIndex(value) {
  const loc = state.data[state.selectedIndex];
  if (!loc) return 0;
  const maxStart = Math.max(0, loc.hourly.length - state.windowSize);
  return Math.max(0, Math.min(value, maxStart));
}

function ensureMetricVisibility(location) {
  const next = {};
  location.metrics.forEach((meta) => {
    const key = meta.key.toLowerCase();
    const defaultHidden = key === "dewpoint" || key === "windchill";
    next[meta.key] = state.metricVisibility[meta.key] ?? !defaultHidden;
  });
  state.metricVisibility = next;
}

function isMetricVisible(key) {
  return state.metricVisibility[key] !== false;
}

function toggleMetric(key) {
  state.metricVisibility[key] = !isMetricVisible(key);
  renderView();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "focused-forecast-demo" }
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

async function loadLocation(location) {
  const point = await fetchJson(`https://api.weather.gov/points/${location.lat},${location.lon}`);
  const forecastHourly = await fetchJson(point.properties.forecastHourly);
  const grid = await fetchJson(point.properties.forecastGridData);
  const updated =
    forecastHourly.properties.updated ||
    forecastHourly.properties.updateTime ||
    forecastHourly.properties.generatedAt ||
    grid.properties.updateTime ||
    null;

  const metricMeta = Object.entries(grid.properties)
    .filter(([key, prop]) => prop && Array.isArray(prop.values) && !shouldExcludeMetric(key))
    .map(([key, prop]) => {
      const { unit, convert } = normalizeUom(prop.uom);
      const normalizedUnit = !unit && key.toLowerCase().includes("probability") ? "%" : unit;
      return {
        key,
        label: humanizeKey(key),
        unit: normalizedUnit,
        convert,
        intervals: parseIntervalValues(prop.values)
      };
    });

  const hourly = forecastHourly.properties.periods.map((period) => {
    const time = new Date(period.startTime);
    const timeMs = time.getTime();
    const metrics = {};

    metricMeta.forEach((meta) => {
      const raw = getIntervalValue(meta.intervals, timeMs);
      if (raw === null || raw === undefined) {
        metrics[meta.key] = null;
      } else {
        const converted = meta.convert(raw);
        metrics[meta.key] = sanitizeValue(converted);
      }
    });

    return {
      time,
      shortForecast: period.shortForecast,
      windDirection: period.windDirection,
      windSpeedText: period.windSpeed,
      metrics
    };
  });

  const filteredMeta = metricMeta.filter((meta) =>
    hourly.some((entry) => entry.metrics[meta.key] !== null && entry.metrics[meta.key] !== undefined)
  );

  const metrics = filteredMeta
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((meta, index) => ({
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      color: colorPalette[index % colorPalette.length]
    }));

  return {
    ...location,
    updated,
    hourly,
    metrics
  };
}

function renderLocations() {
  locationListEl.innerHTML = "";
  state.data.forEach((loc, index) => {
    const card = document.createElement("div");
    card.className = "location-card" + (index === state.selectedIndex ? " active" : "");
    card.innerHTML = `
      <h3>${loc.name}</h3>
      <p>${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}</p>
    `;
    card.addEventListener("click", () => selectLocation(index));
    locationListEl.appendChild(card);
  });
}

function selectLocation(index) {
  state.selectedIndex = index;
  state.startIndex = 0;
  startIndexEl.value = "0";
  renderLocations();
  ensureMetricVisibility(state.data[index]);
  updateSliders();
  renderView();
}

function setWindowSize(value) {
  state.windowSize = snapWindowSize(value);
  windowLabelEl.textContent = `${state.windowSize}h`;
  updateSliders();
  renderView();
}

function setStartIndex(value) {
  state.startIndex = clampStartIndex(value);
  startIndexEl.value = String(state.startIndex);
  renderView();
}

function setChartMode(mode) {
  state.chartMode = mode;
  modeSeparateBtn.classList.toggle("active", mode === "separate");
  modeOverlayBtn.classList.toggle("active", mode === "overlay");
  renderView();
}


function buildSeries(location, windowData) {
  return location.metrics.map((meta) => ({
    ...meta,
    values: windowData.map((entry) => entry.metrics[meta.key])
  }));
}

function renderView() {
  const loc = state.data[state.selectedIndex];
  if (!loc) return;

  state.startIndex = clampStartIndex(state.startIndex);
  startIndexEl.value = String(state.startIndex);

  const sliceStart = state.startIndex;
  const sliceEnd = sliceStart + state.windowSize;
  const windowData = loc.hourly.slice(sliceStart, sliceEnd);

  locationNameEl.textContent = loc.name;
  locationMetaEl.textContent = formatUpdated(loc.updated);

  if (windowData.length) {
    timeRangeEl.textContent = formatTimeRange(windowData[0].time, windowData[windowData.length - 1].time);
  } else {
    timeRangeEl.textContent = "No data for this window";
  }

  renderCharts(windowData, loc);
  renderDetails(windowData);
}

function renderCharts(windowData, location) {
  chartsEl.innerHTML = "";
  legendEl.innerHTML = "";

  const series = buildSeries(location, windowData);
  const times = windowData.map((entry) => entry.time);

  if (state.chartMode === "overlay") {
    overlayNoteEl.style.display = "block";
    renderOverlayGroups(series, times);
  } else {
    overlayNoteEl.style.display = "none";
    legendEl.innerHTML = "";
    const visibleSeries = series.filter((metric) => isMetricVisible(metric.key));
    visibleSeries.forEach((metric) => {
      const canvas = document.createElement("canvas");
      canvas.height = 120;
      chartsEl.appendChild(canvas);
      drawChart(canvas, metric.values, times, metric);
      attachTooltip(canvas, {
        type: "single",
        values: metric.values,
        times,
        label: `${metric.label}${metric.unit ? ` (${metric.unit})` : ""}`,
        padding: chartPadding
      });
    });
  }
}

function renderLegend(container, series) {
  series.forEach((metric) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-toggle" + (isMetricVisible(metric.key) ? "" : " is-off");
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = metric.color;
    const label = document.createElement("span");
    label.textContent = `${metric.label}${metric.unit ? ` (${metric.unit})` : ""}`;
    button.appendChild(swatch);
    button.appendChild(label);
    button.addEventListener("click", () => toggleMetric(metric.key));
    item.appendChild(button);
    container.appendChild(item);
  });
}

function renderOverlayGroups(series, times) {
  const grouped = new Map();
  series.forEach((metric) => {
    const group = getGroupForMetric(metric);
    const unitKey = metric.unit || "unitless";
    const id = `${group.id}|${unitKey}`;
    if (!grouped.has(id)) {
      grouped.set(id, { ...group, unit: metric.unit, metrics: [] });
    }
    grouped.get(id).metrics.push(metric);
  });

  const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
    const aIndex = groupOrder.indexOf(a.id);
    const bIndex = groupOrder.indexOf(b.id);
    if (aIndex === -1 && bIndex === -1) return a.label.localeCompare(b.label);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    if (aIndex !== bIndex) return aIndex - bIndex;

    if (a.id === "precip-prob" && b.id === "precip-prob") {
      return unitSortRank(a.unit) - unitSortRank(b.unit);
    }
    if (a.id === "precip" && b.id === "precip") {
      return unitSortRank(a.unit) - unitSortRank(b.unit);
    }
    if (a.id === "wind" && b.id === "wind") {
      return unitSortRank(a.unit) - unitSortRank(b.unit);
    }
    if (a.id === "sky" && b.id === "sky") {
      return unitSortRank(a.unit) - unitSortRank(b.unit);
    }
    if (a.id === "humidity" && b.id === "humidity") {
      return unitSortRank(a.unit) - unitSortRank(b.unit);
    }

    return (a.unit || "").localeCompare(b.unit || "");
  });

  sortedGroups.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "chart-group";

    const head = document.createElement("div");
    head.className = "chart-group-head";
    head.textContent = `${group.label}${group.unit ? ` (${group.unit})` : ""}`;
    groupEl.appendChild(head);

    const canvas = document.createElement("canvas");
    canvas.height = 200;
    groupEl.appendChild(canvas);

    const legend = document.createElement("div");
    legend.className = "legend chart-group-legend";
    renderLegend(legend, group.metrics);
    groupEl.appendChild(legend);

    chartsEl.appendChild(groupEl);

    const visibleSeries = group.metrics.filter((metric) => isMetricVisible(metric.key));
    requestAnimationFrame(() => {
      if (visibleSeries.length) {
        drawOverlayChart(canvas, visibleSeries, times, group.label, group.unit);
      } else {
        drawEmptyOverlay(canvas, "Select metrics in the legend to show this chart.");
      }
      attachTooltip(canvas, {
        type: "overlay",
        series: visibleSeries,
        times,
        padding: overlayPadding
      });
    });
  });
}

function drawChart(canvas, values, times, config) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.height;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  const cleanValues = values.filter((v) => v !== null && v !== undefined);
  let min = cleanValues.length ? Math.min(...cleanValues) : 0;
  let max = cleanValues.length ? Math.max(...cleanValues) : 1;
  if (config.unit === "%") {
    min = 0;
    max = 100;
  }
  if (config.unit === "in" || config.unit === "mph") {
    min = 0;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const padding = { top: 28, right: 16, bottom: 24, left: 46 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const midnightIndices = getMidnightIndices(times);
  midnightIndices.forEach((index) => {
    const x = padding.left + (chartWidth * index) / (values.length - 1 || 1);
    ctx.strokeStyle = "rgba(18, 18, 26, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  });

  ctx.strokeStyle = "rgba(18, 18, 26, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#12121a";
  ctx.font = "12px Space Grotesk";
  const label = `${config.label}${config.unit ? ` (${config.unit})` : ""}`;
  ctx.fillText(label, padding.left, 18);

  if (!values.length) return;

  ctx.beginPath();
  values.forEach((value, index) => {
    if (value === null || value === undefined) return;
    const x = padding.left + (chartWidth * index) / (values.length - 1 || 1);
    const yRatio = (value - min) / (max - min || 1);
    const y = padding.top + chartHeight - yRatio * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = config.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = config.color;
  values.forEach((value, index) => {
    if (value === null || value === undefined) return;
    const x = padding.left + (chartWidth * index) / (values.length - 1 || 1);
    const yRatio = (value - min) / (max - min || 1);
    const y = padding.top + chartHeight - yRatio * chartHeight;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#56566d";
  ctx.font = "11px Space Grotesk";
  ctx.fillText(String(Math.round(max)), 10, padding.top + 6);
  ctx.fillText(String(Math.round(min)), 10, padding.top + chartHeight);

  const tickIndices = getTickIndices(times, getTickIntervalHours());
  tickIndices.forEach((index) => {
    const time = times[index];
    if (!time) return;
    const x = padding.left + (chartWidth * index) / (values.length - 1 || 1);
    const labelTime = time.toLocaleTimeString(undefined, { hour: "numeric" });
    ctx.fillText(labelTime, x - 8, height - 6);
  });
}

function drawOverlayChart(canvas, series, times, title, unit) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.height;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  const padding = { top: 28, right: 16, bottom: 24, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const segments = getDaySegments(times);
  segments.forEach((segment) => {
    if (!segment.label) return;
    const startX = padding.left + (chartWidth * segment.start) / (times.length - 1 || 1);
    const endX = padding.left + (chartWidth * segment.end) / (times.length - 1 || 1);
    const centerX = (startX + endX) / 2;
    ctx.fillStyle = "rgba(18, 18, 26, 0.11)";
    ctx.font = "48px Space Grotesk";
    ctx.textAlign = "center";
    const textWidth = ctx.measureText(segment.label).width;
    const leftEdge = centerX - textWidth / 2;
    const rightEdge = centerX + textWidth / 2;
    const isFirst = segment.start === 0;
    const isLast = segment.end === times.length - 1;
    if ((isFirst || isLast) && (leftEdge < padding.left || rightEdge > width - padding.right)) {
      ctx.textAlign = "start";
      return;
    }
    ctx.fillText(segment.label, centerX, padding.top + chartHeight * 0.55);
    ctx.textAlign = "start";
  });

  ctx.strokeStyle = "rgba(18, 18, 26, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.lineTo(width - padding.right, padding.top + chartHeight);
  ctx.stroke();

  const midnightIndices = getMidnightIndices(times);
  midnightIndices.forEach((index) => {
    const x = padding.left + (chartWidth * index) / (times.length - 1 || 1);
    ctx.strokeStyle = "rgba(18, 18, 26, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  });

  ctx.strokeStyle = "rgba(18, 18, 26, 0.1)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#12121a";
  ctx.font = "12px Space Grotesk";
  ctx.fillText(`${title}${unit ? ` (${unit})` : ""}`, padding.left, 18);

  const allValues = series.flatMap((metric) =>
    metric.values.filter((value) => value !== null && value !== undefined)
  );
  let min = allValues.length ? Math.min(...allValues) : 0;
  let max = allValues.length ? Math.max(...allValues) : 1;
  if (unit === "%") {
    min = 0;
    max = 100;
  }
  if (unit === "in" || unit === "mph") {
    min = 0;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }

  let drewLine = false;
  series.forEach((metric) => {
    const cleanValues = metric.values.filter((v) => v !== null && v !== undefined);
    if (!cleanValues.length) return;
    const range = max - min || 1;

    ctx.beginPath();
    let started = false;
    metric.values.forEach((value, index) => {
      if (value === null || value === undefined) return;
      const x = padding.left + (chartWidth * index) / (metric.values.length - 1 || 1);
      const yRatio = (value - min) / range;
      const y = padding.top + chartHeight - yRatio * chartHeight;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    if (started) {
      drewLine = true;
      ctx.strokeStyle = metric.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  ctx.fillStyle = "#56566d";
  ctx.font = "11px Space Grotesk";
  ctx.fillText(String(Math.round(max)), 8, padding.top + 6);
  ctx.fillText(String(Math.round(min)), 8, padding.top + chartHeight);

  for (let i = 1; i < 4; i += 1) {
    const label = max - ((max - min) / 4) * i;
    const y = padding.top + (chartHeight / 4) * i + 4;
    ctx.fillText(label.toFixed(1), 6, y);
  }

  const tickIndices = getTickIndices(times, getTickIntervalHours());
  tickIndices.forEach((index) => {
    const time = times[index];
    if (!time) return;
    const x = padding.left + (chartWidth * index) / (times.length - 1 || 1);
    const labelTime = time.toLocaleTimeString(undefined, { hour: "numeric" });
    ctx.fillText(labelTime, x - 8, height - 6);
  });

  if (!drewLine) {
    ctx.fillStyle = "#56566d";
    ctx.font = "14px Space Grotesk";
    ctx.fillText("No data for this window.", padding.left, padding.top + chartHeight / 2);
  }

  ctx.strokeStyle = "rgba(18, 18, 26, 0.6)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.stroke();
}

function drawEmptyOverlay(canvas, message) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.height;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#56566d";
  ctx.font = "14px Space Grotesk";
  ctx.fillText(message, 24, height / 2);
}

function getMetricValue(entry, key) {
  return entry.metrics[key] ?? null;
}

function renderDetails(windowData) {
  detailCardsEl.innerHTML = "";
  windowData.slice(0, 6).forEach((item) => {
    const temp = getMetricValue(item, "temperature");
    const windSpeed = getMetricValue(item, "windSpeed") ?? normalizeWindSpeed(item.windSpeedText);
    const pop = getMetricValue(item, "probabilityOfPrecipitation");
    const sky = getMetricValue(item, "skyCover");

    const card = document.createElement("div");
    card.className = "detail-card";
    card.innerHTML = `
      <h4>${item.time.toLocaleString(undefined, { weekday: "short", hour: "numeric" })}</h4>
      <p>${item.shortForecast}</p>
      <p>Temp: ${temp ?? "--"} | Wind: ${windSpeed ?? "--"} mph ${item.windDirection ?? ""}</p>
      <p>PoP: ${pop ?? "--"}% | Sky: ${sky ?? "--"}%</p>
    `;
    detailCardsEl.appendChild(card);
  });
}

async function loadAll() {
  try {
    setStatus("Fetching NOAA data...");
    state.data = await Promise.all(locations.map(loadLocation));
    ensureMetricVisibility(state.data[state.selectedIndex]);
    renderLocations();
    setChartMode(state.chartMode);
    updateSliders();
    renderView();
    setStatus("Forecasts ready");
  } catch (err) {
    setStatus("Failed to load data");
    console.error(err);
  }
}

function updateSliders() {
  const loc = state.data[state.selectedIndex];
  if (!loc) return;
  const maxWindow = Math.max(1, loc.hourly.length);
  const minWindow = Math.min(12, maxWindow);
  const maxSnap = maxWindow >= 12 ? Math.floor(maxWindow / 12) * 12 : maxWindow;
  windowSizeEl.max = String(maxSnap);
  windowSizeEl.min = String(minWindow);
  windowSizeEl.step = maxWindow >= 12 ? "12" : "1";
  state.windowSize = snapWindowSize(state.windowSize, maxSnap, minWindow);
  windowSizeEl.value = String(state.windowSize);
  windowLabelEl.textContent = `${state.windowSize}h`;
  const maxStart = Math.max(0, loc.hourly.length - state.windowSize);
  startIndexEl.max = String(maxStart);
  state.startIndex = clampStartIndex(state.startIndex);
  startIndexEl.value = String(state.startIndex);
}

function snapWindowSize(value, maxSnap, minWindow = 12) {
  const limit = maxSnap ?? value;
  if (limit < 12) return Math.max(1, Math.min(value, limit));
  const snapped = Math.round(value / 12) * 12;
  return Math.max(minWindow, Math.min(snapped, limit));
}

function unitSortRank(unit) {
  const normalized = (unit || "").toLowerCase();
  if (normalized === "%") return 0;
  if (normalized === "in") return 1;
  if (normalized === "mph") return 2;
  if (normalized === "°f") return 3;
  return 10;
}


windowSizeEl.addEventListener("input", (event) => {
  setWindowSize(parseInt(event.target.value, 10));
});

startIndexEl.addEventListener("input", (event) => {
  setStartIndex(parseInt(event.target.value, 10));
});

refreshBtn.addEventListener("click", () => {
  loadAll();
});


modeSeparateBtn.addEventListener("click", () => {
  setChartMode("separate");
});

modeOverlayBtn.addEventListener("click", () => {
  setChartMode("overlay");
});

window.addEventListener("resize", () => {
  renderView();
});

loadAll();

setInterval(() => {
  loadAll();
}, 15 * 60 * 1000);
