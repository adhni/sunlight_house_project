(function () {
  const YEAR = 2025;
  const LOCATIONS = {
    melbourne: {
      label: "Melbourne",
      latitude: -37.8136,
      longitude: 144.9631,
      timezone: "Australia/Melbourne",
      dataUrl: "/static/env/melbourne-2025.json",
    },
    jakarta: {
      label: "Jakarta",
      latitude: -6.2088,
      longitude: 106.8456,
      timezone: "Asia/Jakarta",
      dataUrl: "/static/env/jakarta-2025.json",
    },
    boston: {
      label: "Boston",
      latitude: 42.3601,
      longitude: -71.0589,
      timezone: "America/New_York",
      dataUrl: "/static/env/boston-2025.json",
    },
  };
  const loadedData = new Map();
  const pendingRequests = new Map();

  function timeKeyFromHourIndex(index) {
    const date = new Date(Date.UTC(YEAR, 0, 1, index));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:00`;
  }

  function expandCompactData(compact) {
    const hourly = (compact.values || []).map((row, index) => ({
      time: timeKeyFromHourIndex(index),
      tempC: row[0],
      uvIndex: row[1],
      solarRadiation: row[2],
    }));
    return {
      meta: compact.meta,
      hourly,
    };
  }

  async function fetchEnvironmentData(locationKey = "melbourne") {
    const location = LOCATIONS[locationKey];
    if (!location) {
      throw new Error(`Unsupported environment location: ${locationKey}`);
    }

    if (loadedData.has(locationKey)) {
      return loadedData.get(locationKey);
    }

    if (pendingRequests.has(locationKey)) {
      return pendingRequests.get(locationKey);
    }

    const request = fetch(location.dataUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Static environment data request failed.");
        }
        const compact = await response.json();
        if (compact.meta?.year !== YEAR || !Array.isArray(compact.values)) {
          throw new Error("Static environment data has an unexpected shape.");
        }
        const data = expandCompactData(compact);
        loadedData.set(locationKey, data);
        return data;
      })
      .finally(() => {
        pendingRequests.delete(locationKey);
      });

    pendingRequests.set(locationKey, request);
    return request;
  }

  window.environmentLocations = LOCATIONS;
  window.fetchEnvironmentData = fetchEnvironmentData;
})();
