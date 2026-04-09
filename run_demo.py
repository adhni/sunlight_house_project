from __future__ import annotations

from datetime import date
from pathlib import Path

from sunlight_house.analysis import analyze_day, key_date_daily_positions, key_dates, sample_positions, slugify, yearly_peak_series
from sunlight_house.config import default_melbourne_scenario
from sunlight_house.plotting import plot_daily_intensity, plot_floor_patches, plot_key_date_solar_angles, plot_yearly_noon_elevation


def summarize_sample_positions() -> None:
    config = default_melbourne_scenario()
    print(f"Sample solar positions for {config.location.name}")
    print("-" * 88)
    for dt, position, vector in sample_positions(config):
        print(
            f"{dt.strftime('%Y-%m-%d %H:%M %Z')}: "
            f"elevation={position.elevation_deg:6.2f} deg, "
            f"azimuth={position.azimuth_deg:6.2f} deg, "
            f"sun_vector=({vector[0]: .3f}, {vector[1]: .3f}, {vector[2]: .3f})"
        )
    print()


def build_daily_outputs(target_date: date, label: str, output_dir: Path) -> tuple[Path, Path]:
    config = default_melbourne_scenario()
    daily = analyze_day(config, target_date, label)

    intensity_path = output_dir / f"{slugify(label)}_intensity.png"
    patches_path = output_dir / f"{slugify(label)}_patches.png"

    plot_daily_intensity(
        [dt for dt, _ in daily.positions],
        daily.intensity_series,
        title=f"{label}: window sunlight factor every {config.day_step_minutes} minutes",
        output_path=intensity_path,
    )
    plot_floor_patches(
        config.room,
        config.windows,
        daily.patches_over_time,
        title=f"{label}: top-down floor sunlight patches",
        output_path=patches_path,
    )

    if daily.peak_time is not None:
        print(
            f"{label}: direct sunlight entered=yes, "
            f"peak window={daily.peak_window_name}, "
            f"peak factor={daily.peak_intensity:.3f} at {daily.peak_time.strftime('%H:%M %Z')}"
        )
    else:
        print(f"{label}: direct sunlight entered=no")

    return intensity_path, patches_path


def build_yearly_outputs(output_dir: Path) -> tuple[Path, Path]:
    config = default_melbourne_scenario()
    yearly_path = output_dir / "melbourne_yearly_noon_elevation.png"
    key_date_path = output_dir / "melbourne_key_dates_solar_angles.png"

    times, positions = yearly_peak_series(config)
    plot_yearly_noon_elevation(
        times,
        positions,
        key_dates(config),
        title=f"{config.location.name} {config.year}: daily peak solar elevation from hourly simulation",
        output_path=yearly_path,
    )
    plot_key_date_solar_angles(
        key_date_daily_positions(config),
        title=f"{config.location.name} {config.year}: daily solar angles on key seasonal dates",
        output_path=key_date_path,
    )
    return yearly_path, key_date_path


def main() -> None:
    config = default_melbourne_scenario()
    output_dir = Path("outputs")
    output_dir.mkdir(exist_ok=True)

    summarize_sample_positions()

    june_outputs = build_daily_outputs(
        date(config.year, 6, 21),
        "June 21 Winter Solstice",
        output_dir,
    )
    december_outputs = build_daily_outputs(
        date(config.year, 12, 21),
        "December 21 Summer Solstice",
        output_dir,
    )
    print()

    yearly_outputs = build_yearly_outputs(output_dir)

    generated_files = sorted({path for path in (*june_outputs, *december_outputs, *yearly_outputs)})
    print("Generated files:")
    for path in generated_files:
        print(f"- {path}")


if __name__ == "__main__":
    main()
