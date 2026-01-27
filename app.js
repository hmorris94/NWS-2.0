const locations = [
  { name: "Sterling, VA", lat: 39.0067, lon: -77.4286 },
  { name: "Frederick, MD", lat: 39.4143, lon: -77.4105 },
  { name: "Midlothian, VA", lat: 37.5057, lon: -77.6499 },
  { name: "Hatteras, NC", lat: 35.2193, lon: -75.6907 }
];

const state = {
  selectedIndex: 0,
  data: [],
  windowSize: 96,
  startIndex: 0,
  metricVisibility: {}
};

const locationListEl = document.getElementById("locationList");
const locationNameEl = document.getElementById("locationName");
const locationMetaEl = document.getElementById("locationMeta");
const refreshBtn = document.getElementById("refresh");
const windowSizeEl = document.getElementById("windowSize");
const windowLabelEl = document.getElementById("windowLabel");
const startIndexEl = document.getElementById("startIndex");
const timeRangeEl = document.getElementById("timeRange");
const chartsEl = document.getElementById("charts");
const overlayNoteEl = document.getElementById("overlayNote");
const forecastCardsEl = document.getElementById("forecastCards");
const forecastSectionEl = document.getElementById("forecastSection");
const forecastToggleEl = document.getElementById("forecastToggle");
const locationsSectionEl = document.querySelector(".locations");
const locationsToggleEl = document.getElementById("locationsToggle");
const themeToggleBtn = document.getElementById("themeToggle");
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
  probabilityOfPrecipitation: "Probability of Precipitation",
  quantitativePrecipitation: "Precip Amount",
  windSpeed: "Wind Speed",
  windGust: "Wind Gust",
  skyCover: "Sky Cover",
  relativeHumidity: "Relative Humidity",
  apparentTemperature: "Feels Like"
};

const groupOrder = ["temperature", "precip-prob", "precip", "wind", "sky", "humidity", "pressure", "visibility"];
const overlayChartPadding = { top: 14, right: 10, bottom: 28, left: 38 };
const overlayPadding = overlayChartPadding;

const interactionState = {
  isInteracting: false,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  panStartIndex: 0,
  dragMode: null,
  activePointers: new Map(),
  pinchStartDistance: 0,
  pinchStartWindow: 0,
  pinchAnchorRatio: 0,
  wheelTimeout: null,
  rafToken: null
};

const chartScene = {
  locationName: "",
  instances: []
};

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


function showTooltip(content, x, y) {
  tooltipEl.innerHTML = content;
  const padding = 12;
  const maxX = window.innerWidth - tooltipEl.offsetWidth - padding;
  const maxY = window.innerHeight - tooltipEl.offsetHeight - padding;
  const left = Math.min(x - tooltipEl.offsetWidth - 14, maxX);
  const top = Math.min(y - tooltipEl.offsetHeight - 14, maxY);
  tooltipEl.style.left = `${Math.max(padding, left)}px`;
  tooltipEl.style.top = `${Math.max(padding, top)}px`;
  tooltipEl.classList.add("visible");
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
}

function themeVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggleBtn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function applyForecastState(collapsed) {
  forecastSectionEl.classList.toggle("is-collapsed", collapsed);
  forecastToggleEl.textContent = collapsed ? "Show" : "Hide";
}

function initForecastState() {
  const saved = localStorage.getItem("forecastCollapsed");
  const collapsed = saved === "true";
  applyForecastState(collapsed);
}

function applyLocationsState(collapsed) {
  const allowCollapse = window.matchMedia("(max-width: 960px)").matches;
  const nextState = allowCollapse && collapsed;
  locationsSectionEl.classList.toggle("is-collapsed", nextState);
  locationsToggleEl.textContent = nextState ? "Show" : "Hide";
  locationsToggleEl.disabled = !allowCollapse;
}

function initLocationsState() {
  const saved = localStorage.getItem("locationsCollapsed");
  const collapsed = saved === "true";
  applyLocationsState(collapsed);
}

