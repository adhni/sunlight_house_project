from __future__ import annotations

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
    values = np.zeros((rows, cols), dtype=float)
    cell_width = config.room.width / cols
    cell_height = config.room.depth / rows
    hours_per_sample = config.day_step_minutes / 60.0

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
