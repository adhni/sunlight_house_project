from __future__ import annotations

import base64
import os
from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, render_template, request, url_for

from sunlight_house.analysis import (
    analyze_day,
    analyze_snapshot,
    key_date_daily_positions,
    key_dates,
    sample_positions,
    yearly_peak_series,
)
from sunlight_house.config import Location, SimulationConfig, default_melbourne_scenario, window_on_wall
from sunlight_house.geometry import Room
from sunlight_house.plotting import (
    plot_daily_intensity,
    plot_floor_patches,
    plot_key_date_solar_angles,
    plot_yearly_noon_elevation,
)


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index() -> str:
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}
        error: str | None = None

        try:
            config, selected_moment = build_config_and_moment(raw_values)
            form_values = raw_values
        except ValueError as exc:
            error = f"{exc} Showing Melbourne defaults instead."
            form_values = defaults
            config, selected_moment = build_config_and_moment(form_values)

        snapshot = analyze_snapshot(config, selected_moment)
        daily = analyze_day(config, selected_moment.date(), selected_moment.strftime("%B %d"))
        yearly_times, yearly_positions = yearly_peak_series(config)

        room_plot_uri = figure_data_uri(
            plot_floor_patches,
            config.room,
            config.windows,
            [(selected_moment, snapshot.patches)] if snapshot.patches else [],
            f"Selected time: {selected_moment.strftime('%d %b %Y %H:%M %Z')}",
        )
        daily_intensity_uri = figure_data_uri(
            plot_daily_intensity,
            [dt for dt, _ in daily.positions],
            daily.intensity_series,
            f"{selected_moment.strftime('%d %b %Y')}: window sunlight factor",
        )
        daily_patches_uri = figure_data_uri(
            plot_floor_patches,
            config.room,
            config.windows,
            daily.patches_over_time,
            f"{selected_moment.strftime('%d %b %Y')}: top-down sunlight patches",
        )
        yearly_uri = figure_data_uri(
            plot_yearly_noon_elevation,
            yearly_times,
            yearly_positions,
            key_dates(config),
            f"{config.location.name} {config.year}: daily peak solar elevation",
        )
        key_dates_uri = figure_data_uri(
            plot_key_date_solar_angles,
            key_date_daily_positions(config),
            f"{config.location.name} {config.year}: seasonal solar angle comparison",
        )

        strongest_window, strongest_intensity = snapshot.strongest_window
        sample_rows = [
            {
                "label": dt.strftime("%d %b %Y %H:%M %Z"),
                "elevation": position.elevation_deg,
                "azimuth": position.azimuth_deg,
                "vector": vector,
            }
            for dt, position, vector in sample_positions(config)
        ]

        preset_urls = {
            "Winter solstice": url_for("index", **(defaults | {"selected_date": f"{config.year}-06-21", "selected_time": "12:00"})),
            "Summer solstice": url_for("index", **(defaults | {"selected_date": f"{config.year}-12-21", "selected_time": "12:00"})),
            "Equinox": url_for("index", **(defaults | {"selected_date": f"{config.year}-03-20", "selected_time": "12:00"})),
        }

        return render_template(
            "index.html",
            error=error,
            form_values=form_values,
            preset_urls=preset_urls,
            snapshot=snapshot,
            daily=daily,
            strongest_window=strongest_window,
            strongest_intensity=strongest_intensity,
            room_plot_uri=room_plot_uri,
            daily_intensity_uri=daily_intensity_uri,
            daily_patches_uri=daily_patches_uri,
            yearly_uri=yearly_uri,
            key_dates_uri=key_dates_uri,
            sample_rows=sample_rows,
            window_wall_description=window_axis_description(form_values["window_wall"]),
            initial_snapshot_payload=snapshot_payload(config, selected_moment),
        )

    @app.get("/api/snapshot")
    def api_snapshot():
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}

        try:
            config, selected_moment = build_config_and_moment(raw_values)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify(snapshot_payload(config, selected_moment))

    @app.get("/healthz")
    def healthz() -> tuple[str, int]:
        return "ok", 200

    return app


def default_form_values() -> dict[str, str]:
    scenario = default_melbourne_scenario()
    room = scenario.room
    window = scenario.windows[0]
    return {
        "location_name": scenario.location.name,
        "latitude": f"{scenario.location.latitude}",
        "longitude": f"{scenario.location.longitude}",
        "timezone_name": scenario.location.timezone_name,
        "year": str(scenario.year),
        "selected_date": f"{scenario.year}-06-21",
        "selected_time": "12:00",
        "room_width": f"{room.width}",
        "room_depth": f"{room.depth}",
        "room_height": f"{room.height}",
        "window_name": window.name,
        "window_wall": "north",
        "window_span_center": "3.0",
        "window_center_height": "1.5",
        "window_width": f"{window.width}",
        "window_height": f"{window.height}",
        "day_step_minutes": str(scenario.day_step_minutes),
        "year_step_hours": str(scenario.year_step_hours),
    }