function formatTooltipValueWithUnit(value, unit, key) {
  if (value === null || value === undefined) return "--";
  const normalized = (key || "").toLowerCase();
  const isPrecip =
    normalized.includes("precip") || normalized.includes("snow") || normalized.includes("ice");
  const precision = isPrecip ? 2 : 1;
  const rounded = Number(value.toFixed(precision));
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(precision);
}

function formatAxisValue(value, precision) {
  const rounded = Number(value.toFixed(precision));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(precision);
}

function getIndexFromEvent(event, canvas, count, padding) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const chartWidth = rect.width - padding.left - padding.right;
  if (chartWidth <= 0 || count <= 1) return 0;
  const clamped = Math.min(Math.max(x - padding.left, 0), chartWidth);
  return Math.round((clamped / chartWidth) * (count - 1));
}

function getIndexFromEventWindow(event, canvas, count, padding, startIndex, windowSize) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const chartWidth = rect.width - padding.left - padding.right;
  if (chartWidth <= 0 || count <= 1 || windowSize <= 1) return startIndex;
  const clamped = Math.min(Math.max(x - padding.left, 0), chartWidth);
  const ratio = clamped / chartWidth;
  const index = startIndex + ratio * (windowSize - 1);
  return Math.max(0, Math.min(count - 1, Math.round(index)));
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

function getTickIndicesByWidth(times, chartWidth, ctx) {
  if (!times.length) return [];
  const sampleLabel = times[0].toLocaleTimeString(undefined, { hour: "numeric" });
  const labelWidth = ctx.measureText(sampleLabel).width;
  const minGap = 16;
  const maxLabels = Math.max(2, Math.floor(chartWidth / (labelWidth + minGap)));
  const step = Math.max(1, Math.ceil((times.length - 1) / (maxLabels - 1)));
  const indices = [];
  for (let i = 0; i < times.length; i += step) {
    indices.push(i);
  }
  if (indices[indices.length - 1] !== times.length - 1) {
    indices.push(times.length - 1);
  }
  return indices;
}

