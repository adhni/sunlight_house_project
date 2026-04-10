from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import numpy as np

from .config import SimulationConfig
from .geometry import SunlightPatch, intersects_window, patches_for_windows
from .solar import SunPosition, generate_day_positions, generate_year_hourly_positions, get_sun_position, sun_vector


@dataclass(frozen=True)
class DailyAnalysis:
    label: str
    target_date: date
    positions: list[tuple[datetime, SunPosition]]
    intensity_series: dict[str, list[float]]
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]]
    peak_window_name: str
    peak_intensity: float
    peak_time: datetime | None

    @property
    def entered_direct_sun(self) -> bool:
        return self.peak_intensity > 0.0


@dataclass(frozen=True)
class SnapshotAnalysis:
    moment: datetime
    position: SunPosition
    vector: np.ndarray
    room_vector: np.ndarray
    window_intensities: dict[str, float]
    patches: list[SunlightPatch]

    @property
    def entered_direct_sun(self) -> bool:
        return bool(self.patches)

    @property
    def strongest_window(self) -> tuple[str, float]:
        if not self.window_intensities:
            return "", 0.0
        window_name = max(self.window_intensities, key=self.window_intensities.get)
        return window_name, self.window_intensities[window_name]


def slugify(text: str) -> str:
    return text.lower().replace(",", "").replace(" ", "_")


def local_datetime(config: SimulationConfig, month: int, day: int, hour: int = 12, minute: int = 0) -> datetime:
    tz = ZoneInfo(config.location.timezone_name)
    return datetime(config.year, month, day, hour, minute, tzinfo=tz)


def key_dates(config: SimulationConfig) -> dict[str, datetime]:
    return {
        "Autumn equinox": local_datetime(config, 3, 20),
        "Winter solstice": local_datetime(config, 6, 21),
        "Spring equinox": local_datetime(config, 9, 22),
        "Summer solstice": local_datetime(config, 12, 21),
    }


def room_relative_azimuth(config: SimulationConfig, world_azimuth_deg: float) -> float:
    return (world_azimuth_deg - config.window_facing_deg) % 360.0


def room_sun_vector(config: SimulationConfig, position: SunPosition) -> np.ndarray:
    return sun_vector(position.elevation_deg, room_relative_azimuth(config, position.azimuth_deg))


def sample_positions(config: SimulationConfig) -> list[tuple[datetime, SunPosition, np.ndarray]]:
    tz = ZoneInfo(config.location.timezone_name)
    sample_times = [
        datetime(config.year, 6, 21, 9, 0, tzinfo=tz),
        datetime(config.year, 6, 21, 12, 0, tzinfo=tz),
        datetime(config.year, 12, 21, 9, 0, tzinfo=tz),
        datetime(config.year, 12, 21, 12, 0, tzinfo=tz),
        datetime(config.year, 3, 20, 12, 0, tzinfo=tz),
        datetime(config.year, 9, 22, 12, 0, tzinfo=tz),
    ]
    samples: list[tuple[datetime, SunPosition, np.ndarray]] = []
    for dt in sample_times:
        position = get_sun_position(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            dt,
        )
        samples.append((dt, position, sun_vector(position.elevation_deg, position.azimuth_deg)))
    return samples


def day_positions(config: SimulationConfig, target_date: date) -> list[tuple[datetime, SunPosition]]:
    return generate_day_positions(
        config.location.latitude,
        config.location.longitude,
        config.location.timezone_name,
        datetime.combine(target_date, time.min),
        step_minutes=config.day_step_minutes,
    )


def window_intensity_series(
    config: SimulationConfig,
    positions: list[tuple[datetime, SunPosition]],
) -> dict[str, list[float]]:
    series: dict[str, list[float]] = {window.name: [] for window in config.windows}
    for _, position in positions:
        vector = room_sun_vector(config, position)
        for window in config.windows:
            series[window.name].append(intersects_window(vector, window.outward_normal))
    return series


def patches_for_plot(
    config: SimulationConfig,
    positions: list[tuple[datetime, SunPosition]],
    *,
    sample_minutes: int = 60,
) -> list[tuple[datetime, list[SunlightPatch]]]:
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]] = []
    for dt, position in positions:
        if dt.minute % sample_minutes != 0:
            continue
        vector = room_sun_vector(config, position)
        patches = patches_for_windows(config.room, config.windows, vector)
        if patches:
            patches_over_time.append((dt, patches))
    return patches_over_time


def point_in_polygon(point_xy: np.ndarray, polygon_xy: np.ndarray) -> bool:
    x, y = float(point_xy[0]), float(point_xy[1])
    inside = False
    total = len(polygon_xy)
    for idx in range(total):
        x1, y1 = polygon_xy[idx]
        x2, y2 = polygon_xy[(idx + 1) % total]
        intersects = ((y1 > y) != (y2 > y)) and (
            x < (x2 - x1) * (y - y1) / ((y2 - y1) if abs(y2 - y1) > 1e-12 else 1e-12) + x1
        )
        if intersects:
            inside = not inside
    return inside


