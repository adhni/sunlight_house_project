from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from sunlight_house import generate_day_positions, generate_year_hourly_positions, get_sun_position, sun_vector
from sunlight_house.config import SimulationConfig, default_melbourne_scenario
from sunlight_house.geometry import SunlightPatch, intersects_window, patches_for_windows
from sunlight_house.plotting import plot_daily_intensity, plot_floor_patches, plot_key_date_solar_angles, plot_yearly_noon_elevation


@dataclass(frozen=True)
class DailySummary:
    label: str
    entered_direct_sun: bool
    peak_intensity: float
    peak_time: datetime | None
    output_files: tuple[Path, ...]


def _slugify(text: str) -> str:
    return text.lower().replace(",", "").replace(" ", "_")


def _local_datetime(config: SimulationConfig, month: int, day: int, hour: int = 12, minute: int = 0) -> datetime:
    tz = ZoneInfo(config.location.timezone_name)
    return datetime(config.year, month, day, hour, minute, tzinfo=tz)


def key_dates(config: SimulationConfig) -> dict[str, datetime]:
    return {
        "Autumn equinox": _local_datetime(config, 3, 20),
        "Winter solstice": _local_datetime(config, 6, 21),
        "Spring equinox": _local_datetime(config, 9, 22),
        "Summer solstice": _local_datetime(config, 12, 21),
    }


def summarize_sample_positions(config: SimulationConfig) -> None:
    tz = ZoneInfo(config.location.timezone_name)
    sample_times = [
        datetime(config.year, 6, 21, 9, 0, tzinfo=tz),
        datetime(config.year, 6, 21, 12, 0, tzinfo=tz),
        datetime(config.year, 12, 21, 9, 0, tzinfo=tz),
        datetime(config.year, 12, 21, 12, 0, tzinfo=tz),
        datetime(config.year, 3, 20, 12, 0, tzinfo=tz),
        datetime(config.year, 9, 22, 12, 0, tzinfo=tz),
    ]

    print(f"Sample solar positions for {config.location.name}")
    print("-" * 88)
    for dt in sample_times:
        pos = get_sun_position(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            dt,
        )
        vec = sun_vector(pos.elevation_deg, pos.azimuth_deg)
        print(
            f"{dt.strftime('%Y-%m-%d %H:%M %Z')}: "
            f"elevation={pos.elevation_deg:6.2f} deg, "
            f"azimuth={pos.azimuth_deg:6.2f} deg, "
            f"sun_vector=({vec[0]: .3f}, {vec[1]: .3f}, {vec[2]: .3f})"
        )
    print()


def _window_intensity_series(config: SimulationConfig, positions: list[tuple[datetime, object]]) -> dict[str, list[float]]:
    series: dict[str, list[float]] = {window.name: [] for window in config.windows}
    for _, pos in positions:
        vec = sun_vector(pos.elevation_deg, pos.azimuth_deg)
        for window in config.windows:
            series[window.name].append(intersects_window(vec, window.outward_normal))
    return series


def _patches_for_plot(
    config: SimulationConfig,
    positions: list[tuple[datetime, object]],
    *,
    sample_minutes: int = 60,
) -> list[tuple[datetime, list[SunlightPatch]]]:
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]] = []
    for dt, pos in positions:
        if dt.minute % sample_minutes != 0:
            continue
        vec = sun_vector(pos.elevation_deg, pos.azimuth_deg)
        patches = patches_for_windows(config.room, config.windows, vec)
        if patches:
            patches_over_time.append((dt, patches))
    return patches_over_time