function pruneTrailingOverlap(indices, times, chartWidth, ctx, padding) {
  if (indices.length < 2) return indices;
  const lastIndex = indices[indices.length - 1];
  const prevIndex = indices[indices.length - 2];
  const lastLabel = times[lastIndex]?.toLocaleTimeString(undefined, { hour: "numeric" }) ?? "";
  const prevLabel = times[prevIndex]?.toLocaleTimeString(undefined, { hour: "numeric" }) ?? "";
  const lastWidth = ctx.measureText(lastLabel).width;
  const prevWidth = ctx.measureText(prevLabel).width;
  const lastX = padding.left + (chartWidth * lastIndex) / (times.length - 1 || 1);
  const prevX = padding.left + (chartWidth * prevIndex) / (times.length - 1 || 1);
  const lastLeft = (padding.left + chartWidth) - lastWidth;
  const prevRight = prevX - 8 + prevWidth;
  if (prevRight > lastLeft) {
    return indices.slice(0, -2).concat(lastIndex);
  }
  return indices;
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
    if (interactionState.isInteracting) return;
    const index = getIndexFromEventWindow(
      event,
      canvas,
      payload.times.length,
      payload.padding,
      state.startIndex,
      state.windowSize
    );
    const time = payload.times[index];
    if (!time) return;
    const timeLabel = time.toLocaleString(undefined, { weekday: "short", hour: "numeric" });

    if (payload.type === "single") {
      const value = payload.values[index];
      const display = formatTooltipValueWithUnit(value, payload.unit, payload.key);
      showTooltip(
        `<div class="tooltip-time">${timeLabel}</div><div>${payload.label}: ${display}</div>`,
        event.clientX,
        event.clientY
      );
      return;
    }

    const rows = payload.series
      .filter((metric) => isMetricVisible(metric.key))
      .map((metric) => {
        const value = metric.values[index];
        if (value === null || value === undefined) return null;
        const display = formatTooltipValueWithUnit(value, metric.unit, metric.key);
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

function getAnchorRatioFromClientX(canvas, clientX) {
  const rect = canvas.getBoundingClientRect();
  const chartWidth = rect.width - overlayChartPadding.left - overlayChartPadding.right;
  if (chartWidth <= 0) return 0.5;
  const localX = clientX - rect.left - overlayChartPadding.left;
  return Math.min(1, Math.max(0, localX / chartWidth));
}

function zoomWindow(targetWindow, anchorRatio) {
  const loc = state.data[state.selectedIndex];
  if (!loc) return;
  const maxWindow = Math.max(1, loc.hourly.length);
  const minWindow = Math.min(12, maxWindow);
  const nextWindow = clampWindowSize(targetWindow, maxWindow, minWindow);
  const anchorIndex = state.startIndex + anchorRatio * state.windowSize;
  const nextStart = clampStartIndex(anchorIndex - anchorRatio * nextWindow, nextWindow);
  if (nextWindow === state.windowSize && nextStart === state.startIndex) return;
  state.windowSize = nextWindow;
  state.startIndex = nextStart;
  updateSliders();
  scheduleInteractionRender();
}

function attachPanZoom(canvas) {
  canvas.style.touchAction = "pan-y";

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      interactionState.isInteracting = true;
      clearTimeout(interactionState.wheelTimeout);
      const deltaScale =
        event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      const zoomFactor = Math.exp(-deltaScale * 0.002);
      const anchorRatio = getAnchorRatioFromClientX(canvas, event.clientX);
      zoomWindow(state.windowSize * zoomFactor, anchorRatio);
      interactionState.wheelTimeout = setTimeout(() => {
        interactionState.isInteracting = false;
      }, 160);
    },
    { passive: false }
  );

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    interactionState.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    interactionState.isInteracting = true;
    hideTooltip();

    if (interactionState.activePointers.size === 1) {
      interactionState.dragMode = event.pointerType === "mouse" ? "pan" : null;
      interactionState.isPanning = event.pointerType === "mouse";
      interactionState.panStartX = event.clientX;
      interactionState.panStartY = event.clientY;
      interactionState.panStartIndex = state.startIndex;
    }

    if (interactionState.activePointers.size === 2) {
      interactionState.isPanning = false;
      const points = Array.from(interactionState.activePointers.values());
      interactionState.pinchStartDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      interactionState.pinchStartWindow = state.windowSize;
      const centerX = (points[0].x + points[1].x) / 2;
      interactionState.pinchAnchorRatio = getAnchorRatioFromClientX(canvas, centerX);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!interactionState.activePointers.has(event.pointerId)) return;
    interactionState.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (interactionState.activePointers.size === 1) {
      const dx = event.clientX - interactionState.panStartX;
      const dy = event.clientY - interactionState.panStartY;
      if (interactionState.dragMode === null && event.pointerType !== "mouse") {
        const distance = Math.hypot(dx, dy);
        if (distance < 6) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          interactionState.dragMode = "scroll";
          interactionState.isPanning = false;
          interactionState.isInteracting = false;
          try {
            canvas.releasePointerCapture(event.pointerId);
          } catch (err) {
            // Ignore if capture is not active.
          }
          return;
        }
        interactionState.dragMode = "pan";
        interactionState.isPanning = true;
      }
    }

    if (interactionState.activePointers.size === 1 && interactionState.isPanning) {
      const rect = canvas.getBoundingClientRect();
      const chartWidth = rect.width - overlayChartPadding.left - overlayChartPadding.right;
      if (chartWidth <= 0) return;
      const dx = event.clientX - interactionState.panStartX;
      const deltaIndex = (-dx / chartWidth) * state.windowSize;
      const nextStart = clampStartIndex(interactionState.panStartIndex + deltaIndex, state.windowSize);
      if (nextStart !== state.startIndex) {
        state.startIndex = nextStart;
        updateSliders();
        scheduleInteractionRender();
      }
      event.preventDefault();
      return;
    }

    if (interactionState.activePointers.size === 2) {
      const points = Array.from(interactionState.activePointers.values());
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const centerX = (points[0].x + points[1].x) / 2;
      const anchorRatio = getAnchorRatioFromClientX(canvas, centerX);
      if (interactionState.pinchStartDistance > 0) {
        const scale = distance / interactionState.pinchStartDistance;
        const nextWindow = interactionState.pinchStartWindow / scale;
        zoomWindow(nextWindow, anchorRatio);
      }
      event.preventDefault();
    }
  });

  const endPointerInteraction = (event) => {
    if (interactionState.activePointers.has(event.pointerId)) {
      interactionState.activePointers.delete(event.pointerId);
    }
    if (interactionState.activePointers.size === 1) {
      const remaining = Array.from(interactionState.activePointers.values())[0];
      interactionState.dragMode = null;
      interactionState.isPanning = true;
      interactionState.panStartX = remaining.x;
      interactionState.panStartY = remaining.y;
      interactionState.panStartIndex = state.startIndex;
      return;
    }
    if (interactionState.activePointers.size === 0) {
      interactionState.isPanning = false;
      interactionState.dragMode = null;
      interactionState.isInteracting = false;
    }
  };

  canvas.addEventListener("pointerup", endPointerInteraction);
  canvas.addEventListener("pointercancel", endPointerInteraction);
  canvas.addEventListener("pointerleave", endPointerInteraction);
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
  return `Updated ${date.toLocaleString(undefined, { timeZoneName: "short" })}`;
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