def daily_exposure_grid(
    config: SimulationConfig,
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]],
    *,
    cols: int = 18,
    rows: int = 15,
) -> dict[str, object]:
    return exposure_grid_from_patches(
        config,
        patches_over_time,
        hours_per_sample=config.day_step_minutes / 60.0,
        cols=cols,
        rows=rows,
    )


def exposure_grid_from_patches(
    config: SimulationConfig,
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]],
    *,
    hours_per_sample: float,
    cols: int = 18,
    rows: int = 15,
) -> dict[str, object]:
    values = np.zeros((rows, cols), dtype=float)
    cell_width = config.room.width / cols
    cell_height = config.room.depth / rows

    for row in range(rows):
        for col in range(cols):
            point = np.array([(col + 0.5) * cell_width, (row + 0.5) * cell_height], dtype=float)
            sunlight_hours = 0.0
            for _, patches in patches_over_time:
                if any(point_in_polygon(point, patch.polygon_xy) for patch in patches):
                    sunlight_hours += hours_per_sample
            values[row, col] = sunlight_hours

    return {
        "cols": cols,
        "rows": rows,
        "values": values.tolist(),
        "cell_width": cell_width,
        "cell_height": cell_height,
        "sunlit_fraction": float(np.count_nonzero(values > 0.0) / values.size),
        "peak_hours": float(np.max(values)) if values.size else 0.0,
    }


def weighted_exposure_grid_from_patches(
    config: SimulationConfig,
    weighted_patches_over_time: list[tuple[list[SunlightPatch], float]],
    *,
    cols: int = 18,
    rows: int = 15,
) -> dict[str, object]:
    values = np.zeros((rows, cols), dtype=float)
    cell_width = config.room.width / cols
    cell_height = config.room.depth / rows

    for row in range(rows):
        for col in range(cols):
            point = np.array([(col + 0.5) * cell_width, (row + 0.5) * cell_height], dtype=float)
            sunlight_hours = 0.0
            for patches, weighted_hours in weighted_patches_over_time:
                if any(point_in_polygon(point, patch.polygon_xy) for patch in patches):
                    sunlight_hours += weighted_hours
            values[row, col] = sunlight_hours

    return {
        "cols": cols,
        "rows": rows,
        "values": values.tolist(),
        "cell_width": cell_width,
        "cell_height": cell_height,
        "sunlit_fraction": float(np.count_nonzero(values > 0.0) / values.size),
        "peak_hours": float(np.max(values)) if values.size else 0.0,
    }


def patches_for_positions(
    config: SimulationConfig,
    positions: list[tuple[datetime, SunPosition]],
) -> list[tuple[datetime, list[SunlightPatch]]]:
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]] = []
    for dt, position in positions:
        vector = room_sun_vector(config, position)
        patches = patches_for_windows(config.room, config.windows, vector)
        if patches:
            patches_over_time.append((dt, patches))
    return patches_over_time


def representative_days_for_month(year: int, month: int, *, samples_per_month: int = 4) -> list[tuple[date, int]]:
    days_in_month = monthrange(year, month)[1]
    representative_days: list[tuple[date, int]] = []
    for idx in range(samples_per_month):
        start_day = int(idx * days_in_month / samples_per_month) + 1
        end_day = int((idx + 1) * days_in_month / samples_per_month)
        weight_days = end_day - start_day + 1
        representative_day = (start_day + end_day) // 2
        representative_days.append((date(year, month, representative_day), weight_days))
    return representative_days


def daylight_positions_for_day(
    config: SimulationConfig,
    target_date: date,
    *,
    step_minutes: int = 60,
) -> list[tuple[datetime, SunPosition]]:
    return [
        (dt, position)
        for dt, position in generate_day_positions(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            datetime.combine(target_date, time.min),
            step_minutes=step_minutes,
        )
        if position.elevation_deg > 0.0
    ]