def build_daily_outputs(config: SimulationConfig, target_date: date, label: str, output_dir: Path) -> DailySummary:
    positions = generate_day_positions(
        config.location.latitude,
        config.location.longitude,
        config.location.timezone_name,
        datetime.combine(target_date, time.min),
        step_minutes=config.day_step_minutes,
    )
    intensity_series = _window_intensity_series(config, positions)
    patches_over_time = _patches_for_plot(config, positions)

    peak_window_name = ""
    peak_intensity = 0.0
    peak_time: datetime | None = None
    for window_name, values in intensity_series.items():
        if not values:
            continue
        idx = int(np.argmax(values))
        if values[idx] > peak_intensity:
            peak_intensity = values[idx]
            peak_time = positions[idx][0]
            peak_window_name = window_name

    intensity_path = output_dir / f"{_slugify(label)}_intensity.png"
    patches_path = output_dir / f"{_slugify(label)}_patches.png"

    plot_daily_intensity(
        [dt for dt, _ in positions],
        intensity_series,
        title=f"{label}: window sunlight factor every {config.day_step_minutes} minutes",
        output_path=str(intensity_path),
    )
    plot_floor_patches(
        config.room,
        config.windows,
        patches_over_time,
        title=f"{label}: top-down floor sunlight patches",
        output_path=str(patches_path),
    )

    if peak_time is not None:
        print(
            f"{label}: direct sunlight entered={'yes' if peak_intensity > 0 else 'no'}, "
            f"peak window={peak_window_name}, "
            f"peak factor={peak_intensity:.3f} at {peak_time.strftime('%H:%M %Z')}"
        )
    else:
        print(f"{label}: direct sunlight entered=no")

    return DailySummary(
        label=label,
        entered_direct_sun=peak_intensity > 0,
        peak_intensity=peak_intensity,
        peak_time=peak_time,
        output_files=(intensity_path, patches_path),
    )


def build_yearly_outputs(config: SimulationConfig, output_dir: Path) -> tuple[Path, Path]:
    hourly_positions = generate_year_hourly_positions(
        config.location.latitude,
        config.location.longitude,
        config.location.timezone_name,
        config.year,
        step_hours=config.year_step_hours,
    )

    daily_best: dict[tuple[int, int, int], tuple[datetime, object]] = {}
    for dt, pos in hourly_positions:
        key = (dt.year, dt.month, dt.day)
        if key not in daily_best or pos.elevation_deg > daily_best[key][1].elevation_deg:
            daily_best[key] = (dt, pos)

    times = [daily_best[key][0] for key in sorted(daily_best)]
    positions = [daily_best[key][1] for key in sorted(daily_best)]
    yearly_path = output_dir / "melbourne_yearly_noon_elevation.png"

    plot_yearly_noon_elevation(
        times,
        positions,
        key_dates(config),
        title=f"{config.location.name} {config.year}: daily peak solar elevation from hourly simulation",
        output_path=str(yearly_path),
    )

    daily_key_positions = {
        label: generate_day_positions(
            config.location.latitude,
            config.location.longitude,
            config.location.timezone_name,
            dt,
            step_minutes=config.day_step_minutes,
        )
        for label, dt in {
            "Summer solstice": _local_datetime(config, 12, 21),
            "Equinox": _local_datetime(config, 3, 20),
            "Winter solstice": _local_datetime(config, 6, 21),
        }.items()
    }
    key_date_path = output_dir / "melbourne_key_dates_solar_angles.png"
    plot_key_date_solar_angles(
        daily_key_positions,
        title=f"{config.location.name} {config.year}: daily solar angles on key seasonal dates",
        output_path=str(key_date_path),
    )

    return yearly_path, key_date_path


def main() -> None:
    config = default_melbourne_scenario()
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)

    summarize_sample_positions(config)

    june_summary = build_daily_outputs(
        config,
        date(config.year, 6, 21),
        "June 21 Winter Solstice",
        output_dir,
    )
    december_summary = build_daily_outputs(
        config,
        date(config.year, 12, 21),
        "December 21 Summer Solstice",
        output_dir,
    )
    print()

    yearly_outputs = build_yearly_outputs(config, output_dir)

    generated_files = sorted({path for path in (*june_summary.output_files, *december_summary.output_files, *yearly_outputs)})
    print("Generated files:")
    for path in generated_files:
        print(f"- {path}")


if __name__ == "__main__":
    main()
