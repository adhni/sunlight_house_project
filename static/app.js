(function () {
  const initialData = JSON.parse(document.getElementById("initial-snapshot-data").textContent);
  const form = document.getElementById("simulation-form");
  const latitudeInput = document.getElementById("latitude-input");
  const longitudeInput = document.getElementById("longitude-input");
  const yearInput = document.getElementById("year-input");
  const selectedDateInput = document.getElementById("selected-date-input");
  const selectedTimeInput = document.getElementById("selected-time-input");
  const windowWallInput = document.getElementById("window-wall-input");
  const daySlider = document.getElementById("day-of-year-slider");
  const timeSlider = document.getElementById("time-of-day-slider");
  const dayReadout = document.getElementById("day-of-year-readout");
  const timeReadout = document.getElementById("time-of-day-readout");
  const mapElement = document.getElementById("location-map");
  const snapshotSection = document.querySelector(".sunlab-stage");

  const map = L.map(mapElement, { zoomControl: true }).setView(
    [parseFloat(latitudeInput.value), parseFloat(longitudeInput.value)],
    5
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const marker = L.marker([parseFloat(latitudeInput.value), parseFloat(longitudeInput.value)], {
    draggable: true,
  }).addTo(map);

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function dayOfYearMax(year) {
    return isLeapYear(year) ? 366 : 365;
  }

  function dayOfYearFromDateString(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    return Math.floor(diff / 86400000);
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

  function syncSlidersFromInputs() {
    const year = parseInt(yearInput.value, 10);
    daySlider.max = String(dayOfYearMax(year));
    daySlider.value = String(dayOfYearFromDateString(selectedDateInput.value));

    const [hours, minutes] = selectedTimeInput.value.split(":").map(Number);
    timeSlider.value = String(hours * 60 + minutes);

    dayReadout.textContent = formatDateReadout(selectedDateInput.value);
    timeReadout.textContent = formatTimeReadout(parseInt(timeSlider.value, 10));
  }

  function syncInputsFromSliders() {
    const year = parseInt(yearInput.value, 10);
    selectedDateInput.value = dateStringFromDayOfYear(year, parseInt(daySlider.value, 10));
    selectedTimeInput.value = formatTimeReadout(parseInt(timeSlider.value, 10));

    dayReadout.textContent = formatDateReadout(selectedDateInput.value);
    timeReadout.textContent = selectedTimeInput.value;
  }

  function windowAxisDescription(wall) {
    if (wall === "north" || wall === "south") {
      return "Horizontal center measured along the wall in x (east-west, metres).";
    }
    return "Horizontal center measured along the wall in y (south-north, metres).";
  }

  function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
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

  function createCompassSvg(azimuthDeg) {
    const radius = 96;
    const center = 120;
    const angleRad = (azimuthDeg - 90) * Math.PI / 180;
    const arrowX = center + radius * Math.cos(angleRad);
    const arrowY = center + radius * Math.sin(angleRad);
    return `
      <svg viewBox="0 0 240 240" role="img" aria-label="Azimuth compass">
        <circle cx="${center}" cy="${center}" r="${radius}" fill="#fff7ea" stroke="#355364" stroke-width="4"></circle>
        <circle cx="${center}" cy="${center}" r="6" fill="#355364"></circle>
        <line x1="${center}" y1="${center}" x2="${arrowX}" y2="${arrowY}" stroke="#c86530" stroke-width="8" stroke-linecap="round"></line>
        <circle cx="${arrowX}" cy="${arrowY}" r="10" fill="#f2c48e" stroke="#8e3b18" stroke-width="3"></circle>
        <text x="${center}" y="28" text-anchor="middle" font-size="18" fill="#1f2732" font-weight="700">N</text>
        <text x="${center}" y="228" text-anchor="middle" font-size="18" fill="#1f2732" font-weight="700">S</text>
        <text x="22" y="${center + 6}" text-anchor="middle" font-size="18" fill="#1f2732" font-weight="700">W</text>
        <text x="218" y="${center + 6}" text-anchor="middle" font-size="18" fill="#1f2732" font-weight="700">E</text>
      </svg>
    `;
  }

  function createElevationSvg(elevationDeg) {
    const clamped = Math.max(0, Math.min(90, elevationDeg));
    const height = 220;
    const fillHeight = 24 + (clamped / 90) * 156;
    const sunY = 196 - (clamped / 90) * 156;
    return `
      <svg viewBox="0 0 240 240" role="img" aria-label="Elevation gauge">
        <rect x="94" y="20" width="52" height="180" rx="26" fill="#fff7ea" stroke="#355364" stroke-width="4"></rect>
        <rect x="98" y="${200 - fillHeight}" width="44" height="${fillHeight}" rx="22" fill="url(#sunGradient)"></rect>
        <circle cx="120" cy="${sunY}" r="16" fill="#f2c48e" stroke="#8e3b18" stroke-width="3"></circle>
        <line x1="70" y1="200" x2="170" y2="200" stroke="#355364" stroke-width="4"></line>
        <text x="188" y="32" font-size="16" fill="#1f2732" font-weight="700">90°</text>
        <text x="188" y="118" font-size="16" fill="#1f2732" font-weight="700">45°</text>
        <text x="188" y="205" font-size="16" fill="#1f2732" font-weight="700">0°</text>
        <defs>
          <linearGradient id="sunGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#f5d486"></stop>
            <stop offset="100%" stop-color="#c86530"></stop>
          </linearGradient>
        </defs>
      </svg>
    `;
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
      const azimuthRad = payload.snapshot.azimuth_deg * Math.PI / 180;
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

    const windowLines = payload.windows.map((windowData) => {
      const [a, b] = windowData.wall_segment_xy;
      const isActive = windowData.name === payload.active_window.name;
      return `<line x1="${a[0]}" y1="${depth - a[1]}" x2="${b[0]}" y2="${depth - b[1]}" stroke="${isActive ? "#2b627a" : "#8ea0ab"}" stroke-width="${isActive ? "0.17" : "0.09"}" stroke-linecap="round"></line>`;
    }).join("");
    const patchPolygons = payload.snapshot.patches.map((patch, index) => {
      const points = patch.polygon_xy.map(mapPoint).join(" ");
      const alpha = Math.max(0.24, Math.min(0.74, patch.intensity));
      return `<polygon points="${points}" fill="rgba(200,101,48,${alpha})" stroke="#8e3b18" stroke-width="0.04"></polygon>`;
    }).join("");
    const noPatch = payload.snapshot.patches.length === 0
      ? `<text x="${width / 2}" y="${depth / 2 + 0.6}" font-size="0.28" text-anchor="middle" fill="#616a68">No direct floor patch</text>`
      : "";
    const rayLines = rays.map(([start, end]) => `
      <line x1="${start[0]}" y1="${depth - start[1]}" x2="${end[0]}" y2="${depth - end[1]}" stroke="#f0b24f" stroke-width="0.06" stroke-linecap="round" stroke-dasharray="0.12 0.08"></line>
    `).join("");
    const sourceMarker = `
      <circle cx="${windowMid[0]}" cy="${depth - windowMid[1]}" r="0.12" fill="#2b627a"></circle>
      <text x="${windowMid[0]}" y="${depth - windowMid[1] - 0.28}" font-size="0.22" text-anchor="middle" fill="#2b627a">${titleCase(payload.active_window.wall)} window</text>
    `;
    const compass = `
      <g transform="translate(0.35,0.45)">
        <circle cx="0.38" cy="0.38" r="0.26" fill="rgba(255,255,255,0.85)" stroke="#1f2732" stroke-width="0.03"></circle>
        <line x1="0.38" y1="0.56" x2="0.38" y2="0.18" stroke="#1f2732" stroke-width="0.03"></line>
        <polygon points="0.38,0.08 0.31,0.22 0.45,0.22" fill="#1f2732"></polygon>
        <text x="0.38" y="-0.03" font-size="0.18" text-anchor="middle" fill="#1f2732">N</text>
      </g>
    `;
    const sourceLegend = `
      <text x="${width - 0.25}" y="${depth - 0.15}" font-size="0.18" text-anchor="end" fill="#616a68">Window → Rays → Floor patch</text>
    `;
    const windowGlow = `
      <line x1="${windowA[0]}" y1="${depth - windowA[1]}" x2="${windowB[0]}" y2="${depth - windowB[1]}" stroke="rgba(240,178,79,0.35)" stroke-width="0.32" stroke-linecap="round"></line>
    `;
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
        ${windowLines}
        ${sourceMarker}
        ${noPatch}
        ${compass}
        ${sourceLegend}
      </svg>
    `;
  }

  function updateSnapshotDom(payload) {
    const snapshot = payload.snapshot;
    const daily = payload.daily;
    const timeZone = payload.location.timezone_name;

    document.getElementById("selected-moment-label").textContent = new Date(payload.selected_moment).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    });
    document.getElementById("snapshot-moment-text").textContent = document.getElementById("selected-moment-label").textContent;
    document.getElementById("live-elevation").textContent = `${snapshot.elevation_deg.toFixed(2)} deg`;
    document.getElementById("live-azimuth").textContent = `${snapshot.azimuth_deg.toFixed(2)} deg`;
    document.getElementById("live-entry").textContent = snapshot.entered_direct_sun ? "Yes" : "No";
    document.getElementById("live-strongest").textContent = snapshot.strongest_window
      ? `${snapshot.strongest_window} (${snapshot.strongest_intensity.toFixed(3)})`
      : "None";
    document.getElementById("live-vector").textContent = `(${snapshot.vector.map((value) => value.toFixed(3)).join(", ")})`;
    document.getElementById("live-daily-peak").textContent = daily.peak_time
      ? `${daily.peak_intensity.toFixed(3)} at ${new Date(daily.peak_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          timeZone,
          timeZoneName: "short",
        })}`
      : "No direct sun";

    const windowList = document.getElementById("live-window-list");
    windowList.innerHTML = snapshot.window_intensities.map((entry) => (
      `<li>${entry.name}: ${entry.intensity.toFixed(3)}</li>`
    )).join("");

    document.getElementById("azimuth-compass").innerHTML = createCompassSvg(snapshot.azimuth_deg);
    document.getElementById("elevation-gauge").innerHTML = createElevationSvg(snapshot.elevation_deg);
    document.getElementById("room-snapshot-svg").innerHTML = createRoomSvg(payload);
    const snapshotStatus = document.getElementById("room-snapshot-status");
    snapshotStatus.textContent = snapshotStateLabel(snapshot.state);
    snapshotStatus.className = snapshotStateClass(snapshot.state);
    document.getElementById("snapshot-window-fact").textContent = `Window: ${titleCase(payload.active_window.wall)} wall`;
    document.getElementById("snapshot-azimuth-fact").textContent = `Azimuth: ${snapshot.azimuth_deg.toFixed(1)}°`;
    document.getElementById("snapshot-elevation-fact").textContent = `Elevation: ${snapshot.elevation_deg.toFixed(1)}°`;
    document.getElementById("live-azimuth-text").textContent = `${snapshot.azimuth_deg.toFixed(2)} deg`;
    document.getElementById("live-elevation-text").textContent = `${snapshot.elevation_deg.toFixed(2)} deg`;
  }

  async function refreshSnapshot() {
    snapshotSection.classList.add("loading-state");
    const params = new URLSearchParams(new FormData(form));
    try {
      const response = await fetch(`/api/snapshot?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Snapshot request failed.");
      }
      updateSnapshotDom(payload);
    } catch (error) {
      console.error(error);
    } finally {
      snapshotSection.classList.remove("loading-state");
    }
  }

  const debouncedRefresh = debounce(refreshSnapshot, 180);

  marker.on("dragend", () => {
    const { lat, lng } = marker.getLatLng();
    latitudeInput.value = lat.toFixed(4);
    longitudeInput.value = lng.toFixed(4);
    debouncedRefresh();
  });

  map.on("click", (event) => {
    marker.setLatLng(event.latlng);
    latitudeInput.value = event.latlng.lat.toFixed(4);
    longitudeInput.value = event.latlng.lng.toFixed(4);
    debouncedRefresh();
  });

  daySlider.addEventListener("input", () => {
    syncInputsFromSliders();
    debouncedRefresh();
  });

  timeSlider.addEventListener("input", () => {
    syncInputsFromSliders();
    debouncedRefresh();
  });

  selectedDateInput.addEventListener("change", () => {
    syncSlidersFromInputs();
    debouncedRefresh();
  });

  selectedTimeInput.addEventListener("change", () => {
    syncSlidersFromInputs();
    debouncedRefresh();
  });

  yearInput.addEventListener("change", () => {
    selectedDateInput.value = dateStringFromDayOfYear(parseInt(yearInput.value, 10), parseInt(daySlider.value, 10));
    syncSlidersFromInputs();
    debouncedRefresh();
  });

  latitudeInput.addEventListener("change", () => {
    marker.setLatLng([parseFloat(latitudeInput.value), parseFloat(longitudeInput.value)]);
    map.panTo(marker.getLatLng());
    debouncedRefresh();
  });

  longitudeInput.addEventListener("change", () => {
    marker.setLatLng([parseFloat(latitudeInput.value), parseFloat(longitudeInput.value)]);
    map.panTo(marker.getLatLng());
    debouncedRefresh();
  });

  windowWallInput.addEventListener("change", () => {
    document.getElementById("window-axis-description").textContent = windowAxisDescription(windowWallInput.value);
    debouncedRefresh();
  });

  form.querySelectorAll("input, select").forEach((input) => {
    if (input === daySlider || input === timeSlider || input === selectedDateInput || input === selectedTimeInput || input === yearInput || input === latitudeInput || input === longitudeInput || input === windowWallInput) {
      return;
    }
    input.addEventListener("change", debouncedRefresh);
  });

  syncSlidersFromInputs();
  updateSnapshotDom(initialData);
})();
