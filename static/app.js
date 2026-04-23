(function () {
  const initialData = JSON.parse(document.getElementById("initial-snapshot-data").textContent);
  const locationPresets = JSON.parse(document.getElementById("location-presets-data").textContent);
  const form = document.getElementById("simulation-form");
  const roomWorkspace = document.querySelector(".room-workspace");
  const updateStatus = document.getElementById("update-status");
  const sunriseMarker = document.getElementById("sunrise-marker");
  const sunsetMarker = document.getElementById("sunset-marker");
  const timeScrubberReference = document.getElementById("time-scrubber-reference");
  const setNowButton = document.getElementById("set-now-button");
  const dailyExposureTooltip = document.getElementById("daily-exposure-tooltip");
  const longRangeExposureTooltip = document.getElementById("long-range-exposure-tooltip");
  const saveBaselineButton = document.getElementById("save-baseline-button");
  const clearBaselineButton = document.getElementById("clear-baseline-button");
  const baselineEmptyState = document.getElementById("baseline-empty-state");
  const baselineDetails = document.getElementById("baseline-details");
  const baselineComparisonPanel = document.getElementById("baseline-comparison-panel");
  const windowEditHint = document.getElementById("window-edit-hint");

  const locationPresetInput = document.getElementById("location-preset-input");
  const windowFacingInput = document.getElementById("window-facing-input");
  const locationChipButtons = document.querySelectorAll("[data-location-preset]");
  const windowFacingButtons = document.querySelectorAll("[data-window-facing]");
  const resultTabButtons = document.querySelectorAll("[data-result-tab]");
  const resultPanels = document.querySelectorAll("[data-result-panel]");
  const periodViewButtons = document.querySelectorAll("[data-period-view]");

  const customLocationPanel = document.getElementById("custom-location-panel");
  const customLocationToggle = document.getElementById("custom-location-toggle");
  const latitudeInput = document.getElementById("latitude-input");
  const longitudeInput = document.getElementById("longitude-input");
  const timezoneInput = form.querySelector('input[name="timezone_name"]');
  const locationNameInput = form.querySelector('input[name="location_name"]');
  const yearInput = document.getElementById("year-input");

  const selectedDateInput = document.getElementById("selected-date-input");
  const selectedTimeInput = document.getElementById("selected-time-input");
  const daySlider = document.getElementById("day-of-year-slider");
  const timeSlider = document.getElementById("time-of-day-slider");
  const dayReadout = document.getElementById("day-of-year-readout");
  const timeReadout = document.getElementById("time-of-day-readout");
  const roomWidthInput = form.querySelector('input[name="room_width"]');
  const roomDepthInput = form.querySelector('input[name="room_depth"]');
  const windowWidthInput = form.querySelector('input[name="window_width"]');
  const windowHeightInput = form.querySelector('input[name="window_height"]');
  const windowSpanCenterInput = form.querySelector('input[name="window_span_center"]');
  const windowSillHeightInput = form.querySelector('input[name="window_sill_height"]');
  const windowsJsonInput = form.querySelector('textarea[name="windows_json"]');
  const windowRowsBuilder = document.getElementById("window-rows-builder");
  const addWindowRowButton = document.getElementById("add-window-row-button");
  const removeWindowButton = document.getElementById("remove-window-button");
  const selectedWindowWallSelect = document.getElementById("selected-window-wall");
  const selectedWindowFacingCopy = document.getElementById("selected-window-facing-copy");
  const windowEditorTitle = document.getElementById("window-editor-title");
  const windowEditorCopy = document.getElementById("window-editor-copy");

  const mapElement = document.getElementById("location-map");
  let map = null;
  let marker = null;
  let latestRequestId = 0;
  let activeSnapshotController = null;
  let latestLongRangeRequestId = 0;
  let activeLongRangeController = null;
  let activeResultTab = "current";
  let activeLongRangePeriod = "year";
  let longRangePayload = null;
  let longRangeQuery = "";
  let currentPayload = initialData;
  let baselinePayload = null;
  const defaultUpdateMessage = "Map is up to date.";
  const baselineStorageKey = "sunlight-house-baseline";
  let activeWindowDrag = null;
  let activeWindowResize = null;
  let suppressWindowBuilderSync = false;
  let activeWindowIndex = 0;
  let windowRows = [];

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function dayOfYearMax(year) {
    return isLeapYear(year) ? 366 : 365;
  }

  function dayOfYearFromDateString(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
  }

  function dateStringFromDayOfYear(year, dayOfYear) {
    const date = new Date(year, 0, dayOfYear);
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateReadout(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function formatTimeReadout(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function roundedNowInTimezone(timezoneName) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezoneName,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date())
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    const roundedMinute = Math.floor(parseInt(parts.minute, 10) / 15) * 15;
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${String(roundedMinute).padStart(2, "0")}`,
    };
  }

  function currentQueryString() {
    syncWindowsJsonFromEditor();
    return new URLSearchParams(new FormData(form)).toString();
  }

  function selectedYear() {
    const dateYear = parseInt(selectedDateInput.value.slice(0, 4), 10);
    return Number.isFinite(dateYear) ? dateYear : parseInt(yearInput.value, 10);
  }

  function syncSlidersFromInputs() {
    const year = selectedYear();
    yearInput.value = String(year);
    daySlider.max = String(dayOfYearMax(year));
    const boundedDay = Math.min(dayOfYearFromDateString(selectedDateInput.value), dayOfYearMax(year));
    daySlider.value = String(boundedDay);

    const [hours, minutes] = selectedTimeInput.value.split(":").map(Number);
    timeSlider.value = String(hours * 60 + minutes);

    dayReadout.textContent = formatDateReadout(selectedDateInput.value);
    timeReadout.textContent = formatTimeReadout(parseInt(timeSlider.value, 10));
  }

  function syncInputsFromSliders() {
    const year = parseInt(yearInput.value, 10);
    const boundedDay = Math.min(parseInt(daySlider.value, 10), dayOfYearMax(year));
    selectedDateInput.value = dateStringFromDayOfYear(year, boundedDay);
    selectedTimeInput.value = formatTimeReadout(parseInt(timeSlider.value, 10));

    dayReadout.textContent = formatDateReadout(selectedDateInput.value);
    timeReadout.textContent = selectedTimeInput.value;
  }

  function snapshotStateLabel(state) {
    if (state === "floor_hit") {
      return "Sun reaches floor";
    }
    if (state === "through_window_no_floor_hit") {
      return "Sun enters window but misses floor";
    }
    return "Sun does not enter this window";
  }

  function snapshotStateClass(state) {
    if (state === "floor_hit") {
      return "status-chip status-chip-active";
    }
    if (state === "through_window_no_floor_hit") {
      return "status-chip status-chip-mid";
    }
    return "status-chip status-chip-off";
  }

  function debounce(fn, waitMs) {
    let timeoutId = null;
    return function debounced(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), waitMs);
    };
  }

  function setActiveButtons(buttons, dataKey, value) {
    buttons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset[dataKey] === value);
    });
  }

  function ensureMap() {
    if (map || !mapElement) {
      return;
    }

    map = L.map(mapElement, { zoomControl: true }).setView(
      [parseFloat(latitudeInput.value), parseFloat(longitudeInput.value)],
      5
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    marker = L.marker([parseFloat(latitudeInput.value), parseFloat(longitudeInput.value)], {
      draggable: true,
    }).addTo(map);

    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      setLocationPreset("custom", { applyPreset: false, openPanel: true, refresh: false });
      latitudeInput.value = lat.toFixed(4);
      longitudeInput.value = lng.toFixed(4);
      scheduleRefresh();
    });

    map.on("click", (event) => {
      setLocationPreset("custom", { applyPreset: false, openPanel: true, refresh: false });
      marker.setLatLng(event.latlng);
      latitudeInput.value = event.latlng.lat.toFixed(4);
      longitudeInput.value = event.latlng.lng.toFixed(4);
      scheduleRefresh();
    });
  }

  function invalidateMapSoon() {
    if (!map) {
      return;
    }
    window.requestAnimationFrame(() => map.invalidateSize());
  }

  function applyLocationPreset() {
    const preset = locationPresets[locationPresetInput.value];
    if (!preset) {
      return;
    }
    locationNameInput.value = preset.name;
    latitudeInput.value = String(preset.latitude);
    longitudeInput.value = String(preset.longitude);
    timezoneInput.value = preset.timezone_name;

    if (marker && map) {
      marker.setLatLng([preset.latitude, preset.longitude]);
      map.setView([preset.latitude, preset.longitude], 5);
    }
    updateTimeScrubberReference(preset.timezone_name);
  }

  function setLocationPreset(presetKey, options = {}) {
    const { applyPreset = true, openPanel = false, refresh = true } = options;
    locationPresetInput.value = presetKey;
    setActiveButtons(locationChipButtons, "locationPreset", presetKey);

    if (presetKey === "custom") {
      locationNameInput.value = "Custom location";
      customLocationPanel.open = true;
      ensureMap();
      invalidateMapSoon();
    } else {
      if (applyPreset) {
        applyLocationPreset();
      }
      if (!openPanel) {
        customLocationPanel.open = false;
      }
    }

    if (refresh) {
      scheduleRefresh();
    }
  }

  function setWindowFacing(facing, refresh = true) {
    windowFacingInput.value = facing;
    setActiveButtons(windowFacingButtons, "windowFacing", facing);
    renderWindowEditor();
    if (refresh) {
      scheduleRefresh();
    }
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  }

  function setHtml(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.innerHTML = value;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function updateSummaryDom(summary) {
    if (!summary) {
      return;
    }
    const summaryCard = document.querySelector(".summary-card");
    if (summaryCard) {
      summaryCard.className = `summary-card summary-card-${summary.tone}`;
    }
    setText("sun-summary-headline", summary.headline);
    setText("sun-summary-tone", summary.tone.replace(/_/g, " "));
    setText("sun-summary-supporting", summary.supporting_text);
    setText("sun-summary-moment", summary.moment_text);
  }

  function setPendingState(isPending) {
    roomWorkspace.classList.toggle("loading-state", isPending);
  }

  function parseFiniteNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function currentWindowMetrics(payload = currentPayload) {
    const payloadWindow = payload.windows[Math.min(activeWindowIndex, payload.windows.length - 1)] || payload.windows[0];
    const segment = payloadWindow.wall_segment_xy;
    const centerFromSegment = (Math.abs(segment[1][0] - segment[0][0]) > 0.0001)
      ? (segment[0][0] + segment[1][0]) / 2
      : (segment[0][1] + segment[1][1]) / 2;
    const widthFromSegment = Math.abs(segment[1][0] - segment[0][0]) || Math.abs(segment[1][1] - segment[0][1]);
    if (payload.window_override_active && windowRows.length > 1) {
      return {
        center: centerFromSegment,
        width: widthFromSegment,
      };
    }
    return {
      center: parseFiniteNumber(windowSpanCenterInput.value) ?? centerFromSegment,
      width: parseFiniteNumber(windowWidthInput.value) ?? widthFromSegment,
    };
  }

  function selectedPayloadWindow(payload = currentPayload) {
    return payload.windows[Math.min(activeWindowIndex, payload.windows.length - 1)] || payload.windows[0];
  }

  function selectedPayloadWall(payload = currentPayload) {
    return selectedPayloadWindow(payload)?.wall || "north";
  }

  function updateWindowGeometryReadout(centerValue, widthValue) {
    setText("window-centre-readout", `Window centre: ${centerValue.toFixed(1)} m from left`);
    setText("window-width-readout", `Window width: ${widthValue.toFixed(1)} m`);
  }

  function compassLabelForDegrees(degrees) {
    const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const normalized = ((degrees % 360) + 360) % 360;
    const index = Math.round(normalized / 45) % labels.length;
    return labels[index];
  }

  function roomEdgeLabels(windowFacingLabel) {
    const baseAngles = [0, 90, 180, 270];
    const facingAngles = {
      N: 0,
      NE: 45,
      E: 90,
      SE: 135,
      S: 180,
      SW: 225,
      W: 270,
      NW: 315,
    };
    const baseWorldAngle = facingAngles[windowFacingLabel] ?? 0;
    return baseAngles.map((angle) => `${angle}\u00b0 / ${compassLabelForDegrees(baseWorldAngle + angle)}`);
  }

  function parseWindowsJsonValue(rawValue) {
    const text = (rawValue || "").trim();
    if (!text) {
      return [];
    }
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
    } catch (error) {
      return [];
    }
  }

  function wallDisplayName(wall) {
    return {
      north: "Front wall",
      east: "Right wall",
      south: "Back wall",
      west: "Left wall",
    }[wall] || "Front wall";
  }

  function facingDegrees(label) {
    return {
      N: 0,
      NE: 45,
      E: 90,
      SE: 135,
      S: 180,
      SW: 225,
      W: 270,
      NW: 315,
    }[label] ?? 0;
  }

  function wallFacingLabel(wall) {
    const offsets = {
      north: 0,
      east: 90,
      south: 180,
      west: 270,
    };
    return compassLabelForDegrees(facingDegrees(windowFacingInput.value) + (offsets[wall] ?? 0));
  }

  function windowAccentColor(index) {
    return ["#c86530", "#2b627a", "#6b8e23", "#a0522d"][index % 4];
  }

  function windowRowFromLegacyInputs() {
    return {
      name: "window_1",
      wall: "north",
      span_center: windowSpanCenterInput.value,
      sill_height: windowSillHeightInput.value,
      width: windowWidthInput.value,
      height: windowHeightInput.value,
    };
  }

  function normalizeWindowRow(row, index) {
    return {
      name: (row.name || `window_${index + 1}`).toString(),
      wall: index === 0 ? "north" : (row.wall || "east").toString().toLowerCase(),
      span_center: row.span_center ?? "",
      sill_height: row.sill_height ?? "",
      width: row.width ?? "",
      height: row.height ?? "",
    };
  }

  function persistActiveWindowEditor() {
    if (!windowRows.length) {
      windowRows = [windowRowFromLegacyInputs()];
    }
    const activeRow = windowRows[activeWindowIndex] || windowRows[0];
    activeRow.wall = activeWindowIndex === 0 ? "north" : selectedWindowWallSelect.value;
    activeRow.span_center = windowSpanCenterInput.value;
    activeRow.sill_height = windowSillHeightInput.value;
    activeRow.width = windowWidthInput.value;
    activeRow.height = windowHeightInput.value;
  }

  function serializableWindowRows() {
    return windowRows.map((row, index) => normalizeWindowRow(row, index)).map((row) => {
      const spanCenter = parseFiniteNumber(row.span_center);
      const sillHeight = parseFiniteNumber(row.sill_height);
      const width = parseFiniteNumber(row.width);
      const height = parseFiniteNumber(row.height);
      if (spanCenter === null || sillHeight === null || width === null || height === null) {
        return null;
      }
      return {
        name: row.name,
        wall: row.wall,
        span_center: spanCenter,
        sill_height: sillHeight,
        width,
        height,
      };
    });
  }

  function windowsAreComplete() {
    return serializableWindowRows().every(Boolean);
  }

  function syncWindowsJsonFromEditor() {
    if (!windowsJsonInput || suppressWindowBuilderSync) {
      return windowsAreComplete();
    }
    persistActiveWindowEditor();
    const rows = serializableWindowRows();
    if (!rows.every(Boolean)) {
      return false;
    }
    suppressWindowBuilderSync = true;
    windowsJsonInput.value = rows.length > 1 ? JSON.stringify(rows, null, 2) : "";
    suppressWindowBuilderSync = false;
    return true;
  }

  function renderWindowSelector() {
    if (!windowRowsBuilder) {
      return;
    }
    windowRowsBuilder.innerHTML = "";
    windowRowsBuilder.hidden = windowRows.length <= 1;
    if (windowRows.length <= 1) {
      return;
    }
    windowRows.forEach((row, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chip-button chip-button-soft${index === activeWindowIndex ? " is-active" : ""}`;
      button.textContent = `Window ${index + 1}`;
      button.addEventListener("click", () => {
        persistActiveWindowEditor();
        activeWindowIndex = index;
        renderWindowEditor();
      });
      windowRowsBuilder.appendChild(button);
    });
  }

  function renderWindowEditor() {
    if (!windowRows.length) {
      windowRows = [windowRowFromLegacyInputs()];
    }
    activeWindowIndex = clamp(activeWindowIndex, 0, windowRows.length - 1);
    const activeRow = normalizeWindowRow(windowRows[activeWindowIndex], activeWindowIndex);
    windowRows[activeWindowIndex] = activeRow;

    if (windowEditorTitle) {
      windowEditorTitle.textContent = windowRows.length === 1 ? "Window" : `Window ${activeWindowIndex + 1}`;
    }
    if (windowEditorCopy) {
      windowEditorCopy.textContent = activeWindowIndex === 0
        ? "Window 1 sits on the front wall and defines the room orientation. Add another window only when the room needs one."
        : "Additional windows stay on rectangular room walls. Their compass direction is derived from Window 1.";
    }
    if (selectedWindowWallSelect) {
      selectedWindowWallSelect.value = activeRow.wall;
      selectedWindowWallSelect.disabled = activeWindowIndex === 0;
    }
    windowSpanCenterInput.value = activeRow.span_center;
    windowSillHeightInput.value = activeRow.sill_height;
    windowWidthInput.value = activeRow.width;
    windowHeightInput.value = activeRow.height;

    if (selectedWindowFacingCopy) {
      selectedWindowFacingCopy.textContent = `${wallDisplayName(activeRow.wall)}. This window faces ${wallFacingLabel(activeRow.wall)}.`;
    }
    if (removeWindowButton) {
      removeWindowButton.hidden = activeWindowIndex === 0 || windowRows.length <= 1;
    }
    renderWindowSelector();
    if (currentPayload && currentPayload.windows && currentPayload.windows.length === windowRows.length) {
      updateSnapshotDom(currentPayload);
    }
  }

  function renderWindowBuilderFromRows(rows) {
    windowRows = (rows.length ? rows : [windowRowFromLegacyInputs()]).map(normalizeWindowRow);
    activeWindowIndex = 0;
    renderWindowEditor();
    syncWindowsJsonFromEditor();
  }

  function renderWindowBuilderFromTextarea() {
    const rows = parseWindowsJsonValue(windowsJsonInput ? windowsJsonInput.value : "");
    renderWindowBuilderFromRows(rows);
  }

  function addEmptyWindowRow() {
    persistActiveWindowEditor();
    const nextIndex = windowRows.length;
    const wallCycle = ["east", "south", "west"];
    const wall = wallCycle[(nextIndex - 1) % wallCycle.length];
    const roomSpan = wall === "east" || wall === "west"
      ? parseFiniteNumber(roomDepthInput.value)
      : parseFiniteNumber(roomWidthInput.value);
    windowRows.push(normalizeWindowRow({
      name: `window_${nextIndex + 1}`,
      wall,
      span_center: roomSpan ? (roomSpan / 2).toFixed(1) : windowSpanCenterInput.value,
      sill_height: windowSillHeightInput.value,
      width: windowWidthInput.value,
      height: windowHeightInput.value,
    }, nextIndex));
    activeWindowIndex = nextIndex;
    renderWindowEditor();
    syncWindowsJsonFromEditor();
  }

  function localMinutesFromIso(isoString) {
    if (!isoString) {
      return null;
    }
    const hours = parseInt(isoString.slice(11, 13), 10);
    const minutes = parseInt(isoString.slice(14, 16), 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return null;
    }
    return hours * 60 + minutes;
  }

  function formatIsoLocalTime(isoString) {
    const totalMinutes = localMinutesFromIso(isoString);
    return totalMinutes === null ? "\u2014" : formatTimeReadout(totalMinutes);
  }

  function setDaylightMarker(element, isoString, label) {
    if (!element) {
      return;
    }
    const totalMinutes = localMinutesFromIso(isoString);
    if (totalMinutes === null) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.textContent = `${label} ${formatIsoLocalTime(isoString)}`;
    element.style.left = `${(totalMinutes / 1440) * 100}%`;
  }

  function createDimensionGuides(width, depth) {
    const widthLineY = -0.42;
    const depthLineX = width + 0.42;
    return `
      <g stroke="rgba(95,109,119,0.55)" stroke-width="0.03" fill="none">
        <line x1="0" y1="${widthLineY}" x2="${width}" y2="${widthLineY}"></line>
        <line x1="0" y1="${widthLineY - 0.08}" x2="0" y2="${widthLineY + 0.08}"></line>
        <line x1="${width}" y1="${widthLineY - 0.08}" x2="${width}" y2="${widthLineY + 0.08}"></line>
        <line x1="${depthLineX}" y1="0" x2="${depthLineX}" y2="${depth}"></line>
        <line x1="${depthLineX - 0.08}" y1="0" x2="${depthLineX + 0.08}" y2="0"></line>
        <line x1="${depthLineX - 0.08}" y1="${depth}" x2="${depthLineX + 0.08}" y2="${depth}"></line>
      </g>
      <text x="${width / 2}" y="${widthLineY - 0.1}" font-size="0.18" text-anchor="middle" fill="#616a68">${width.toFixed(1)} m wide</text>
      <text x="${depthLineX + 0.12}" y="${depth / 2}" font-size="0.18" text-anchor="middle" fill="#616a68" transform="rotate(90 ${depthLineX + 0.12} ${depth / 2})">${depth.toFixed(1)} m deep</text>
    `;
  }

  function exposureGridStats(grid) {
    const values = grid.values.flat();
    const sunlitValues = values.filter((value) => value > 0);
    const avgSunlitHours = sunlitValues.length
      ? sunlitValues.reduce((sum, value) => sum + value, 0) / sunlitValues.length
      : 0;
    return {
      peakHours: grid.peak_hours,
      sunlitFraction: grid.sunlit_fraction,
      avgSunlitHours,
    };
  }

  function hideExposureTooltip(tooltip) {
    if (!tooltip) {
      return;
    }
    tooltip.hidden = true;
  }

  function showExposureTooltip(containerId, tooltip, message, event) {
    if (!tooltip) {
      return;
    }
    const containerRect = document.getElementById(containerId).getBoundingClientRect();
    const offsetX = event.clientX - containerRect.left;
    const offsetY = event.clientY - containerRect.top;
    const tooltipWidth = 180;
    const left = Math.min(Math.max(12, offsetX + 14), Math.max(12, containerRect.width - tooltipWidth - 12));
    const top = Math.max(12, offsetY - 52);
    tooltip.textContent = message;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.hidden = false;
  }

  function updateExposureLegendAndStats(grid, prefix) {
    const stats = exposureGridStats(grid);
    setText(`${prefix}-legend-max-hours`, `${stats.peakHours.toFixed(1)} h`);
    setText(`${prefix}-stat-peak-hours`, `${stats.peakHours.toFixed(1)} h`);
    setText(`${prefix}-stat-sunlit-fraction`, `${Math.round(stats.sunlitFraction * 100)}%`);
    setText(`${prefix}-stat-avg-sunlit-hours`, `${stats.avgSunlitHours.toFixed(1)} h`);
  }

  function setUpdateStatus(message, state = "idle") {
    if (!updateStatus) {
      return;
    }
    updateStatus.textContent = message;
    updateStatus.dataset.state = state;
  }

  function formatSelectedMoment(payload) {
    return new Date(payload.selected_moment).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: payload.location.timezone_name,
      timeZoneName: "short",
    });
  }

  function formatNumericDelta(delta, suffix = "") {
    if (Math.abs(delta) < 0.05) {
      return "No change";
    }
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta.toFixed(1)}${suffix}`;
  }

  function selectedMomentDeltaLabel(baselineMoment, currentMoment) {
    const deltaMs = currentMoment.getTime() - baselineMoment.getTime();
    if (Math.abs(deltaMs) < 60000) {
      return "No change";
    }
    const later = deltaMs > 0;
    const totalMinutes = Math.round(Math.abs(deltaMs) / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) {
      parts.push(`${days} day${days === 1 ? "" : "s"}`);
    }
    if (hours) {
      parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
    }
    if (minutes || parts.length === 0) {
      parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    }
    return `${parts.join(" ")} ${later ? "later" : "earlier"}`;
  }

  function setBaselineMetric(idPrefix, baselineText, currentText, deltaText, deltaClass = "baseline-delta-neutral") {
    setText(`${idPrefix}-baseline`, baselineText);
    setText(`${idPrefix}-current`, currentText);
    setText(`${idPrefix}-delta`, deltaText);
    const deltaElement = document.getElementById(`${idPrefix}-delta`);
    if (deltaElement) {
      deltaElement.classList.remove("baseline-delta-positive", "baseline-delta-negative", "baseline-delta-neutral");
      deltaElement.classList.add(deltaClass);
    }
  }

  function deltaClassForValue(delta) {
    if (Math.abs(delta) < 0.0005) {
      return "baseline-delta-neutral";
    }
    return delta > 0 ? "baseline-delta-positive" : "baseline-delta-negative";
  }

  function readStoredBaseline() {
    try {
      const raw = window.localStorage.getItem(baselineStorageKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function writeStoredBaseline(payload) {
    window.localStorage.setItem(baselineStorageKey, JSON.stringify(payload));
  }

  function clearStoredBaseline() {
    window.localStorage.removeItem(baselineStorageKey);
  }

  function renderBaselineComparison() {
    if (!baselinePayload || !currentPayload) {
      if (baselineEmptyState) {
        baselineEmptyState.hidden = false;
      }
      if (baselineDetails) {
        baselineDetails.hidden = true;
        baselineDetails.open = false;
      }
      if (clearBaselineButton) {
        clearBaselineButton.disabled = true;
      }
      return;
    }

    if (baselineEmptyState) {
      baselineEmptyState.hidden = true;
    }
    if (baselineDetails) {
      baselineDetails.hidden = false;
    }
    if (clearBaselineButton) {
      clearBaselineButton.disabled = false;
    }

    const baselineMoment = new Date(baselinePayload.selected_moment);
    const currentMoment = new Date(currentPayload.selected_moment);
    setBaselineMetric(
      "baseline-selected-moment",
      formatSelectedMoment(baselinePayload),
      formatSelectedMoment(currentPayload),
      selectedMomentDeltaLabel(baselineMoment, currentMoment),
      baselineMoment.getTime() === currentMoment.getTime() ? "baseline-delta-neutral" : "baseline-delta-positive"
    );

    const baselinePeakIntensity = baselinePayload.daily.peak_intensity || 0;
    const currentPeakIntensity = currentPayload.daily.peak_intensity || 0;
    setBaselineMetric(
      "baseline-peak-intensity",
      baselinePeakIntensity.toFixed(3),
      currentPeakIntensity.toFixed(3),
      formatNumericDelta(currentPeakIntensity - baselinePeakIntensity),
      deltaClassForValue(currentPeakIntensity - baselinePeakIntensity)
    );

    const baselineSunlitFraction = (baselinePayload.daily.exposure_grid.sunlit_fraction || 0) * 100;
    const currentSunlitFraction = (currentPayload.daily.exposure_grid.sunlit_fraction || 0) * 100;
    setBaselineMetric(
      "baseline-sunlit-fraction",
      `${Math.round(baselineSunlitFraction)}%`,
      `${Math.round(currentSunlitFraction)}%`,
      formatNumericDelta(currentSunlitFraction - baselineSunlitFraction, "%"),
      deltaClassForValue(currentSunlitFraction - baselineSunlitFraction)
    );

    const baselinePeakHours = baselinePayload.daily.exposure_grid.peak_hours || 0;
    const currentPeakHours = currentPayload.daily.exposure_grid.peak_hours || 0;
    setBaselineMetric(
      "baseline-peak-hours",
      `${baselinePeakHours.toFixed(1)} h`,
      `${currentPeakHours.toFixed(1)} h`,
      formatNumericDelta(currentPeakHours - baselinePeakHours, " h"),
      deltaClassForValue(currentPeakHours - baselinePeakHours)
    );
  }

  function updateTimeScrubberReference(timezoneName) {
    if (!timeScrubberReference) {
      return;
    }
    timeScrubberReference.textContent = `Reference timezone: ${timezoneName}`;
  }

  function isCompleteDateValue() {
    return /^\d{4}-\d{2}-\d{2}$/.test(selectedDateInput.value);
  }

  function isCompleteTimeValue() {
    return /^\d{2}:\d{2}$/.test(selectedTimeInput.value);
  }

  function isReadyToRefresh() {
    if (!form.checkValidity()) {
      return false;
    }
    if (!isCompleteDateValue() || !isCompleteTimeValue()) {
      return false;
    }
    if (!/^\d{4}$/.test(yearInput.value)) {
      return false;
    }
    if (locationPresetInput.value === "custom") {
      if (parseFiniteNumber(latitudeInput.value) === null || parseFiniteNumber(longitudeInput.value) === null) {
        return false;
      }
      if (!timezoneInput.value.trim()) {
        return false;
      }
    }
    persistActiveWindowEditor();
    if (!windowsAreComplete()) {
      return false;
    }
    return true;
  }

  function scheduleRefresh(message = "Changes pending...") {
    if (!isReadyToRefresh()) {
      setUpdateStatus("Finish the current field to update.", "draft");
      return;
    }
    syncWindowsJsonFromEditor();
    setUpdateStatus(message, "pending");
    debouncedRefresh();
  }

  function roomPointFromPointer(svg, event) {
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    const viewBox = svg.viewBox.baseVal;
    const viewX = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width;
    const viewY = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height;
    return {
      x: viewX,
      y: currentPayload.room.depth - viewY,
    };
  }

  function windowWallBounds(payload) {
    const wall = selectedPayloadWall(payload);
    const roomWidth = payload.room.width;
    const roomDepth = payload.room.depth;
    const { width: windowWidth } = currentWindowMetrics(payload);
    const halfSpan = windowWidth / 2;

    if (wall === "north" || wall === "south") {
      return {
        axis: "x",
        min: halfSpan,
        max: roomWidth - halfSpan,
        halfWindow: halfSpan,
      };
    }

    return {
      axis: "y",
      min: halfSpan,
      max: roomDepth - halfSpan,
      halfWindow: halfSpan,
    };
  }

  function wallSegmentFromCenter(payload, centerValue) {
    const wall = selectedPayloadWall(payload);
    const roomWidth = payload.room.width;
    const roomDepth = payload.room.depth;
    const bounds = windowWallBounds(payload);
    const clampedCenter = clamp(centerValue, bounds.min, bounds.max);
    const halfWindow = bounds.halfWindow;

    if (wall === "north") {
      return [[clampedCenter - halfWindow, roomDepth], [clampedCenter + halfWindow, roomDepth]];
    }
    if (wall === "south") {
      return [[clampedCenter - halfWindow, 0], [clampedCenter + halfWindow, 0]];
    }
    if (wall === "east") {
      return [[roomWidth, clampedCenter - halfWindow], [roomWidth, clampedCenter + halfWindow]];
    }
    return [[0, clampedCenter - halfWindow], [0, clampedCenter + halfWindow]];
  }

  function wallSegmentFromMetrics(payload, centerValue, widthValue) {
    const wall = selectedPayloadWall(payload);
    const roomWidth = payload.room.width;
    const roomDepth = payload.room.depth;
    const minWidth = 0.2;
    const maxWidth = wall === "north" || wall === "south"
      ? roomWidth
      : roomDepth;
    const safeWidth = clamp(widthValue, minWidth, maxWidth);
    const halfWindow = safeWidth / 2;
    const clampedCenter = clamp(centerValue, halfWindow, maxWidth - halfWindow);

    if (wall === "north") {
      return [[clampedCenter - halfWindow, roomDepth], [clampedCenter + halfWindow, roomDepth]];
    }
    if (wall === "south") {
      return [[clampedCenter - halfWindow, 0], [clampedCenter + halfWindow, 0]];
    }
    if (wall === "east") {
      return [[roomWidth, clampedCenter - halfWindow], [roomWidth, clampedCenter + halfWindow]];
    }
    return [[0, clampedCenter - halfWindow], [0, clampedCenter + halfWindow]];
  }

  function updateRoomWindowPreview(segment) {
    const container = document.getElementById("room-snapshot-svg");
    if (!container || !segment) {
      return;
    }
    const svg = container.querySelector("svg");
    if (!svg) {
      return;
    }
    const depth = currentPayload.room.depth;
    const [start, end] = segment;
    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;
    const startY = depth - start[1];
    const endY = depth - end[1];
    const midSvgY = depth - midY;

    [
      "room-window-glow",
      "room-window-line",
      "room-window-hit",
    ].forEach((id) => {
      const element = container.querySelector(`#${id}`);
      if (!element) {
        return;
      }
      element.setAttribute("x1", String(start[0]));
      element.setAttribute("y1", String(startY));
      element.setAttribute("x2", String(end[0]));
      element.setAttribute("y2", String(endY));
    });

    const startHandle = container.querySelector("#room-window-resize-start");
    if (startHandle) {
      startHandle.setAttribute("cx", String(start[0]));
      startHandle.setAttribute("cy", String(startY));
    }

    const endHandle = container.querySelector("#room-window-resize-end");
    if (endHandle) {
      endHandle.setAttribute("cx", String(end[0]));
      endHandle.setAttribute("cy", String(endY));
    }

    const circle = container.querySelector("#room-window-handle");
    if (circle) {
      circle.setAttribute("cx", String(midX));
      circle.setAttribute("cy", String(midSvgY));
    }

    const sourceCircle = container.querySelector("#room-window-source");
    if (sourceCircle) {
      sourceCircle.setAttribute("cx", String(midX));
      sourceCircle.setAttribute("cy", String(midSvgY));
    }

    const sourceText = container.querySelector("#room-window-label");
    if (sourceText) {
      sourceText.setAttribute("x", String(midX));
      sourceText.setAttribute("y", String(midSvgY - 0.28));
    }

    const newWidth = Math.abs(end[0] - start[0]) || Math.abs(end[1] - start[1]);
    const newCenter = Math.abs(end[0] - start[0]) > 0.0001 ? midX : midY;
    updateWindowGeometryReadout(newCenter, newWidth);
  }

  function handleWindowDragMove(event) {
    if (!activeWindowDrag) {
      return;
    }
    const point = roomPointFromPointer(activeWindowDrag.svg, event);
    if (!point) {
      return;
    }
    const bounds = windowWallBounds(currentPayload);
    const rawCenter = bounds.axis === "x" ? point.x : point.y;
    const snappedCenter = Math.round(clamp(rawCenter, bounds.min, bounds.max) * 10) / 10;
    windowSpanCenterInput.value = snappedCenter.toFixed(1);
    const { width } = currentWindowMetrics();
    updateRoomWindowPreview(wallSegmentFromMetrics(currentPayload, snappedCenter, width));
    setUpdateStatus("Release to update the sunlight preview.", "draft");
  }

  function endWindowDrag(event) {
    if (!activeWindowDrag) {
      return;
    }
    if (event && activeWindowDrag.svg.releasePointerCapture && event.pointerId !== undefined) {
      try {
        activeWindowDrag.svg.releasePointerCapture(event.pointerId);
      } catch (error) {
        console.debug(error);
      }
    }
    window.removeEventListener("pointermove", handleWindowDragMove);
    window.removeEventListener("pointerup", endWindowDrag);
    window.removeEventListener("pointercancel", endWindowDrag);
    document.body.classList.remove("is-dragging-window");
    activeWindowDrag = null;
    scheduleRefresh("Window moved. Updating preview...");
  }

  function handleWindowResizeMove(event) {
    if (!activeWindowResize) {
      return;
    }
    const point = roomPointFromPointer(activeWindowResize.svg, event);
    if (!point) {
      return;
    }
    const wall = selectedPayloadWall(currentPayload);
    const axisValue = wall === "north" || wall === "south" ? point.x : point.y;
    const { center } = currentWindowMetrics();
    const maxHalfWidth = wall === "north" || wall === "south"
      ? Math.min(center, currentPayload.room.width - center)
      : Math.min(center, currentPayload.room.depth - center);
    const rawHalfWidth = Math.abs(axisValue - center);
    const snappedWidth = Math.round(clamp(rawHalfWidth * 2, 0.2, maxHalfWidth * 2) * 10) / 10;
    windowWidthInput.value = snappedWidth.toFixed(1);
    updateRoomWindowPreview(wallSegmentFromMetrics(currentPayload, center, snappedWidth));
    setUpdateStatus("Release to update the sunlight preview.", "draft");
  }

  function endWindowResize(event) {
    if (!activeWindowResize) {
      return;
    }
    if (event && activeWindowResize.svg.releasePointerCapture && event.pointerId !== undefined) {
      try {
        activeWindowResize.svg.releasePointerCapture(event.pointerId);
      } catch (error) {
        console.debug(error);
      }
    }
    window.removeEventListener("pointermove", handleWindowResizeMove);
    window.removeEventListener("pointerup", endWindowResize);
    window.removeEventListener("pointercancel", endWindowResize);
    document.body.classList.remove("is-dragging-window");
    activeWindowResize = null;
    scheduleRefresh("Window resized. Updating preview...");
  }

  function wireRoomWindowDrag() {
    const container = document.getElementById("room-snapshot-svg");
    const svg = container ? container.querySelector("svg") : null;
    const dragHandles = container ? Array.from(container.querySelectorAll("[data-window-drag-handle]")) : [];
    if (!container || !svg || dragHandles.length === 0) {
      return;
    }

    dragHandles.forEach((dragHandle) => {
      dragHandle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        activeWindowDrag = { svg };
        document.body.classList.add("is-dragging-window");
        if (svg.setPointerCapture && event.pointerId !== undefined) {
          try {
            svg.setPointerCapture(event.pointerId);
          } catch (error) {
            console.debug(error);
          }
        }
        window.addEventListener("pointermove", handleWindowDragMove);
        window.addEventListener("pointerup", endWindowDrag);
        window.addEventListener("pointercancel", endWindowDrag);
        handleWindowDragMove(event);
      });
    });
  }

  function wireRoomWindowResize() {
    const container = document.getElementById("room-snapshot-svg");
    const svg = container ? container.querySelector("svg") : null;
    const resizeHandles = container ? Array.from(container.querySelectorAll("[data-window-resize-handle]")) : [];
    if (!container || !svg || resizeHandles.length === 0) {
      return;
    }

    resizeHandles.forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activeWindowResize = { svg, handle: handle.dataset.windowResizeHandle };
        document.body.classList.add("is-dragging-window");
        if (svg.setPointerCapture && event.pointerId !== undefined) {
          try {
            svg.setPointerCapture(event.pointerId);
          } catch (error) {
            console.debug(error);
          }
        }
        window.addEventListener("pointermove", handleWindowResizeMove);
        window.addEventListener("pointerup", endWindowResize);
        window.addEventListener("pointercancel", endWindowResize);
        handleWindowResizeMove(event);
      });
    });
  }

  function createRoomSvg(payload) {
    const width = payload.room.width;
    const depth = payload.room.depth;
    const pad = 0.95;
    const viewBox = `${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`;
    const mapPoint = (point) => `${point[0]},${depth - point[1]}`;
    const activePayloadIndex = Math.min(activeWindowIndex, payload.windows.length - 1);
    const windowsByName = new Map(payload.windows.map((window) => [window.name, window]));
    const windowIndexByName = new Map(payload.windows.map((window, index) => [window.name, index]));
    const rays = [];
    const windowsWithPatch = new Set();

    if (payload.snapshot.patches.length > 0) {
      payload.snapshot.patches.forEach((patch) => {
        const sourceWindow = windowsByName.get(patch.window_name);
        if (!sourceWindow) {
          return;
        }
        windowsWithPatch.add(patch.window_name);
        const [windowA, windowB] = sourceWindow.wall_segment_xy;
        const patchPoints = patch.polygon_xy;
        const sortedPatchPoints = [...patchPoints].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
        const sortedWindowPoints = [windowA, windowB].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
        rays.push([sortedWindowPoints[0], sortedPatchPoints[0], patch.intensity, patch.window_name]);
        rays.push([sortedWindowPoints[1], sortedPatchPoints[sortedPatchPoints.length - 1], patch.intensity, patch.window_name]);
      });
    }

    const azimuthRad = (payload.snapshot.room_azimuth_deg * Math.PI) / 180;
    const planX = Math.sin(azimuthRad);
    const planY = Math.cos(azimuthRad);
    const rayLength = Math.min(width, depth) * 0.38;
    payload.snapshot.window_intensities
      .filter((entry) => entry.intensity > 0 && !windowsWithPatch.has(entry.name))
      .forEach((entry) => {
        const sourceWindow = windowsByName.get(entry.name);
        if (!sourceWindow) {
          return;
        }
        const [windowA, windowB] = sourceWindow.wall_segment_xy;
        const windowMid = [(windowA[0] + windowB[0]) / 2, (windowA[1] + windowB[1]) / 2];
        rays.push([
          windowMid,
          [
            windowMid[0] - planX * rayLength,
            windowMid[1] - planY * rayLength,
          ],
          entry.intensity,
          entry.name,
        ]);
      });

    const patchPolygons = payload.snapshot.patches.map((patch) => {
      const points = patch.polygon_xy.map(mapPoint).join(" ");
      const windowIndex = windowIndexByName.get(patch.window_name) ?? 0;
      const strokeColor = windowAccentColor(windowIndex);
      const alpha = Math.max(0.24, Math.min(0.74, patch.intensity));
      const centroid = patch.polygon_xy.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]).map((value) => value / patch.polygon_xy.length);
      const label = escapeHtml(patch.window_name.replace(/_/g, " "));
      return `
        <polygon points="${points}" fill="rgba(200,101,48,${alpha})" stroke="${strokeColor}" stroke-width="0.05"></polygon>
        <text x="${centroid[0]}" y="${depth - centroid[1] - 0.08}" font-size="0.14" text-anchor="middle" fill="${strokeColor}">${label}</text>
      `;
    }).join("");

    const windowElements = payload.windows.map((window, index) => {
      const [start, end] = window.wall_segment_xy;
      const midX = (start[0] + end[0]) / 2;
      const midY = (start[1] + end[1]) / 2;
      const startY = depth - start[1];
      const endY = depth - end[1];
      const midSvgY = depth - midY;
      const labelText = escapeHtml(window.name || `Window ${index + 1}`);

      const isSelectedWindow = index === activePayloadIndex;
      const dragCursor = window.wall === "north" || window.wall === "south" ? "ew-resize" : "ns-resize";

      if (isSelectedWindow) {
        return `
          <line id="room-window-glow" x1="${start[0]}" y1="${startY}" x2="${end[0]}" y2="${endY}" stroke="rgba(240,178,79,0.35)" stroke-width="0.32" stroke-linecap="round"></line>
          <line id="room-window-line" x1="${start[0]}" y1="${startY}" x2="${end[0]}" y2="${endY}" stroke="${windowAccentColor(index)}" stroke-width="0.17" stroke-linecap="round"></line>
          <line id="room-window-hit" data-window-drag-handle="true" x1="${start[0]}" y1="${startY}" x2="${end[0]}" y2="${endY}" stroke="rgba(43,98,122,0.001)" stroke-width="0.62" stroke-linecap="round" pointer-events="stroke" style="cursor:${dragCursor}"></line>
          <circle id="room-window-resize-start" data-window-resize-handle="start" cx="${start[0]}" cy="${startY}" r="0.14" fill="#fff7ec" stroke="#c86530" stroke-width="0.05" pointer-events="all" style="cursor:${dragCursor}"></circle>
          <circle id="room-window-resize-end" data-window-resize-handle="end" cx="${end[0]}" cy="${endY}" r="0.14" fill="#fff7ec" stroke="#c86530" stroke-width="0.05" pointer-events="all" style="cursor:${dragCursor}"></circle>
          <circle id="room-window-handle" data-window-drag-handle="true" cx="${midX}" cy="${midSvgY}" r="0.18" fill="#fffdf8" stroke="${windowAccentColor(index)}" stroke-width="0.05" pointer-events="all" style="cursor:${dragCursor}"></circle>
          <circle id="room-window-source" data-window-drag-handle="true" cx="${midX}" cy="${midSvgY}" r="0.12" fill="${windowAccentColor(index)}" pointer-events="all" style="cursor:${dragCursor}"></circle>
          <text id="room-window-label" x="${midX}" y="${midSvgY - 0.28}" font-size="0.22" text-anchor="middle" fill="${windowAccentColor(index)}">${payload.is_multi_window ? `Window ${index + 1}` : "Main window"}</text>
        `;
      }

      return `
        <line x1="${start[0]}" y1="${startY}" x2="${end[0]}" y2="${endY}" stroke="rgba(240,178,79,${isSelectedWindow ? "0.42" : "0.22"})" stroke-width="${isSelectedWindow ? "0.32" : "0.24"}" stroke-linecap="round"></line>
        <line x1="${start[0]}" y1="${startY}" x2="${end[0]}" y2="${endY}" stroke="${windowAccentColor(index)}" stroke-width="${isSelectedWindow ? "0.17" : "0.14"}" stroke-linecap="round"></line>
        <text x="${midX}" y="${midSvgY - 0.2}" font-size="0.16" text-anchor="middle" fill="${isSelectedWindow ? "#8e3b18" : windowAccentColor(index)}">${labelText}</text>
      `;
    }).join("");

    const rayLines = rays.map(([start, end, intensity, windowName]) => {
      const windowIndex = windowIndexByName.get(windowName) ?? 0;
      return `<line x1="${start[0]}" y1="${depth - start[1]}" x2="${end[0]}" y2="${depth - end[1]}" stroke="${windowAccentColor(windowIndex)}" opacity="${Math.max(0.35, Math.min(0.85, intensity || 0.5))}" stroke-width="0.06" stroke-linecap="round" stroke-dasharray="0.12 0.08"></line>`;
    }).join("");

    const noPatch = payload.snapshot.patches.length === 0
      ? `<text x="${width / 2}" y="${depth / 2 + 0.6}" font-size="0.28" text-anchor="middle" fill="#616a68">No direct floor patch</text>`
      : "";
    const [topLabel, rightLabel, bottomLabel, leftLabel] = roomEdgeLabels(payload.window_facing_label);
    const dimensionGuides = createDimensionGuides(width, depth);
    const sideLabels = `
      <text x="${width / 2}" y="-0.16" font-size="0.2" text-anchor="middle" fill="#5f6d77">${topLabel}</text>
      <text x="${width + 0.22}" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(90 ${width + 0.22} ${depth / 2})">${rightLabel}</text>
      <text x="${width / 2}" y="${depth + 0.28}" font-size="0.2" text-anchor="middle" fill="#5f6d77">${bottomLabel}</text>
      <text x="-0.22" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(-90 -0.22 ${depth / 2})">${leftLabel}</text>
    `;
    const sourceLegend = `<text x="${width - 0.25}" y="${depth - 0.15}" font-size="0.18" text-anchor="end" fill="#616a68">${payload.is_multi_window ? "Windows" : "Window"} → Rays → Floor patch</text>`;
    const defs = `
      <defs>
        <filter id="patchShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.05" stdDeviation="0.04" flood-color="#8e3b18" flood-opacity="0.18"></feDropShadow>
        </filter>
      </defs>
    `;

    return `
      <svg viewBox="${viewBox}" role="img" aria-label="Top-down room snapshot">
        ${defs}
        <rect x="0" y="0" width="${width}" height="${depth}" fill="#fffdf8" stroke="#1f2732" stroke-width="0.06"></rect>
        ${windowElements}
        ${rayLines}
        <g filter="url(#patchShadow)">${patchPolygons}</g>
        ${noPatch}
        ${dimensionGuides}
        ${sideLabels}
        ${sourceLegend}
      </svg>
    `;
  }

  function createExposureMapSvg(payload, grid, ariaLabel) {
    const width = payload.room.width;
    const depth = payload.room.depth;
    const pad = 0.95;
    const viewBox = `${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`;
    const rows = grid.rows;
    const cols = grid.cols;
    const cellWidth = grid.cell_width;
    const cellHeight = grid.cell_height;
    const peakHours = Math.max(grid.peak_hours || 0, 0.0001);
    const [topLabel, rightLabel, bottomLabel, leftLabel] = roomEdgeLabels(payload.window_facing_label);

    const dimensionGuides = createDimensionGuides(width, depth);

    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const value = grid.values[row][col];
        const alpha = value > 0 ? 0.12 + (value / peakHours) * 0.72 : 0;
        const x = col * cellWidth;
        const y = depth - (row + 1) * cellHeight;
        cells.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="rgba(200,101,48,${alpha})" stroke="rgba(255,255,255,0.12)" stroke-width="0.01" data-cell-row="${row + 1}" data-cell-col="${col + 1}" data-cell-hours="${value.toFixed(2)}"></rect>`);
      }
    }

    const windowLines = payload.windows.map((window) => {
      const [start, end] = window.wall_segment_xy;
      return `<line x1="${start[0]}" y1="${depth - start[1]}" x2="${end[0]}" y2="${depth - end[1]}" stroke="#2b627a" stroke-width="0.14" stroke-linecap="round"></line>`;
    }).join("");

    return `
      <svg viewBox="${viewBox}" role="img" aria-label="${ariaLabel}">
        <rect x="0" y="0" width="${width}" height="${depth}" fill="#fffdf8" stroke="#1f2732" stroke-width="0.06"></rect>
        ${cells.join("")}
        ${windowLines}
        ${dimensionGuides}
        <text x="${0.12}" y="${0.25}" font-size="0.18" fill="#616a68">0 h</text>
        <text x="${width - 0.12}" y="${0.25}" font-size="0.18" text-anchor="end" fill="#8e3b18">${grid.peak_hours.toFixed(1)} h max</text>
        <text x="${width / 2}" y="-0.16" font-size="0.2" text-anchor="middle" fill="#5f6d77">${topLabel}</text>
        <text x="${width + 0.22}" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(90 ${width + 0.22} ${depth / 2})">${rightLabel}</text>
        <text x="${width / 2}" y="${depth + 0.28}" font-size="0.2" text-anchor="middle" fill="#5f6d77">${bottomLabel}</text>
        <text x="-0.22" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(-90 -0.22 ${depth / 2})">${leftLabel}</text>
      </svg>
    `;
  }

  function updateSnapshotDom(payload) {
    currentPayload = payload;
    const snapshot = payload.snapshot;
    const daily = payload.daily;
    const timeZone = payload.location.timezone_name;
    const sunActiveWindowCount = snapshot.window_intensities.filter((entry) => entry.intensity > 0).length;
    const floorPatchCount = snapshot.patches.length;
    updateSummaryDom(payload.summary);

    setText("selected-moment-label", new Date(payload.selected_moment).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }));

    setText("live-elevation", `${snapshot.elevation_deg.toFixed(2)} deg`);
    setText("live-azimuth", `${snapshot.azimuth_deg.toFixed(2)} deg`);
    setText("live-entry", snapshot.entered_direct_sun ? "Yes" : "No");
    setText("live-strongest", snapshot.strongest_window
      ? `${snapshot.strongest_window} (${snapshot.strongest_intensity.toFixed(3)})`
      : "None");
    setText("live-vector", `(${snapshot.vector.map((value) => value.toFixed(3)).join(", ")})`);
    setText("live-daily-peak", daily.peak_time
      ? `${daily.peak_intensity.toFixed(3)} at ${new Date(daily.peak_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
          timeZoneName: "short",
        })}`
      : "No direct sun");

    setHtml("room-snapshot-svg", createRoomSvg(payload));
    wireRoomWindowDrag();
    wireRoomWindowResize();
    if (windowEditHint) {
      windowEditHint.textContent = payload.window_override_active
        ? "Current moment shows all windows at this time. Select a window in the panel only when you want to edit its wall or size."
        : "Drag the window marker or line to move it. Drag the end handles to resize the width.";
    }
    const { center, width } = currentWindowMetrics(payload);
    if (payload.window_override_active && windowRows.length > 1) {
      const patchLabel = floorPatchCount === 1 ? "1 floor patch" : `${floorPatchCount} floor patches`;
      const activeLabel = sunActiveWindowCount === 1 ? "1 active window" : `${sunActiveWindowCount} active windows`;
      setText("window-centre-readout", `Strongest window: ${snapshot.strongest_window || "None"}`);
      setText("window-width-readout", `${activeLabel} · ${patchLabel}`);
    } else {
      updateWindowGeometryReadout(center, width);
    }
    setHtml("daily-exposure-svg", createExposureMapSvg(payload, payload.daily.exposure_grid, "Daily sunlight map"));
    updateExposureLegendAndStats(payload.daily.exposure_grid, "daily");
    hideExposureTooltip(dailyExposureTooltip);

    const snapshotStatus = document.getElementById("room-snapshot-status");
    if (snapshotStatus) {
      snapshotStatus.textContent = snapshotStateLabel(snapshot.state);
      snapshotStatus.className = snapshotStateClass(snapshot.state);
    }

    setText(
      "snapshot-window-fact",
      payload.is_multi_window
        ? `Room orientation: Window 1 faces ${payload.window_facing_label} · ${payload.windows.length} windows`
        : `Window 1 faces ${payload.window_facing_label}`,
    );
    setText("snapshot-azimuth-fact", `Azimuth: ${snapshot.azimuth_deg.toFixed(1)}°`);
    setText("snapshot-elevation-fact", `Elevation: ${snapshot.elevation_deg.toFixed(1)}°`);
    const [topLabel, rightLabel, bottomLabel, leftLabel] = roomEdgeLabels(payload.window_facing_label);
    setText("room-angle-caption", `Room edges: top ${topLabel}, right ${rightLabel}, bottom ${bottomLabel}, left ${leftLabel}.`);
    setDaylightMarker(sunriseMarker, payload.daily.sunrise_time, "Sunrise");
    setDaylightMarker(sunsetMarker, payload.daily.sunset_time, "Sunset");
    setText(
      "daily-exposure-caption",
      `${Math.round(payload.daily.exposure_grid.sunlit_fraction * 100)}% of the room gets some direct sun today. Darker cells mean more direct sun exposure time. Peak floor cell exposure: ${payload.daily.exposure_grid.peak_hours.toFixed(1)} h.`
    );
    renderBaselineComparison();
  }

  function updateLongRangeDom() {
    if (!longRangePayload) {
      return;
    }
    const period = longRangePayload.periods[activeLongRangePeriod];
    periodViewButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.periodView === activeLongRangePeriod);
      const buttonPeriod = longRangePayload.periods[button.dataset.periodView];
      if (buttonPeriod) {
        button.textContent = buttonPeriod.label;
      }
    });
    setHtml(
      "long-range-exposure-svg",
      createExposureMapSvg(longRangePayload, period.exposure_grid, `${period.label} sunlight map`)
    );
    updateExposureLegendAndStats(period.exposure_grid, "long-range");
    hideExposureTooltip(longRangeExposureTooltip);
    setText(
      "long-range-exposure-caption",
      `${period.description}. Peak floor cell exposure: ${period.exposure_grid.peak_hours.toFixed(1)} h.`
    );
  }

  function clearExposureHoverState(containerId) {
    document.querySelectorAll(`#${containerId} [data-cell-hours]`).forEach((cell) => {
      cell.setAttribute("stroke", "rgba(255,255,255,0.12)");
      cell.setAttribute("stroke-width", "0.01");
    });
  }

  function wireExposureInteractions(containerId, tooltip) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    container.addEventListener("mousemove", (event) => {
      const cell = event.target.closest("[data-cell-hours]");
      if (!cell) {
        clearExposureHoverState(containerId);
        hideExposureTooltip(tooltip);
        return;
      }
      clearExposureHoverState(containerId);
      const row = cell.dataset.cellRow;
      const col = cell.dataset.cellCol;
      const hours = parseFloat(cell.dataset.cellHours || "0");
      cell.setAttribute("stroke", "rgba(31,39,50,0.28)");
      cell.setAttribute("stroke-width", "0.03");
      showExposureTooltip(containerId, tooltip, `Row ${row}, column ${col}: ${hours.toFixed(1)} h direct sun.`, event);
    });

    container.addEventListener("mouseleave", () => {
      clearExposureHoverState(containerId);
      hideExposureTooltip(tooltip);
    });

    container.addEventListener("click", (event) => {
      const cell = event.target.closest("[data-cell-hours]");
      if (!cell) {
        return;
      }
      const row = cell.dataset.cellRow;
      const col = cell.dataset.cellCol;
      const hours = parseFloat(cell.dataset.cellHours || "0");
      showExposureTooltip(containerId, tooltip, `Selected row ${row}, column ${col}: ${hours.toFixed(1)} h direct sun.`, event);
    });
  }

  async function refreshSnapshot() {
    latestRequestId += 1;
    const requestId = latestRequestId;
    if (activeSnapshotController) {
      activeSnapshotController.abort();
    }
    activeSnapshotController = new AbortController();
    setPendingState(true);
    setUpdateStatus("Updating preview...", "pending");
    const params = new URLSearchParams(new FormData(form));
    try {
      const response = await fetch(`/api/snapshot?${params.toString()}`, {
        signal: activeSnapshotController.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Snapshot request failed.");
      }
      if (requestId === latestRequestId) {
        updateSnapshotDom(payload);
        if (activeResultTab === "long-range") {
          await fetchLongRangeExposure(true);
        } else {
          setUpdateStatus(defaultUpdateMessage, "idle");
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      console.error(error);
      setUpdateStatus("Could not update preview.", "error");
    } finally {
      if (requestId === latestRequestId) {
        setPendingState(false);
      }
    }
  }

  async function fetchLongRangeExposure(force = false) {
    const query = currentQueryString();
    if (!force && longRangePayload && longRangeQuery === query) {
      updateLongRangeDom();
      return;
    }

    latestLongRangeRequestId += 1;
    const requestId = latestLongRangeRequestId;
    if (activeLongRangeController) {
      activeLongRangeController.abort();
    }
    activeLongRangeController = new AbortController();
    setPendingState(true);
    setUpdateStatus("Updating yearly map...", "pending");
    try {
      const response = await fetch(`/api/long-range-exposure?${query}`, {
        signal: activeLongRangeController.signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Long-range request failed.");
      }
      if (requestId === latestLongRangeRequestId) {
        longRangePayload = payload;
        longRangeQuery = query;
        updateLongRangeDom();
        setUpdateStatus(defaultUpdateMessage, "idle");
      }
    } catch (error) {
      if (error.name === "AbortError") {
        return;
      }
      console.error(error);
      setUpdateStatus("Could not update yearly map.", "error");
    } finally {
      if (requestId === latestLongRangeRequestId) {
        setPendingState(false);
      }
    }
  }

  const debouncedRefresh = debounce(refreshSnapshot, 180);

  function refreshCustomCoordinates() {
    setLocationPreset("custom", { applyPreset: false, openPanel: true, refresh: false });
    const latitude = parseFiniteNumber(latitudeInput.value);
    const longitude = parseFiniteNumber(longitudeInput.value);
    if (marker && map && latitude !== null && longitude !== null) {
      marker.setLatLng([latitude, longitude]);
      map.panTo(marker.getLatLng());
    }
    scheduleRefresh();
  }

  function refreshTimezone() {
    setLocationPreset("custom", { applyPreset: false, openPanel: true, refresh: false });
    updateTimeScrubberReference(timezoneInput.value.trim() || "Custom timezone");
    scheduleRefresh();
  }

  function refreshLocationName() {
    setLocationPreset("custom", { applyPreset: false, openPanel: true, refresh: false });
    scheduleRefresh();
  }

  function setInputsToNow() {
    const timezoneName = timezoneInput.value.trim();
    if (!timezoneName) {
      setUpdateStatus("Set a timezone first.", "draft");
      return;
    }
    try {
      const now = roundedNowInTimezone(timezoneName);
      selectedDateInput.value = now.date;
      selectedTimeInput.value = now.time;
      syncSlidersFromInputs();
      scheduleRefresh("Set to now...");
    } catch (error) {
      setUpdateStatus("Timezone is not valid for 'Now'.", "error");
    }
  }

  function refreshFromNumberField(input) {
    if (input.value === "" || !input.validity.valid) {
      setUpdateStatus("Finish the current field to update.", "draft");
      return;
    }
    scheduleRefresh();
  }

  locationChipButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setLocationPreset(button.dataset.locationPreset);
    });
  });

  windowFacingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setWindowFacing(button.dataset.windowFacing);
    });
  });

  resultTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedTab = button.dataset.resultTab;
      activeResultTab = selectedTab;
      resultTabButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      resultPanels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.resultPanel === selectedTab);
      });
      if (selectedTab === "long-range") {
        fetchLongRangeExposure();
      }
    });
  });

  periodViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeLongRangePeriod = button.dataset.periodView;
      if (activeResultTab === "long-range") {
        fetchLongRangeExposure();
      } else {
        periodViewButtons.forEach((item) => {
          item.classList.toggle("is-active", item === button);
        });
      }
    });
  });

  wireExposureInteractions("daily-exposure-svg", dailyExposureTooltip);
  wireExposureInteractions("long-range-exposure-svg", longRangeExposureTooltip);

  customLocationToggle.addEventListener("click", () => {
    if (locationPresetInput.value === "custom") {
      ensureMap();
      invalidateMapSoon();
    }
  });

  customLocationPanel.addEventListener("toggle", () => {
    if (customLocationPanel.open) {
      ensureMap();
      invalidateMapSoon();
    }
  });

  daySlider.addEventListener("input", () => {
    syncInputsFromSliders();
    scheduleRefresh();
  });

  timeSlider.addEventListener("input", () => {
    syncInputsFromSliders();
    scheduleRefresh();
  });

  function refreshFromDateInput() {
    if (!isCompleteDateValue()) {
      setUpdateStatus("Finish the current field to update.", "draft");
      return;
    }
    syncSlidersFromInputs();
    scheduleRefresh();
  }

  function refreshFromTimeInput() {
    if (!isCompleteTimeValue()) {
      setUpdateStatus("Finish the current field to update.", "draft");
      return;
    }
    syncSlidersFromInputs();
    scheduleRefresh();
  }

  selectedDateInput.addEventListener("input", refreshFromDateInput);
  selectedDateInput.addEventListener("change", refreshFromDateInput);

  selectedTimeInput.addEventListener("input", refreshFromTimeInput);
  selectedTimeInput.addEventListener("change", refreshFromTimeInput);

  function refreshFromYearInput() {
    if (!/^\d{4}$/.test(yearInput.value)) {
      setUpdateStatus("Finish the current field to update.", "draft");
      return;
    }
    const parsedYear = parseInt(yearInput.value, 10);
    if (!Number.isFinite(parsedYear)) {
      return;
    }
    const boundedDay = Math.min(parseInt(daySlider.value, 10), dayOfYearMax(parsedYear));
    selectedDateInput.value = dateStringFromDayOfYear(parsedYear, boundedDay);
    syncSlidersFromInputs();
    scheduleRefresh();
  }

  yearInput.addEventListener("input", refreshFromYearInput);
  yearInput.addEventListener("change", refreshFromYearInput);

  [latitudeInput, longitudeInput].forEach((input) => {
    input.addEventListener("input", refreshCustomCoordinates);
    input.addEventListener("change", refreshCustomCoordinates);
  });

  timezoneInput.addEventListener("input", () => {
    updateTimeScrubberReference(timezoneInput.value.trim() || "Custom timezone");
    setUpdateStatus("Finish the current field to update.", "draft");
  });
  timezoneInput.addEventListener("change", refreshTimezone);

  locationNameInput.addEventListener("input", () => {
    setUpdateStatus("Finish the current field to update.", "draft");
  });
  locationNameInput.addEventListener("change", refreshLocationName);

  if (windowsJsonInput) {
    windowsJsonInput.addEventListener("input", () => {
      if (!suppressWindowBuilderSync) {
        renderWindowBuilderFromTextarea();
      }
      setUpdateStatus("Finish the current field to update.", "draft");
    });
    windowsJsonInput.addEventListener("change", () => {
      if (!suppressWindowBuilderSync) {
        renderWindowBuilderFromTextarea();
      }
      scheduleRefresh("Updating preview...");
    });
  }

  if (selectedWindowWallSelect) {
    selectedWindowWallSelect.addEventListener("change", () => {
      persistActiveWindowEditor();
      renderWindowEditor();
      if (syncWindowsJsonFromEditor()) {
        scheduleRefresh("Updating preview...");
      } else {
        setUpdateStatus("Complete the selected window to update the preview.", "draft");
      }
    });
  }

  if (addWindowRowButton) {
    addWindowRowButton.addEventListener("click", () => {
      addEmptyWindowRow();
      scheduleRefresh("Added another window. Updating preview...");
    });
  }

  if (removeWindowButton) {
    removeWindowButton.addEventListener("click", () => {
      if (activeWindowIndex === 0 || windowRows.length <= 1) {
        return;
      }
      windowRows.splice(activeWindowIndex, 1);
      activeWindowIndex = Math.max(0, activeWindowIndex - 1);
      renderWindowEditor();
      syncWindowsJsonFromEditor();
      scheduleRefresh("Removed window. Updating preview...");
    });
  }

  const windowGeometryInputs = new Set([
    windowSpanCenterInput,
    windowSillHeightInput,
    windowWidthInput,
    windowHeightInput,
  ]);

  windowGeometryInputs.forEach((input) => {
    input.addEventListener("input", () => {
      persistActiveWindowEditor();
      setUpdateStatus(
        windowsAreComplete() ? "Finish the current field to update." : "Complete the selected window to update the preview.",
        "draft",
      );
    });
    input.addEventListener("change", () => {
      persistActiveWindowEditor();
      if (syncWindowsJsonFromEditor()) {
        scheduleRefresh("Updating preview...");
      } else {
        setUpdateStatus("Complete the selected window to update the preview.", "draft");
      }
    });
  });

  form.querySelectorAll('input[type="number"]').forEach((input) => {
    if (input === latitudeInput || input === longitudeInput || input === yearInput || windowGeometryInputs.has(input)) {
      return;
    }
    input.addEventListener("input", () => refreshFromNumberField(input));
    input.addEventListener("change", () => refreshFromNumberField(input));
  });

  if (setNowButton) {
    setNowButton.addEventListener("click", setInputsToNow);
  }

  if (saveBaselineButton) {
    saveBaselineButton.addEventListener("click", () => {
      if (!currentPayload) {
        return;
      }
      baselinePayload = currentPayload;
      writeStoredBaseline(baselinePayload);
      if (baselineDetails) {
        baselineDetails.open = true;
      }
      renderBaselineComparison();
      setUpdateStatus("Baseline saved.", "idle");
    });
  }

  if (clearBaselineButton) {
    clearBaselineButton.addEventListener("click", () => {
      baselinePayload = null;
      clearStoredBaseline();
      renderBaselineComparison();
      setUpdateStatus(defaultUpdateMessage, "idle");
    });
  }

  syncSlidersFromInputs();
  setActiveButtons(locationChipButtons, "locationPreset", locationPresetInput.value);
  setActiveButtons(windowFacingButtons, "windowFacing", windowFacingInput.value);
  if (locationPresetInput.value === "custom") {
    ensureMap();
    invalidateMapSoon();
  }
  baselinePayload = readStoredBaseline();
  renderWindowBuilderFromTextarea();
  updateSnapshotDom(initialData);
  updateTimeScrubberReference(timezoneInput.value);
  setUpdateStatus(defaultUpdateMessage, "idle");
})();
