from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import acos, asin, atan2, cos, degrees, radians, sin, tan
from zoneinfo import ZoneInfo

import numpy as np


@dataclass(frozen=True)
class SunPosition:
    elevation_deg: float
    azimuth_deg: float


def _localize_datetime(dt: datetime, timezone_name: str) -> datetime:
    tz = ZoneInfo(timezone_name)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _julian_day(dt_utc: datetime) -> float:
    """Return Julian Day for a timezone-aware UTC datetime."""
    year = dt_utc.year
    month = dt_utc.month
    day = dt_utc.day
    hour = dt_utc.hour + dt_utc.minute / 60 + dt_utc.second / 3600 + dt_utc.microsecond / 3_600_000_000

    if month <= 2:
        year -= 1
        month += 12

    a = year // 100
    b = 2 - a + (a // 4)
    jd = int(365.25 * (year + 4716)) + int(30.6001 * (month + 1)) + day + b - 1524.5
    jd += hour / 24.0
    return jd


def get_sun_position(latitude: float, longitude: float, timezone_name: str, dt: datetime) -> SunPosition:
    """
    Compute solar elevation and azimuth using a NOAA-style solar position method.

    Parameters
    ----------
    latitude, longitude
        Geographic coordinates in degrees. Longitude is positive east.
    timezone_name
        IANA timezone string such as 'Australia/Melbourne'.
    dt
        Datetime in local time. If naive, it is interpreted in timezone_name.

    Returns
    -------
    SunPosition
        elevation and azimuth in degrees, where azimuth is measured clockwise from north.
    """
    local_dt = _localize_datetime(dt, timezone_name)

    dt_utc = local_dt.astimezone(timezone.utc)
    jd = _julian_day(dt_utc)
    t = (jd - 2451545.0) / 36525.0

    # Geometric solar parameters.
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.0
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

    c = (
        sin(radians(m)) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + sin(radians(2 * m)) * (0.019993 - 0.000101 * t)
        + sin(radians(3 * m)) * 0.000289
    )
    true_long = l0 + c
    omega = 125.04 - 1934.136 * t
    lambda_sun = true_long - 0.00569 - 0.00478 * sin(radians(omega))

    epsilon0 = 23.0 + (26.0 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0)) / 60.0
    epsilon = epsilon0 + 0.00256 * cos(radians(omega))

    decl = degrees(asin(sin(radians(epsilon)) * sin(radians(lambda_sun))))

    y = tan(radians(epsilon / 2.0)) ** 2
    eq_time = 4.0 * degrees(
        y * sin(2 * radians(l0))
        - 2 * e * sin(radians(m))
        + 4 * e * y * sin(radians(m)) * cos(2 * radians(l0))
        - 0.5 * y * y * sin(4 * radians(l0))
        - 1.25 * e * e * sin(2 * radians(m))
    )

    local_midnight = local_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    minutes_since_midnight = (local_dt - local_midnight).total_seconds() / 60.0
    utc_offset_hours = local_dt.utcoffset().total_seconds() / 3600.0
    time_offset = eq_time + 4.0 * longitude - 60.0 * utc_offset_hours
    true_solar_time = (minutes_since_midnight + time_offset) % 1440.0

    if true_solar_time / 4.0 < 0:
        hour_angle = true_solar_time / 4.0 + 180.0
    else:
        hour_angle = true_solar_time / 4.0 - 180.0

    lat_rad = radians(latitude)
    decl_rad = radians(decl)
    ha_rad = radians(hour_angle)

    cos_zenith = sin(lat_rad) * sin(decl_rad) + cos(lat_rad) * cos(decl_rad) * cos(ha_rad)
    cos_zenith = float(np.clip(cos_zenith, -1.0, 1.0))
    zenith = degrees(acos(cos_zenith))
    elevation = 90.0 - zenith

    azimuth = degrees(
        atan2(
            sin(ha_rad),
            cos(ha_rad) * sin(lat_rad) - tan(decl_rad) * cos(lat_rad),
        )
    )
    azimuth = (azimuth + 180.0) % 360.0

    return SunPosition(elevation_deg=elevation, azimuth_deg=azimuth)


def sun_vector(elevation_deg: float, azimuth_deg: float) -> np.ndarray:
    """Convert solar elevation and azimuth to a unit vector in ENU coordinates.

    x -> east, y -> north, z -> up.
    Azimuth is measured clockwise from north.
    """
    el = radians(elevation_deg)
    az = radians(azimuth_deg)
    x = cos(el) * sin(az)
    y = cos(el) * cos(az)
    z = sin(el)
    vec = np.array([x, y, z], dtype=float)
    norm = np.linalg.norm(vec)
    if norm == 0:
        return vec
    return vec / norm


def generate_day_positions(
    latitude: float,
    longitude: float,
    timezone_name: str,
    date_local: datetime,
    step_minutes: int = 10,
) -> list[tuple[datetime, SunPosition]]:
    """Generate solar positions every `step_minutes` for a given local date."""
    if step_minutes <= 0:
        raise ValueError("step_minutes must be positive.")

    current = _localize_datetime(date_local, timezone_name).replace(hour=0, minute=0, second=0, microsecond=0)

    out: list[tuple[datetime, SunPosition]] = []
    for i in range(int(24 * 60 / step_minutes)):
        dt = current + timedelta(minutes=i * step_minutes)
        out.append((dt, get_sun_position(latitude, longitude, timezone_name, dt)))
    return out


def generate_year_hourly_positions(
    latitude: float,
    longitude: float,
    timezone_name: str,
    year: int,
    step_hours: int = 1,
) -> list[tuple[datetime, SunPosition]]:
    """Generate solar positions hourly (or every `step_hours`) for a full year."""
    if step_hours <= 0:
        raise ValueError("step_hours must be positive.")

    tz = ZoneInfo(timezone_name)
    current = datetime(year, 1, 1, 0, 0, tzinfo=tz)
    out: list[tuple[datetime, SunPosition]] = []
    while current.year == year:
        out.append((current, get_sun_position(latitude, longitude, timezone_name, current)))
        current += timedelta(hours=step_hours)
    return out


def generate_year_positions(
    latitude: float,
    longitude: float,
    timezone_name: str,
    year: int,
    hour: int = 12,
) -> list[tuple[datetime, SunPosition]]:
    """Generate one solar position per day at a fixed local hour for a full year."""
    tz = ZoneInfo(timezone_name)
    start = datetime(year, 1, 1, hour, 0, tzinfo=tz)
    out: list[tuple[datetime, SunPosition]] = []
    current = start
    while current.year == year:
        out.append((current, get_sun_position(latitude, longitude, timezone_name, current)))
        current += timedelta(days=1)
    return out