function getMetricColor(key, index) {
  const normalized = key.toLowerCase();
  if (normalized.includes("quantitativeprecipitation")) return "#118ab2";
  if (normalized.includes("snow")) return "#00bcd4";
  if (normalized.includes("ice")) return "#8b5cf6";
  if (normalized.includes("rain") || normalized.includes("liquid")) return "#00a676";
  if (normalized.includes("drizzle")) return "#f59e0b";
  if (normalized.includes("sleet") || normalized.includes("freezing")) return "#ef4444";
  return colorPalette[index % colorPalette.length];
}

function buildDailyForecast(periods) {
  const days = new Map();
  periods.forEach((period) => {
    const date = new Date(period.startTime);
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 10);
    const entry = days.get(key) || { date, day: null, night: null };
    if (period.isDaytime) entry.day = period;
    else entry.night = period;
    days.set(key, entry);
  });

  return Array.from(days.values()).map((entry) => {
    const day = entry.day;
    const night = entry.night;
    const name =
      (day && day.name) ||
      (night && night.name) ||
      entry.date.toLocaleDateString(undefined, { weekday: "long" });
    const high = day ? day.temperature : null;
    const low = night ? night.temperature : null;
    const unit = (day && day.temperatureUnit) || (night && night.temperatureUnit) || "";
    let blurb = "";
    if (day && day.shortForecast && night && night.shortForecast) {
      const combined = `${day.shortForecast} then ${night.shortForecast}`;
      const tokens = combined
        .split(/\s+then\s+/i)
        .map((part) => part.trim())
        .filter(Boolean);
      const deduped = tokens.filter((part, index) => part !== tokens[index - 1]);
      blurb = deduped.join(" then ");
    } else {
      blurb = (day && day.shortForecast) || (night && night.shortForecast) || "";
    }
    return { name, high, low, unit, blurb };
  });
}

function formatTemp(temp, unit) {
  if (temp === null || temp === undefined) return "--";
  const label = unit === "F" ? "°F" : unit;
  return `${temp}${label ? ` ${label}` : ""}`;
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
    normalized === "atmosphericdispersionindex" ||
    normalized === "windchill"
  );
}

function clampStartIndex(value, windowSize = state.windowSize) {
  const loc = state.data[state.selectedIndex];
  if (!loc) return 0;
  const maxStart = Math.max(0, loc.hourly.length - windowSize);
  return Math.max(0, Math.min(Math.round(value), maxStart));
}

function clampWindowSize(value, maxWindow, minWindow) {
  if (!Number.isFinite(value)) return minWindow;
  return Math.max(minWindow, Math.min(Math.round(value), maxWindow));
}

