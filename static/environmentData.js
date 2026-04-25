(function () {
  const YEAR = 2025;
  const CACHE_VERSION = "v1";
  const PARAMETERS = "T2M,ALLSKY_SFC_UV_INDEX,ALLSKY_SFC_SW_DWN";
  const LOCATIONS = {
    melbourne: {
      label: "Melbourne",
      latitude: -37.8136,
      longitude: 144.9631,
      timezone: "Australia/Melbourne",
    },
    jakarta: {
      label: "Jakarta",
      latitude: -6.2088,
      longitude: 106.8456,
      timezone: "Asia/Jakarta",
    },
    boston: {
      label: "Boston",
      latitude: 42.3601,
      longitude: -71.0589,
      timezone: "America/New_York",
    },
  };
  const pendingRequests = new Map();

  function cacheKey(locationKey) {
    return `env_${locationKey}_${YEAR}_${CACHE_VERSION}`;
  }

  function readCache(locationKey) {
    try {
      const raw = window.localStorage.getItem(cacheKey(locationKey));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.meta?.year !== YEAR || !Array.isArray(parsed.hourly)) {
        return null;
      }
      return parsed;
    } catch (error) {
      console.warn("Could not read cached environment data.", error);
      return null;
    }
  }

  function writeCache(locationKey, data) {
    try {
      window.localStorage.setItem(cacheKey(locationKey), JSON.stringify(data));
    } catch (error) {
      console.warn("Could not cache environment data.", error);
    }
  }

  function powerUrl(location) {
    const params = new URLSearchParams({
      parameters: PARAMETERS,
      community: "RE",
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      start: `${YEAR}0101`,
      end: `${YEAR}1231`,
      format: "JSON",
    });
    return `https://power.larc.nasa.gov/api/temporal/hourly/point?${params.toString()}`;
  }

  function parsePowerHourKey(key) {
    const text = String(key);
    if (!/^\d{10}$/.test(text)) {
      return null;
    }
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:00`;
  }

  function cleanNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= -900) {
      return null;
    }
    return number;
  }

  function parseEnvironmentResponse(payload, locationKey) {
    const location = LOCATIONS[locationKey];
    const parameters = payload?.properties?.parameter || {};
    const temperatures = parameters.T2M || {};
    const uvIndexes = parameters.ALLSKY_SFC_UV_INDEX || {};
    const solarRadiation = parameters.ALLSKY_SFC_SW_DWN || {};

    const hourly = Object.keys(temperatures)
      .sort()
      .map((key) => {
        const time = parsePowerHourKey(key);
        if (!time) {
          return null;
        }
        return {
          time,
          tempC: cleanNumber(temperatures[key]),
          uvIndex: cleanNumber(uvIndexes[key]),
          solarRadiation: cleanNumber(solarRadiation[key]),
        };
      })
      .filter(Boolean);

    return {
      meta: {
        locationKey,
        locationName: location.label,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
        year: YEAR,
        cadence: "hourly",
        source: "NASA POWER",
        fetchedAt: new Date().toISOString(),
      },
      hourly,
    };
  }

  async function fetchEnvironmentData(locationKey = "melbourne") {
    const location = LOCATIONS[locationKey];
    if (!location) {
      throw new Error(`Unsupported environment location: ${locationKey}`);
    }

    const cached = readCache(locationKey);
    if (cached) {
      return cached;
    }

    if (pendingRequests.has(locationKey)) {
      return pendingRequests.get(locationKey);
    }

    const request = fetch(powerUrl(location))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("NASA POWER environment request failed.");
        }
        const payload = await response.json();
        const data = parseEnvironmentResponse(payload, locationKey);
        if (!data.hourly.length) {
          throw new Error("NASA POWER environment response had no hourly data.");
        }
        writeCache(locationKey, data);
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
