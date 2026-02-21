// Server-side version - loads pre-fetched data from /data/locations.json

const state = {
  selectedIndex: 0,
  data: [],
  windowSize: 96,
  startIndex: 0,
  metricVisibility: {},
  lastChecked: null,
  serverFetchedAt: null
};

const NWS_STORAGE_VERSION = 1;
const NWS_STORAGE_VERSION_KEY = "nws_v";

const locationListEl = document.getElementById("locationList");
const locationNameEl = document.getElementById("locationName");
const locationMetaEl = document.getElementById("locationMeta");
const timelineTrackEl = document.getElementById("timelineTrack");
const timelineDaysEl = document.getElementById("timelineDays");
const timelineSelectionEl = document.getElementById("timelineSelection");
const markerStartEl = document.getElementById("markerStart");
const markerEndEl = document.getElementById("markerEnd");
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

function initStorage() {
  if (localStorage.getItem(NWS_STORAGE_VERSION_KEY) !== String(NWS_STORAGE_VERSION)) {
    ["theme", "selectedLocation", "forecastCollapsed", "locationsCollapsed"].forEach(
      k => localStorage.removeItem(k)
    );
    localStorage.setItem(NWS_STORAGE_VERSION_KEY, String(NWS_STORAGE_VERSION));
  }
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

function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height || canvas.height;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = themeVar("--canvas");
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
}