function scheduleInteractionRender() {
  if (interactionState.rafToken) return;
  interactionState.rafToken = requestAnimationFrame(() => {
    interactionState.rafToken = null;
    renderView({ rebuild: false });
  });
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
  const forecast = await fetchJson(point.properties.forecast);
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

  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);
  const trimmedHourly =
    hourly.length && currentHour > hourly[0].time
      ? hourly.filter((entry) => entry.time >= currentHour)
      : hourly;

  const filteredMeta = metricMeta.filter((meta) =>
    hourly.some((entry) => entry.metrics[meta.key] !== null && entry.metrics[meta.key] !== undefined)
  );

  const metrics = filteredMeta
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((meta, index) => ({
      key: meta.key,
      label: meta.label,
      unit: meta.unit,
      color: getMetricColor(meta.key, index)
    }));

  const metricExtents = {};
  const groupExtents = {};
  metrics.forEach((metric) => {
    const values = trimmedHourly
      .map((entry) => entry.metrics[metric.key])
      .filter((value) => value !== null && value !== undefined);
    if (!values.length) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    metricExtents[metric.key] = { min, max };
    const group = getGroupForMetric(metric);
    const groupKey = `${group.id}|${metric.unit || "unitless"}`;
    if (!groupExtents[groupKey]) {
      groupExtents[groupKey] = { min, max };
    } else {
      groupExtents[groupKey].min = Math.min(groupExtents[groupKey].min, min);
      groupExtents[groupKey].max = Math.max(groupExtents[groupKey].max, max);
    }
  });

  return {
    ...location,
    updated,
    hourly: trimmedHourly,
    metrics,
    metricExtents,
    groupExtents,
    dailyForecast: buildDailyForecast(forecast.properties.periods)
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
  localStorage.setItem("selectedLocation", state.data[index]?.name || "");
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


function buildSeries(location, windowData) {
  return location.metrics.map((meta) => ({
    ...meta,
    values: windowData.map((entry) => entry.metrics[meta.key])
  }));
}

function renderView(options = {}) {
  const loc = state.data[state.selectedIndex];
  if (!loc) return;
  const { rebuild = true } = options;

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

  renderCharts(loc, rebuild);
  renderForecast(loc);
  renderForecast(loc);
}

function buildFullSeries(location) {
  return location.metrics.map((meta) => ({
    ...meta,
    values: location.hourly.map((entry) => entry.metrics[meta.key])
  }));
}

function renderCharts(location, rebuild = true) {
  if (!location) return;
  const needsRebuild = rebuild || chartScene.locationName !== location.name || !chartScene.instances.length;

  if (needsRebuild) {
    chartsEl.innerHTML = "";
    chartScene.instances = [];
    chartScene.locationName = location.name;

    const series = buildFullSeries(location);
    if (overlayNoteEl) {
      overlayNoteEl.style.display = "block";
    }
    buildOverlayScene(series, location);
  }

  chartScene.instances.forEach((instance) => {
    drawOverlayInstance(instance);
  });
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
    label.textContent = metric.label;
    button.appendChild(swatch);
    button.appendChild(label);
    button.addEventListener("click", () => toggleMetric(metric.key));
    item.appendChild(button);
    container.appendChild(item);
  });
}

function buildOverlayScene(series, location) {
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
    if (group.id === "temperature") {
      group.metrics.sort((a, b) => {
        const aKey = a.key.toLowerCase();
        const bKey = b.key.toLowerCase();
        const aIsDew = aKey === "dewpoint";
        const bIsDew = bKey === "dewpoint";
        if (aIsDew && !bIsDew) return 1;
        if (!aIsDew && bIsDew) return -1;
        return a.label.localeCompare(b.label);
      });
    }
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

    const extentKey = `${group.id}|${group.unit || "unitless"}`;
    const fixedExtent = location.groupExtents?.[extentKey] || null;
    const instance = {
      groupId: group.id,
      label: group.label,
      unit: group.unit,
      canvas,
      ctx: canvas.getContext("2d"),
      series: group.metrics,
      times: location.hourly.map((entry) => entry.time),
      extent: fixedExtent,
      yValues: new Map(),
      layout: null
    };

    attachTooltip(canvas, {
      type: "overlay",
      series: instance.series,
      times: instance.times,
      padding: overlayPadding
    });
    attachPanZoom(canvas);
    chartScene.instances.push(instance);
  });
}