def long_range_exposure_grids(config: SimulationConfig) -> dict[str, dict[str, object]]:
    samples_per_month = 8
    representative_days: list[tuple[date, int]] = []
    for month in range(1, 13):
        representative_days.extend(
            representative_days_for_month(config.year, month, samples_per_month=samples_per_month)
        )

    if config.location.latitude >= 0:
        winter_months = {12, 1, 2}
        summer_months = {6, 7, 8}
        fall_months = {9, 10, 11}
        spring_months = {3, 4, 5}
        winter_label = "Dec-Feb"
        summer_label = "Jun-Aug"
        fall_label = "Sep-Nov"
        spring_label = "Mar-May"
    else:
        winter_months = {6, 7, 8}
        summer_months = {12, 1, 2}
        fall_months = {3, 4, 5}
        spring_months = {9, 10, 11}
        winter_label = "Jun-Aug"
        summer_label = "Dec-Feb"
        fall_label = "Mar-May"
        spring_label = "Sep-Nov"

    weighted_samples_by_period: dict[str, list[tuple[list[SunlightPatch], float]]] = {
        "year": [],
        "winter": [],
        "summer": [],
        "fall": [],
        "spring": [],
    }

    for sample_date, weight_days in representative_days:
        daylight_positions = daylight_positions_for_day(config, sample_date, step_minutes=60)
        weighted_hours_per_sample = float(weight_days)
        for _dt, patches in patches_for_positions(config, daylight_positions):
            weighted_samples_by_period["year"].append((patches, weighted_hours_per_sample))
            if sample_date.month in winter_months:
                weighted_samples_by_period["winter"].append((patches, weighted_hours_per_sample))
            if sample_date.month in summer_months:
                weighted_samples_by_period["summer"].append((patches, weighted_hours_per_sample))
            if sample_date.month in fall_months:
                weighted_samples_by_period["fall"].append((patches, weighted_hours_per_sample))
            if sample_date.month in spring_months:
                weighted_samples_by_period["spring"].append((patches, weighted_hours_per_sample))

    period_definitions = {
        "year": (
            "Year",
            f"Estimated direct sun hours across the full year using {samples_per_month} representative days per month and hourly daylight samples",
        ),
        "winter": (
            f"Winter ({winter_label})",
            f"Estimated direct sun hours across winter ({winter_label}) using {samples_per_month} representative days per month and hourly daylight samples",
        ),
        "summer": (
            f"Summer ({summer_label})",
            f"Estimated direct sun hours across summer ({summer_label}) using {samples_per_month} representative days per month and hourly daylight samples",
        ),
        "fall": (
            f"Fall ({fall_label})",
            f"Estimated direct sun hours across fall ({fall_label}) using {samples_per_month} representative days per month and hourly daylight samples",
        ),
        "spring": (
            f"Spring ({spring_label})",
            f"Estimated direct sun hours across spring ({spring_label}) using {samples_per_month} representative days per month and hourly daylight samples",
        ),
    }

    return {
        key: {
            "label": label,
            "description": description,
            "exposure_grid": weighted_exposure_grid_from_patches(
                config,
                weighted_samples_by_period[key],
            ),
        }
        for key, (label, description) in period_definitions.items()
    }


def analyze_day(config: SimulationConfig, target_date: date, label: str) -> DailyAnalysis:
    positions = day_positions(config, target_date)
    intensity_series = window_intensity_series(config, positions)
    sampled_patches = patches_for_plot(config, positions, sample_minutes=config.day_step_minutes)

    peak_window_name = ""
    peak_intensity = 0.0
    peak_time: datetime | None = None
    for window_name, values in intensity_series.items():
        if not values:
            continue
        peak_idx = int(np.argmax(values))
        if values[peak_idx] > peak_intensity:
            peak_window_name = window_name
            peak_intensity = float(values[peak_idx])
            peak_time = positions[peak_idx][0]

    return DailyAnalysis(
        label=label,
        target_date=target_date,
        positions=positions,
        intensity_series=intensity_series,
        patches_over_time=sampled_patches,
        peak_window_name=peak_window_name,
        peak_intensity=peak_intensity,
        peak_time=peak_time,
    )


def analyze_snapshot(config: SimulationConfig, moment: datetime) -> SnapshotAnalysis:
    position = get_sun_position(
        config.location.latitude,
        config.location.longitude,
        config.location.timezone_name,
        moment,
    )
    vector = sun_vector(position.elevation_deg, position.azimuth_deg)
    room_vector = room_sun_vector(config, position)
    window_intensities = {
        window.name: intersects_window(room_vector, window.outward_normal) for window in config.windows
    }
    patches = patches_for_windows(config.room, config.windows, room_vector)
    return SnapshotAnalysis(
        moment=moment,
        position=position,
        vector=vector,
        room_vector=room_vector,
        window_intensities=window_intensities,
        patches=patches,
    )


def yearly_peak_series(config: SimulationConfig) -> tuple[list[datetime], list[SunPosition]]:
    hourly_positions = generate_year_hourly_positions(
        config.location.latitude,
        config.location.longitude,
        config.location.timezone_name,
        config.year,
        step_hours=config.year_step_hours,
    )

    daily_best: dict[tuple[int, int, int], tuple[datetime, SunPosition]] = {}
    for dt, position in hourly_positions:
        key = (dt.year, dt.month, dt.day)
        if key not in daily_best or position.elevation_deg > daily_best[key][1].elevation_deg:
            daily_best[key] = (dt, position)

    times = [daily_best[key][0] for key in sorted(daily_best)]
    positions = [daily_best[key][1] for key in sorted(daily_best)]
    return times, positions


def key_date_daily_positions(config: SimulationConfig) -> dict[str, list[tuple[datetime, SunPosition]]]:
    return {
        "Summer solstice": generate_day_positions(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            local_datetime(config, 12, 21),
            step_minutes=config.day_step_minutes,
        ),
        "Equinox": generate_day_positions(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            local_datetime(config, 3, 20),
            step_minutes=config.day_step_minutes,
        ),
        "Winter solstice": generate_day_positions(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            local_datetime(config, 6, 21),
            step_minutes=config.day_step_minutes,
        ),
    }