function normalizeExtent(min, max, unit) {
  if (unit === "%") {
    min = 0;
    max = 100;
  }
  if (unit === "in" || unit === "mph") {
    min = 0;
  }
  if (unit === "in") {
    max = Math.max(max, 0.05);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function drawGridLines(ctx, width, padding, chartHeight) {
  ctx.strokeStyle = themeVar("--chart-grid");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }
}

function drawMidnightLines(ctx, indices, count, padding, chartWidth, chartHeight) {
  indices.forEach((index) => {
    const x = padding.left + (chartWidth * index) / (count - 1 || 1);
    ctx.strokeStyle = themeVar("--chart-midnight");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  });
}

function drawYAxisLabels(ctx, min, max, precision, padding, chartHeight) {
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
}

function drawXAxisLabels(ctx, times, count, padding, chartWidth, width, height, windowOffset = 0, span = null) {
  let tickIndices = getTickIndicesByWidth(times, chartWidth, ctx);
  tickIndices = pruneTrailingOverlap(tickIndices, times, chartWidth, ctx, padding);
  const effectiveSpan = span !== null ? span : (count - 1 || 1);
  tickIndices.forEach((index, position) => {
    const time = times[index];
    if (!time) return;
    const x = padding.left + (chartWidth * (index + windowOffset)) / effectiveSpan;
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

function buildTooltipRows(series, index) {
  return series
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
    if (!time) {
      hideTooltip();
      return;
    }
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

    const rows = buildTooltipRows(payload.series, index);
    if (!rows) {
      hideTooltip();
      return;
    }
    showTooltip(`<div class="tooltip-time">${timeLabel}</div>${rows}`, event.clientX, event.clientY);
  });

  canvas.addEventListener("mouseleave", hideTooltip);
  canvas.addEventListener("blur", hideTooltip);

  canvas.addEventListener("touchstart", (event) => {
    if (interactionState.isInteracting) return;
    const touch = event.touches[0];
    if (!touch) return;
    const index = getIndexFromEventWindow(
      touch,
      canvas,
      payload.times.length,
      payload.padding,
      state.startIndex,
      state.windowSize
    );
    const time = payload.times[index];
    if (!time) {
      hideTooltip();
      return;
    }
    const timeLabel = time.toLocaleString(undefined, { weekday: "short", hour: "numeric" });
    if (payload.type === "single") {
      const value = payload.values[index];
      const display = formatTooltipValueWithUnit(value, payload.unit, payload.key);
      showTooltip(
        `<div class="tooltip-time">${timeLabel}</div><div>${payload.label}: ${display}</div>`,
        touch.clientX,
        touch.clientY
      );
      return;
    }
    const rows = buildTooltipRows(payload.series, index);
    if (!rows) {
      hideTooltip();
      return;
    }
    showTooltip(`<div class="tooltip-time">${timeLabel}</div>${rows}`, touch.clientX, touch.clientY);
  }, { passive: true });
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
  const minWindow = 1;
  const nextWindow = clampWindowSize(targetWindow, maxWindow, minWindow);
  let nextStart = state.startIndex;
  if (nextWindow >= maxWindow) {
    nextStart = 0;
  } else {
    const anchorIndex = state.startIndex + anchorRatio * state.windowSize;
    nextStart = clampStartIndex(anchorIndex - anchorRatio * nextWindow, nextWindow);
  }
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
      const zoomFactor = Math.exp(deltaScale * 0.002);
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

function formatTimestamp(value, prefix) {
  if (!value) return `${prefix} time unavailable`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return `${prefix} time unavailable`;
  return `${prefix} ${date.toLocaleString(undefined, { timeZoneName: "short" })}`;
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

function normalizeWindow(loc) {
  if (!loc) return;
  const maxWindow = Math.max(1, loc.hourly.length);
  state.windowSize = Math.max(1, Math.min(state.windowSize, maxWindow));
  state.startIndex = clampStartIndex(state.startIndex, state.windowSize);
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

function formatTemp(temp, unit) {
  if (temp === null || temp === undefined) return "--";
  const label = unit === "F" ? "°F" : unit;
  return `${temp}${label ? ` ${label}` : ""}`;
}

function formatPrecipProb(value) {
  if (value === null || value === undefined) return "--";
  const rounded = Math.round(value);
  return `${rounded}%`;
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
  localStorage.setItem("selectedLocation", state.data[index]?.name || "");
  renderLocations();
  ensureMetricVisibility(state.data[index]);
  updateSliders();
  renderView();
}

function renderView(options = {}) {
  const loc = state.data[state.selectedIndex];
  if (!loc) return;
  const { rebuild = true } = options;

  normalizeWindow(loc);

  const sliceStart = state.startIndex;
  const sliceEnd = sliceStart + state.windowSize;
  const windowData = loc.hourly.slice(sliceStart, sliceEnd);

  if (rebuild) {
    buildTimelineDays(loc.hourly.map((entry) => entry.time));
  }
  updateTimelineMarkers();
  if (rebuild) {
    requestAnimationFrame(adjustTimelineDayLabels);
  }

  locationNameEl.textContent = loc.name;
  const checkedLine = formatTimestamp(state.lastChecked, "Checked");
  const latestLine = formatTimestamp(loc.updated, "Latest");
  locationMetaEl.innerHTML = `
    <span class="meta-line">${checkedLine}</span>
    <span class="meta-line">${latestLine}</span>
  `;

  if (windowData.length) {
    timeRangeEl.textContent = formatTimeRange(windowData[0].time, windowData[windowData.length - 1].time);
  } else {
    timeRangeEl.textContent = "No data for this window";
  }

  renderCharts(loc, rebuild);
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
      lastNonNull: new Map(),
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

function buildOverlayPaths(instance, layout) {
  const { series, extent } = instance;
  const { padding, chartHeight } = layout;
  const { min, max } = normalizeExtent(extent?.min ?? 0, extent?.max ?? 1, instance.unit);

  instance.yValues.clear();
  instance.lastNonNull.clear();
  const range = max - min || 1;
  series.forEach((metric) => {
    const yPositions = metric.values.map((value) => {
      if (value === null || value === undefined) return null;
      const yRatio = (value - min) / range;
      return padding.top + chartHeight - yRatio * chartHeight;
    });
    instance.yValues.set(metric.key, yPositions);
    let lastIndex = -1;
    for (let i = yPositions.length - 1; i >= 0; i -= 1) {
      if (yPositions[i] !== null && yPositions[i] !== undefined) {
        lastIndex = i;
        break;
      }
    }
    instance.lastNonNull.set(metric.key, lastIndex);
  });
}

function drawOverlayInstance(instance) {
  const { canvas, times, extent } = instance;
  const { ctx, width, height } = setupCanvas(canvas);
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
  const clampStart = Math.max(0, windowStart);
  const clampEnd = Math.max(clampStart, Math.min(windowEnd, times.length));
  const windowTimes = times.slice(clampStart, clampEnd);
  const windowOffset = clampStart - windowStart;

  const segments = getDaySegments(windowTimes);
  const baseFontSize = 48;
  const scale = Math.min(1, width < 900 ? width / 900 : 1);
  const fontSize = Math.max(18, Math.round(baseFontSize * scale));
  segments.forEach((segment) => {
    if (!segment.label) return;
    const span = Math.max(1, state.windowSize - 1);
    const startX = padding.left + (chartWidth * (segment.start + windowOffset)) / span;
    const endX = padding.left + (chartWidth * (segment.end + windowOffset)) / span;
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
    const span = Math.max(1, state.windowSize - 1);
    const x = padding.left + (chartWidth * (index + windowOffset)) / span;
    ctx.strokeStyle = themeVar("--chart-midnight");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
  });

  drawGridLines(ctx, width, padding, chartHeight);

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
    const lastNon = instance.lastNonNull.get(metric.key) ?? -1;
    if (lastNon < 0) return;
    const dataSpan = Math.max(0, lastNon);
    let offset = 0;
    if (windowStart < 0 && windowEnd > dataSpan) {
      offset = windowStart + (span - dataSpan) / 2;
    } else if (windowStart < 0) {
      offset = windowStart;
    } else if (windowStart > dataSpan) {
      offset = windowStart - dataSpan;
    }
    const seriesClampStart = 0;
    const seriesClampEnd = Math.min(yPositions.length, lastNon + 1);
    const overscrollOffsetX = (-chartWidth * offset) / span;
    const path = new Path2D();
    let started = false;
    let points = 0;
    let lastPoint = null;
    for (let i = seriesClampStart; i < seriesClampEnd; i += 1) {
      const y = yPositions[i];
      if (y === null || y === undefined) {
        started = false;
        continue;
      }
      const x = padding.left + overscrollOffsetX + (chartWidth * (i - windowStart)) / span;
      if (!started) {
        path.moveTo(x, y);
        started = true;
      } else {
        path.lineTo(x, y);
      }
      points += 1;
      lastPoint = { x, y };
    }
    if (!started) return;
    drewLine = true;
    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();
    ctx.strokeStyle = metric.color;
    ctx.lineWidth = baseLineWidth;
    ctx.stroke(path);
    ctx.restore();
    if (points === 1 && lastPoint) {
      ctx.fillStyle = metric.color;
      ctx.beginPath();
      ctx.arc(lastPoint.x, lastPoint.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const { min, max } = normalizeExtent(extent?.min ?? 0, extent?.max ?? 1, instance.unit);
  const axisPrecision = instance.unit === "in" ? 2 : 0;

  drawYAxisLabels(ctx, min, max, axisPrecision, padding, chartHeight);
  drawXAxisLabels(ctx, windowTimes, windowTimes.length, padding, chartWidth, width, height, windowOffset, span);

  if (drewLine) {
    ctx.strokeStyle = themeVar("--chart-axis-strong");
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.stroke();
  }
}

function drawEmptyOverlay(canvas, message) {
  const { ctx, height } = setupCanvas(canvas);
  ctx.fillStyle = "#56566d";
  ctx.font = "14px Space Grotesk";
  ctx.fillText(message, 24, height / 2);
}

function renderForecast(location) {
  forecastCardsEl.innerHTML = "";
  const daily = location.dailyForecast || [];
  daily.slice(0, 7).forEach((day) => {
    const card = document.createElement("div");
    card.className = "forecast-card";
    const high = formatTemp(day.high, day.unit);
    const low = formatTemp(day.low, day.unit);
    const probText = formatPrecipProb(day.precipProb);
    const rangeText = `↑ ${high} / ↓ ${low} / ${probText} ☂`;
    card.innerHTML = `
      <h4>${day.name}</h4>
      <p>${rangeText}</p>
      <p>${day.blurb || "--"}</p>
    `;
    forecastCardsEl.appendChild(card);
  });
}

// Convert server JSON data format to client format
function processServerData(serverData) {
  return serverData.locations.map(loc => {
    // Convert hourly time strings back to Date objects
    const hourly = loc.hourly.map(entry => ({
      ...entry,
      time: new Date(entry.time)
    }));

    return {
      ...loc,
      hourly
    };
  });
}

async function loadAll() {
  try {
    state.lastChecked = new Date();
    const response = await fetch("data/locations.json");
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }
    const serverData = await response.json();
    state.serverFetchedAt = serverData.fetchedAt;
    state.data = processServerData(serverData);

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
    console.error("Error loading data:", err);
    locationNameEl.textContent = "Error loading data";
    locationMetaEl.innerHTML = `<span class="meta-line">Please wait for server to fetch data...</span>`;
  }
}

function updateSliders() {
  const loc = state.data[state.selectedIndex];
  if (!loc) return;
  const maxWindow = Math.max(1, loc.hourly.length);
  const minWindow = 1;
  state.windowSize = Math.max(minWindow, Math.min(state.windowSize, maxWindow));
  state.startIndex = clampStartIndex(state.startIndex, state.windowSize);
  updateTimelineMarkers();
}

function buildTimelineDays(times) {
  if (!timelineDaysEl) return;
  timelineDaysEl.innerHTML = "";
  if (!times || !times.length) return;

  const segments = [];
  let currentKey = "";
  let current = null;
  times.forEach((time) => {
    if (!time) return;
    const key = `${time.getFullYear()}-${time.getMonth()}-${time.getDate()}`;
    if (key !== currentKey) {
      currentKey = key;
      current = {
        key,
        date: new Date(time),
        hours: 0
      };
      segments.push(current);
    }
    current.hours += 1;
  });

  const totalHours = segments.reduce((sum, segment) => sum + segment.hours, 0) || 1;
  segments.forEach((segment, index) => {
    const dayEl = document.createElement("div");
    dayEl.className = "timeline-day";
    const label = segment.date.toLocaleDateString(undefined, { weekday: "short" });
    const labelEl = document.createElement("span");
    labelEl.className = "timeline-day-label";
    labelEl.textContent = label;
    dayEl.appendChild(labelEl);
    dayEl.style.width = `${(segment.hours / totalHours) * 100}%`;
    dayEl.title = `${label} (${segment.hours}h)`;
    if (index === segments.length - 1) {
      dayEl.style.borderRight = "none";
    }
    timelineDaysEl.appendChild(dayEl);
  });

  requestAnimationFrame(adjustTimelineDayLabels);
}

function adjustTimelineDayLabels() {
  if (!timelineTrackEl || !timelineDaysEl) return;
  const dayEls = Array.from(timelineDaysEl.querySelectorAll(".timeline-day"));
  if (!dayEls.length) return;
  dayEls.forEach((day) => {
    const label = day.querySelector(".timeline-day-label");
    if (label) label.style.opacity = "1";
  });

  const trackRect = timelineTrackEl.getBoundingClientRect();
  const first = dayEls[0];
  const last = dayEls[dayEls.length - 1];
  const check = (dayEl) => {
    const label = dayEl.querySelector(".timeline-day-label");
    if (!label) return;
    const labelRect = label.getBoundingClientRect();
    if (labelRect.left < trackRect.left + 6 || labelRect.right > trackRect.right - 6) {
      label.style.opacity = "0";
    }
  };
  check(first);
  if (last !== first) check(last);
}

function updateTimelineMarkers() {
  const loc = state.data[state.selectedIndex];
  if (!loc || !timelineTrackEl) return;
  const count = loc.hourly.length;
  if (count <= 1) return;
  const rect = timelineTrackEl.getBoundingClientRect();
  const width = rect.width;
  if (!width) return;
  const maxIndex = count - 1;
  const safeMax = maxIndex || 1;
  const windowSpan = Math.max(1, state.windowSize - 1);
  const selectionWidth = (windowSpan / safeMax) * width;
  let startX = (state.startIndex / safeMax) * width;
  let endX = startX + selectionWidth;
  if (selectionWidth >= width) {
    startX = 0;
    endX = width;
  } else {
    if (startX < 0) {
      startX = 0;
      endX = selectionWidth;
    }
    if (endX > width) {
      endX = width;
      startX = width - selectionWidth;
    }
  }

  const markerWidth = markerStartEl?.offsetWidth || markerEndEl?.offsetWidth || 10;
  const inset = 6;
  const endInset = inset + 2;
  const startLeft = Math.min(Math.max(startX + inset, inset), width - markerWidth - inset);
  const endLeft = Math.min(Math.max(endX - markerWidth - endInset, inset), width - markerWidth - endInset);
  if (markerStartEl) {
    markerStartEl.style.left = `${startLeft}px`;
  }
  if (markerEndEl) {
    markerEndEl.style.left = `${endLeft}px`;
  }
  if (timelineSelectionEl) {
    const left = Math.min(startLeft + markerWidth, endLeft);
    const right = Math.max(startLeft + markerWidth, endLeft);
    timelineSelectionEl.style.left = `${left}px`;
    timelineSelectionEl.style.width = `${Math.max(4, right - left)}px`;
  }
}

function attachTimelineDrag(marker, type) {
  if (!marker || !timelineTrackEl) return;
  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    marker.setPointerCapture(event.pointerId);
    interactionState.isInteracting = true;
    hideTooltip();

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const loc = state.data[state.selectedIndex];
      if (!loc) return;
      const rect = timelineTrackEl.getBoundingClientRect();
      const width = rect.width || 1;
      const x = Math.min(Math.max(moveEvent.clientX - rect.left, 0), width);
      const maxIndex = loc.hourly.length - 1;
      const nextIndex = Math.round((x / width) * maxIndex);

      const currentEnd = state.startIndex + state.windowSize - 1;
      if (type === "start") {
        const clampedStart = Math.max(0, Math.min(nextIndex, currentEnd - 1));
        state.startIndex = clampedStart;
        state.windowSize = currentEnd - state.startIndex + 1;
      } else {
        const clampedEnd = Math.min(maxIndex, Math.max(nextIndex, state.startIndex + 1));
        state.windowSize = clampedEnd - state.startIndex + 1;
      }
      updateSliders();
      scheduleInteractionRender();
    };

    const onUp = (upEvent) => {
      marker.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      interactionState.isInteracting = false;
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { once: true });
  };

  marker.addEventListener("pointerdown", onPointerDown);
}

function attachTimelineSelectionDrag() {
  if (!timelineSelectionEl || !timelineTrackEl) return;
  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    timelineSelectionEl.setPointerCapture(event.pointerId);
    interactionState.isInteracting = true;
    hideTooltip();

    const loc = state.data[state.selectedIndex];
    if (!loc) return;
    const rect = timelineTrackEl.getBoundingClientRect();
    const width = rect.width || 1;
    const maxIndex = loc.hourly.length - 1;
    const startIndex = state.startIndex;
    const endIndex = state.startIndex + state.windowSize - 1;
    const selectionSpan = endIndex - startIndex;
    const startX = (startIndex / maxIndex) * width;
    const offset = Math.min(Math.max(event.clientX - rect.left - startX, 0), width);

    const onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const x = Math.min(Math.max(moveEvent.clientX - rect.left - offset, 0), width);
      const nextStart = Math.round((x / width) * maxIndex);
      const clampedStart = Math.max(0, Math.min(nextStart, maxIndex - selectionSpan));
      state.startIndex = clampedStart;
      state.windowSize = selectionSpan + 1;
      updateSliders();
      scheduleInteractionRender();
    };

    const onUp = (upEvent) => {
      timelineSelectionEl.releasePointerCapture(upEvent.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      interactionState.isInteracting = false;
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { once: true });
  };

  timelineSelectionEl.addEventListener("pointerdown", onPointerDown);
}

function unitSortRank(unit) {
  const normalized = (unit || "").toLowerCase();
  if (normalized === "%") return 0;
  if (normalized === "in") return 1;
  if (normalized === "mph") return 2;
  if (normalized === "°f") return 3;
  return 10;
}


attachTimelineDrag(markerStartEl, "start");
attachTimelineDrag(markerEndEl, "end");
attachTimelineSelectionDrag();

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
  renderView({ rebuild: true });
  requestAnimationFrame(adjustTimelineDayLabels);
  const collapsed = localStorage.getItem("locationsCollapsed") === "true";
  applyLocationsState(collapsed);
});

initStorage();
initTheme();
initForecastState();
initLocationsState();
loadAll();

// Re-render after fonts load to fix canvas text rendering
document.fonts.ready.then(() => {
  if (state.data.length) {
    renderView({ rebuild: true });
  }
});

// Poll for server updates every 5 minutes
setInterval(() => {
  loadAll();
}, 5 * 60 * 1000);