function drawChart(canvas, values, times, config) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height || canvas.height;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeVar("--canvas");
  ctx.fillRect(0, 0, width, height);

  let min = config?.extent?.min ?? null;
  let max = config?.extent?.max ?? null;
  if (min === null || max === null) {
    const cleanValues = values.filter((v) => v !== null && v !== undefined);
    min = cleanValues.length ? Math.min(...cleanValues) : 0;
    max = cleanValues.length ? Math.max(...cleanValues) : 1;
  }
  if (config.unit === "%") {
    min = 0;
    max = 100;
  }
  if (config.unit === "in" || config.unit === "mph") {
    min = 0;
  }
  if (config.unit === "in") {
    max = Math.max(max, 0.05);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const padding = { top: 14, right: 10, bottom: 28, left: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const midnightIndices = getMidnightIndices(times);
  midnightIndices.forEach((index) => {
    const x = padding.left + (chartWidth * index) / (values.length - 1 || 1);
    ctx.strokeStyle = themeVar("--chart-midnight");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  });

  ctx.strokeStyle = themeVar("--chart-grid");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

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

  const isPrecipAxis =
    config.unit === "in" ||
    config.key.toLowerCase().includes("precip") ||
    config.key.toLowerCase().includes("snow") ||
    config.key.toLowerCase().includes("ice");
  const precision = isPrecipAxis ? 2 : 0;
  const minLabel = formatAxisValue(min, precision);
  const maxLabel = formatAxisValue(max, precision);
  ctx.fillStyle = "#56566d";
  ctx.font = "11px Space Grotesk";
  ctx.textAlign = "right";
  ctx.fillText(maxLabel, padding.left - 8, padding.top + 6);
  ctx.fillText(minLabel, padding.left - 8, padding.top + chartHeight);

  if (minLabel !== maxLabel) {
    for (let i = 1; i < 4; i += 1) {
      const label = max - ((max - min) / 4) * i;
      const y = padding.top + (chartHeight / 4) * i + 4;
      ctx.fillText(formatAxisValue(label, precision), padding.left - 8, y);
    }
  }
  ctx.textAlign = "start";

  let tickIndices = getTickIndicesByWidth(times, chartWidth, ctx);
  tickIndices = pruneTrailingOverlap(tickIndices, times, chartWidth, ctx, padding);
  tickIndices.forEach((index, position) => {
    const time = times[index];
    if (!time) return;
    const x = padding.left + (chartWidth * index) / (values.length - 1 || 1);
    const labelTime = time.toLocaleTimeString(undefined, { hour: "numeric" });
    if (position === tickIndices.length - 1) {
      ctx.textAlign = "right";
      ctx.fillText(labelTime, width - padding.right, height - 6);
      ctx.textAlign = "start";
    } else {
      ctx.fillText(labelTime, x - 8, height - 6);
    }
  });
}

function buildOverlayPaths(instance, layout) {
  const { series, extent } = instance;
  const { padding, chartWidth, chartHeight } = layout;
  let min = extent?.min ?? 0;
  let max = extent?.max ?? 1;

  if (instance.unit === "%") {
    min = 0;
    max = 100;
  }
  if (instance.unit === "in" || instance.unit === "mph") {
    min = 0;
  }
  if (instance.unit === "in") {
    max = Math.max(max, 0.05);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }

  instance.yValues.clear();
  const range = max - min || 1;
  series.forEach((metric) => {
    const yPositions = metric.values.map((value) => {
      if (value === null || value === undefined) return null;
      const yRatio = (value - min) / range;
      return padding.top + chartHeight - yRatio * chartHeight;
    });
    instance.yValues.set(metric.key, yPositions);
  });
}

function drawOverlayInstance(instance) {
  const { canvas, ctx, times, extent } = instance;
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height || canvas.height;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeVar("--canvas");
  ctx.fillRect(0, 0, width, height);

  const padding = overlayChartPadding;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  if (chartWidth <= 0 || chartHeight <= 0) return;

  const layout = instance.layout;
  const sizeChanged =
    !layout ||
    layout.width !== width ||
    layout.height !== height ||
    layout.chartWidth !== chartWidth ||
    layout.chartHeight !== chartHeight;
  if (sizeChanged) {
    instance.layout = { width, height, chartWidth, chartHeight, padding };
    buildOverlayPaths(instance, instance.layout);
  }

  const windowStart = state.startIndex;
  const windowEnd = windowStart + state.windowSize;
  const windowTimes = times.slice(windowStart, windowEnd);

  const segments = getDaySegments(windowTimes);
  const baseFontSize = 48;
  const scale = Math.min(1, width < 800 ? width / 800 : 1);
  const fontSize = Math.max(20, Math.round(baseFontSize * scale));
  segments.forEach((segment) => {
    if (!segment.label) return;
    const startX = padding.left + (chartWidth * segment.start) / (windowTimes.length - 1 || 1);
    const endX = padding.left + (chartWidth * segment.end) / (windowTimes.length - 1 || 1);
    const centerX = (startX + endX) / 2;
    ctx.fillStyle = themeVar("--chart-watermark");
    ctx.font = `${fontSize}px Space Grotesk`;
    ctx.textAlign = "center";
    const textWidth = ctx.measureText(segment.label).width;
    const leftEdge = centerX - textWidth / 2;
    const rightEdge = centerX + textWidth / 2;
    const isFirst = segment.start === 0;
    const isLast = segment.end === windowTimes.length - 1;
    if ((isFirst || isLast) && (leftEdge < padding.left || rightEdge > width - padding.right)) {
      ctx.textAlign = "start";
      return;
    }
    ctx.fillText(segment.label, centerX, padding.top + chartHeight * 0.55);
    ctx.textAlign = "start";
  });

  ctx.strokeStyle = themeVar("--chart-axis");
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.lineTo(width - padding.right, padding.top + chartHeight);
  ctx.stroke();

  const midnightIndices = getMidnightIndices(windowTimes);
  midnightIndices.forEach((index) => {
    const x = padding.left + (chartWidth * index) / (windowTimes.length - 1 || 1);
    ctx.strokeStyle = themeVar("--chart-midnight");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  });

  ctx.strokeStyle = themeVar("--chart-grid");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  const visibleSeries = instance.series.filter((metric) => isMetricVisible(metric.key));
  if (!visibleSeries.length) {
    drawEmptyOverlay(canvas, "Select metrics in the legend to show this chart.");
    return;
  }

  const baseLineWidth = 2.2;

  let drewLine = false;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const span = Math.max(1, state.windowSize - 1);
  visibleSeries.forEach((metric) => {
    const yPositions = instance.yValues.get(metric.key);
    if (!yPositions) return;
    const path = new Path2D();
    let started = false;
    for (let i = windowStart; i < windowEnd; i += 1) {
      const y = yPositions[i];
      if (y === null || y === undefined) {
        started = false;
        continue;
      }
      const x = padding.left + (chartWidth * (i - windowStart)) / span;
      if (!started) {
        path.moveTo(x, y);
        started = true;
      } else {
        path.lineTo(x, y);
      }
    }
    if (!started) return;
    drewLine = true;
    ctx.strokeStyle = metric.color;
    ctx.lineWidth = baseLineWidth;
    ctx.stroke(path);
  });

  let min = extent?.min ?? 0;
  let max = extent?.max ?? 1;
  if (instance.unit === "%") {
    min = 0;
    max = 100;
  }
  if (instance.unit === "in" || instance.unit === "mph") {
    min = 0;
  }
  if (instance.unit === "in") {
    max = Math.max(max, 0.05);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const axisPrecision = instance.unit === "in" ? 2 : 0;
  const minLabel = formatAxisValue(min, axisPrecision);
  const maxLabel = formatAxisValue(max, axisPrecision);
  ctx.fillStyle = "#56566d";
  ctx.font = "11px Space Grotesk";
  ctx.textAlign = "right";
  ctx.fillText(maxLabel, padding.left - 8, padding.top + 6);
  ctx.fillText(minLabel, padding.left - 8, padding.top + chartHeight);

  if (minLabel !== maxLabel) {
    for (let i = 1; i < 4; i += 1) {
      const label = max - ((max - min) / 4) * i;
      const y = padding.top + (chartHeight / 4) * i + 4;
      ctx.fillText(formatAxisValue(label, axisPrecision), padding.left - 8, y);
    }
  }
  ctx.textAlign = "start";

  let tickIndices = getTickIndicesByWidth(windowTimes, chartWidth, ctx);
  tickIndices = pruneTrailingOverlap(tickIndices, windowTimes, chartWidth, ctx, padding);
  tickIndices.forEach((index, position) => {
    const time = windowTimes[index];
    if (!time) return;
    const x = padding.left + (chartWidth * index) / (windowTimes.length - 1 || 1);
    const labelTime = time.toLocaleTimeString(undefined, { hour: "numeric" });
    if (position === tickIndices.length - 1) {
      ctx.textAlign = "right";
      ctx.fillText(labelTime, width - padding.right, height - 6);
      ctx.textAlign = "start";
    } else {
      ctx.fillText(labelTime, x - 8, height - 6);
    }
  });

  if (!drewLine) {
    return;
  }

  ctx.strokeStyle = themeVar("--chart-axis-strong");
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.stroke();
}

function drawEmptyOverlay(canvas, message) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height || canvas.height;
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeVar("--canvas");
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#56566d";
  ctx.font = "14px Space Grotesk";
  ctx.fillText(message, 24, height / 2);
}

function getMetricValue(entry, key) {
  return entry.metrics[key] ?? null;
}

function renderForecast(location) {
  forecastCardsEl.innerHTML = "";
  const daily = location.dailyForecast || [];
  daily.slice(0, 7).forEach((day) => {
    const card = document.createElement("div");
    card.className = "forecast-card";
    const high = formatTemp(day.high, day.unit);
    const low = formatTemp(day.low, day.unit);
    const rangeText = `High ${high} / Low ${low}`;
    card.innerHTML = `
      <h4>${day.name}</h4>
      <p>${rangeText}</p>
      <p>${day.blurb || "--"}</p>
    `;
    forecastCardsEl.appendChild(card);
  });
}

async function loadAll() {
  try {
    refreshBtn.classList.add("is-loading");
    state.data = await Promise.all(locations.map(loadLocation));
    const savedLocation = localStorage.getItem("selectedLocation");
    if (savedLocation) {
      const matchIndex = state.data.findIndex((loc) => loc.name === savedLocation);
      if (matchIndex >= 0) {
        state.selectedIndex = matchIndex;
      }
    }
    ensureMetricVisibility(state.data[state.selectedIndex]);
    renderLocations();
    updateSliders();
    renderView();
  } catch (err) {
    console.error(err);
  } finally {
    refreshBtn.classList.remove("is-loading");
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
  state.windowSize = Math.max(minWindow, Math.min(state.windowSize, maxWindow));
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

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem("theme", next);
  applyTheme(next);
  renderView();
});

forecastToggleEl.addEventListener("click", () => {
  const collapsed = !forecastSectionEl.classList.contains("is-collapsed");
  localStorage.setItem("forecastCollapsed", String(collapsed));
  applyForecastState(collapsed);
});

locationsToggleEl.addEventListener("click", () => {
  const collapsed = !locationsSectionEl.classList.contains("is-collapsed");
  localStorage.setItem("locationsCollapsed", String(collapsed));
  applyLocationsState(collapsed);
});


window.addEventListener("resize", () => {
  renderView();
  const collapsed = localStorage.getItem("locationsCollapsed") === "true";
  applyLocationsState(collapsed);
});

initTheme();
initForecastState();
initLocationsState();
loadAll();

setInterval(() => {
  loadAll();
}, 15 * 60 * 1000);
