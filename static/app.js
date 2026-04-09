(function () {
  const initialData = JSON.parse(document.getElementById("initial-snapshot-data").textContent);
  const locationPresets = JSON.parse(document.getElementById("location-presets-data").textContent);
  const form = document.getElementById("simulation-form");
  const roomWorkspace = document.querySelector(".room-workspace");
  const updateStatus = document.getElementById("update-status");

  const locationPresetInput = document.getElementById("location-preset-input");
  const windowFacingInput = document.getElementById("window-facing-input");
  const locationChipButtons = document.querySelectorAll("[data-location-preset]");
  const windowFacingButtons = document.querySelectorAll("[data-window-facing]");
  const resultTabButtons = document.querySelectorAll("[data-result-tab]");
  const resultPanels = document.querySelectorAll("[data-result-panel]");

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

  const mapElement = document.getElementById("location-map");
  let map = null;
  let marker = null;
  let latestRequestId = 0;
  let activeSnapshotController = null;
  const defaultUpdateMessage = "Preview is up to date.";

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
  }

  function setLocationPreset(presetKey, options = {}) {
    const { applyPreset = true, openPanel = false, refresh = true } = options;
    locationPresetInput.value = presetKey;
    setActiveButtons(locationChipButtons, "locationPreset", presetKey);

    if (presetKey === "custom") {
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

  function setPendingState(isPending) {
    roomWorkspace.classList.toggle("loading-state", isPending);
  }

  function parseFiniteNumber(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function setUpdateStatus(message, state = "idle") {
    if (!updateStatus) {
      return;
    }
    updateStatus.textContent = message;
    updateStatus.dataset.state = state;
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
    return true;
  }

  function scheduleRefresh(message = "Changes pending...") {
    if (!isReadyToRefresh()) {
      setUpdateStatus("Finish the current field to update.", "draft");
      return;
    }
    setUpdateStatus(message, "pending");
    debouncedRefresh();
  }

  function createRoomSvg(payload) {
    const width = payload.room.width;
    const depth = payload.room.depth;
    const pad = 0.45;
    const viewBox = `${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`;
    const mapPoint = (point) => `${point[0]},${depth - point[1]}`;
    const activeWindow = payload.windows[0];
    const [windowA, windowB] = activeWindow.wall_segment_xy;
    const windowMid = [(windowA[0] + windowB[0]) / 2, (windowA[1] + windowB[1]) / 2];
    const rays = [];

    if (payload.snapshot.patches.length > 0) {
      const patchPoints = payload.snapshot.patches[0].polygon_xy;
      const sortedPatchPoints = [...patchPoints].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
      const sortedWindowPoints = [windowA, windowB].sort((left, right) => left[1] - right[1] || left[0] - right[0]);
      rays.push([sortedWindowPoints[0], sortedPatchPoints[0]]);
      rays.push([sortedWindowPoints[1], sortedPatchPoints[sortedPatchPoints.length - 1]]);
    } else {
      const azimuthRad = (payload.snapshot.room_azimuth_deg * Math.PI) / 180;
      const planX = Math.sin(azimuthRad);
      const planY = Math.cos(azimuthRad);
      const rayLength = Math.min(width, depth) * 0.38;
      rays.push([
        windowMid,
        [
          windowMid[0] - planX * rayLength,
          windowMid[1] - planY * rayLength,
        ],
      ]);
    }

    const patchPolygons = payload.snapshot.patches.map((patch) => {
      const points = patch.polygon_xy.map(mapPoint).join(" ");
      const alpha = Math.max(0.24, Math.min(0.74, patch.intensity));
      return `<polygon points="${points}" fill="rgba(200,101,48,${alpha})" stroke="#8e3b18" stroke-width="0.04"></polygon>`;
    }).join("");

    const windowLine = `<line x1="${windowA[0]}" y1="${depth - windowA[1]}" x2="${windowB[0]}" y2="${depth - windowB[1]}" stroke="#2b627a" stroke-width="0.17" stroke-linecap="round"></line>`;
    const windowGlow = `<line x1="${windowA[0]}" y1="${depth - windowA[1]}" x2="${windowB[0]}" y2="${depth - windowB[1]}" stroke="rgba(240,178,79,0.35)" stroke-width="0.32" stroke-linecap="round"></line>`;
    const rayLines = rays.map(([start, end]) => (
      `<line x1="${start[0]}" y1="${depth - start[1]}" x2="${end[0]}" y2="${depth - end[1]}" stroke="#f0b24f" stroke-width="0.06" stroke-linecap="round" stroke-dasharray="0.12 0.08"></line>`
    )).join("");
    const sourceMarker = `
      <circle cx="${windowMid[0]}" cy="${depth - windowMid[1]}" r="0.12" fill="#2b627a"></circle>
      <text x="${windowMid[0]}" y="${depth - windowMid[1] - 0.28}" font-size="0.22" text-anchor="middle" fill="#2b627a">Main window</text>
    `;
    const noPatch = payload.snapshot.patches.length === 0
      ? `<text x="${width / 2}" y="${depth / 2 + 0.6}" font-size="0.28" text-anchor="middle" fill="#616a68">No direct floor patch</text>`
      : "";
    const sideLabels = `
      <text x="${width / 2}" y="-0.16" font-size="0.2" text-anchor="middle" fill="#5f6d77">0°</text>
      <text x="${width + 0.22}" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(90 ${width + 0.22} ${depth / 2})">90°</text>
      <text x="${width / 2}" y="${depth + 0.28}" font-size="0.2" text-anchor="middle" fill="#5f6d77">180°</text>
      <text x="-0.22" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(-90 -0.22 ${depth / 2})">270°</text>
    `;
    const sourceLegend = `<text x="${width - 0.25}" y="${depth - 0.15}" font-size="0.18" text-anchor="end" fill="#616a68">Window → Rays → Floor patch</text>`;
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
        ${windowGlow}
        ${rayLines}
        <g filter="url(#patchShadow)">${patchPolygons}</g>
        ${windowLine}
        ${sourceMarker}
        ${noPatch}
        ${sideLabels}
        ${sourceLegend}
      </svg>
    `;
  }

  function createExposureMapSvg(payload) {
    const width = payload.room.width;
    const depth = payload.room.depth;
    const pad = 0.45;
    const viewBox = `${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`;
    const activeWindow = payload.windows[0];
    const [windowA, windowB] = activeWindow.wall_segment_xy;
    const grid = payload.daily.exposure_grid;
    const rows = grid.rows;
    const cols = grid.cols;
    const cellWidth = grid.cell_width;
    const cellHeight = grid.cell_height;
    const peakHours = Math.max(grid.peak_hours || 0, 0.0001);

    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const value = grid.values[row][col];
        const alpha = value > 0 ? 0.12 + (value / peakHours) * 0.72 : 0;
        const x = col * cellWidth;
        const y = depth - (row + 1) * cellHeight;
        cells.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="rgba(200,101,48,${alpha})" stroke="rgba(255,255,255,0.12)" stroke-width="0.01"></rect>`);
      }
    }

    return `
      <svg viewBox="${viewBox}" role="img" aria-label="Daily sunlight map">
        <rect x="0" y="0" width="${width}" height="${depth}" fill="#fffdf8" stroke="#1f2732" stroke-width="0.06"></rect>
        ${cells.join("")}
        <line x1="${windowA[0]}" y1="${depth - windowA[1]}" x2="${windowB[0]}" y2="${depth - windowB[1]}" stroke="#2b627a" stroke-width="0.17" stroke-linecap="round"></line>
        <text x="${0.12}" y="${0.25}" font-size="0.18" fill="#616a68">0 h</text>
        <text x="${width - 0.12}" y="${0.25}" font-size="0.18" text-anchor="end" fill="#8e3b18">${grid.peak_hours.toFixed(1)} h max</text>
        <text x="${width / 2}" y="-0.16" font-size="0.2" text-anchor="middle" fill="#5f6d77">0°</text>
        <text x="${width + 0.22}" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(90 ${width + 0.22} ${depth / 2})">90°</text>
        <text x="${width / 2}" y="${depth + 0.28}" font-size="0.2" text-anchor="middle" fill="#5f6d77">180°</text>
        <text x="-0.22" y="${depth / 2}" font-size="0.2" text-anchor="middle" fill="#5f6d77" transform="rotate(-90 -0.22 ${depth / 2})">270°</text>
      </svg>
    `;
  }

  function updateSnapshotDom(payload) {
    const snapshot = payload.snapshot;
    const daily = payload.daily;
    const timeZone = payload.location.timezone_name;

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
    setHtml("daily-exposure-svg", createExposureMapSvg(payload));

    const snapshotStatus = document.getElementById("room-snapshot-status");
    if (snapshotStatus) {
      snapshotStatus.textContent = snapshotStateLabel(snapshot.state);
      snapshotStatus.className = snapshotStateClass(snapshot.state);
    }

    setText("snapshot-window-fact", `Window facing: ${payload.active_window.facing}`);
    setText("snapshot-azimuth-fact", `Azimuth: ${snapshot.azimuth_deg.toFixed(1)}°`);
    setText("snapshot-elevation-fact", `Elevation: ${snapshot.elevation_deg.toFixed(1)}°`);
    setText(
      "daily-exposure-caption",
      `${Math.round(payload.daily.exposure_grid.sunlit_fraction * 100)}% of the room gets some direct sun today. Darker cells mean more direct-sun hours. Peak floor cell: ${payload.daily.exposure_grid.peak_hours.toFixed(1)} h.`
    );
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
        setUpdateStatus(defaultUpdateMessage, "idle");
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
    scheduleRefresh();
  }

  function refreshLocationName() {
    setLocationPreset("custom", { applyPreset: false, openPanel: true, refresh: false });
    scheduleRefresh();
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
      resultTabButtons.forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      resultPanels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.resultPanel === selectedTab);
      });
    });
  });

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
    setUpdateStatus("Finish the current field to update.", "draft");
  });
  timezoneInput.addEventListener("change", refreshTimezone);

  locationNameInput.addEventListener("input", () => {
    setUpdateStatus("Finish the current field to update.", "draft");
  });
  locationNameInput.addEventListener("change", refreshLocationName);

  form.querySelectorAll('input[type="number"]').forEach((input) => {
    if (input === latitudeInput || input === longitudeInput || input === yearInput) {
      return;
    }
    input.addEventListener("input", () => refreshFromNumberField(input));
    input.addEventListener("change", () => refreshFromNumberField(input));
  });

  syncSlidersFromInputs();
  setActiveButtons(locationChipButtons, "locationPreset", locationPresetInput.value);
  setActiveButtons(windowFacingButtons, "windowFacing", windowFacingInput.value);
  if (locationPresetInput.value === "custom") {
    ensureMap();
    invalidateMapSoon();
  }
  updateSnapshotDom(initialData);
  setUpdateStatus(defaultUpdateMessage, "idle");
})();