def build_config_and_moment(form_values: dict[str, str]) -> tuple[SimulationConfig, datetime]:
    timezone_name = form_values["timezone_name"].strip()
    ZoneInfo(timezone_name)

    room = Room(
        width=parse_positive_float(form_values["room_width"], "Room width"),
        depth=parse_positive_float(form_values["room_depth"], "Room depth"),
        height=parse_positive_float(form_values["room_height"], "Room height"),
    )
    window = window_on_wall(
        name=form_values["window_name"].strip() or "window",
        room=room,
        wall=form_values["window_wall"].strip().lower(),
        span_center=parse_float(form_values["window_span_center"], "Window span center"),
        center_height=parse_float(form_values["window_center_height"], "Window center height"),
        width=parse_positive_float(form_values["window_width"], "Window width"),
        height=parse_positive_float(form_values["window_height"], "Window height"),
    )

    year = int(parse_positive_float(form_values["year"], "Simulation year"))
    config = SimulationConfig(
        location=Location(
            name=form_values["location_name"].strip() or "Custom location",
            latitude=parse_float(form_values["latitude"], "Latitude"),
            longitude=parse_float(form_values["longitude"], "Longitude"),
            timezone_name=timezone_name,
        ),
        room=room,
        windows=(window,),
        year=year,
        day_step_minutes=int(parse_positive_float(form_values["day_step_minutes"], "Daily step")),
        year_step_hours=int(parse_positive_float(form_values["year_step_hours"], "Yearly step")),
    )

    selected_date = datetime.strptime(form_values["selected_date"], "%Y-%m-%d").date()
    selected_time = datetime.strptime(form_values["selected_time"], "%H:%M").time()
    moment = datetime.combine(selected_date, selected_time, tzinfo=ZoneInfo(timezone_name))
    return config, moment


def parse_float(raw_value: str, label: str) -> float:
    try:
        return float(raw_value)
    except ValueError as exc:
        raise ValueError(f"{label} must be a number.") from exc


def parse_positive_float(raw_value: str, label: str) -> float:
    value = parse_float(raw_value, label)
    if value <= 0.0:
        raise ValueError(f"{label} must be positive.")
    return value


def figure_data_uri(plotter, *plot_args) -> str:
    buffer = BytesIO()
    plotter(*plot_args, output_path=buffer)
    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def snapshot_payload(config: SimulationConfig, selected_moment: datetime) -> dict[str, object]:
    snapshot = analyze_snapshot(config, selected_moment)
    daily = analyze_day(config, selected_moment.date(), selected_moment.strftime("%B %d"))
    strongest_window, strongest_intensity = snapshot.strongest_window
    active_window = config.windows[0]
    active_window_wall = wall_name_for_window(active_window)
    state = snapshot_state(snapshot.entered_direct_sun, strongest_intensity)

    return {
        "location": {
            "name": config.location.name,
            "latitude": config.location.latitude,
            "longitude": config.location.longitude,
            "timezone_name": config.location.timezone_name,
        },
        "selected_moment": selected_moment.isoformat(),
        "snapshot": {
            "elevation_deg": snapshot.position.elevation_deg,
            "azimuth_deg": snapshot.position.azimuth_deg,
            "vector": [float(value) for value in snapshot.vector],
            "entered_direct_sun": snapshot.entered_direct_sun,
            "strongest_window": strongest_window,
            "strongest_intensity": strongest_intensity,
            "state": state,
            "window_intensities": [
                {"name": name, "intensity": intensity} for name, intensity in snapshot.window_intensities.items()
            ],
            "patches": [
                {
                    "window_name": patch.window_name,
                    "intensity": patch.intensity,
                    "polygon_xy": patch.polygon_xy.tolist(),
                }
                for patch in snapshot.patches
            ],
        },
        "daily": {
            "entered_direct_sun": daily.entered_direct_sun,
            "peak_window_name": daily.peak_window_name,
            "peak_intensity": daily.peak_intensity,
            "peak_time": daily.peak_time.isoformat() if daily.peak_time else None,
        },
        "room": {
            "width": config.room.width,
            "depth": config.room.depth,
            "height": config.room.height,
        },
        "windows": [
            {
                "name": window.name,
                "wall": wall_name_for_window(window),
                "wall_segment_xy": window.wall_segment_xy().tolist(),
            }
            for window in config.windows
        ],
        "active_window": {
            "name": active_window.name,
            "wall": active_window_wall,
        },
    }


def window_axis_description(wall: str) -> str:
    wall_name = wall.lower()
    if wall_name in {"north", "south"}:
        return "Horizontal center measured along the wall in x (east-west, metres)."
    return "Horizontal center measured along the wall in y (south-north, metres)."


def wall_name_for_window(window) -> str:
    normal = tuple(round(float(value), 3) for value in window.outward_normal)
    mapping = {
        (0.0, 1.0, 0.0): "north",
        (0.0, -1.0, 0.0): "south",
        (1.0, 0.0, 0.0): "east",
        (-1.0, 0.0, 0.0): "west",
    }
    return mapping.get(normal, "unknown")


def snapshot_state(has_patch: bool, strongest_intensity: float) -> str:
    if has_patch:
        return "floor_hit"
    if strongest_intensity > 0.0:
        return "through_window_no_floor_hit"
    return "behind_window"


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
