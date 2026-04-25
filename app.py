from __future__ import annotations

import json
import os
from datetime import datetime
from time import perf_counter
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, render_template, request, url_for

_MAX_WINDOWS = 10
_MAX_LOCATION_NAME_LEN = 200
_MAX_ROOM_DIM = 500.0  # metres -- sanity cap to prevent extreme compute

from sunlight_house.analysis import (
    analyze_day,
    analyze_snapshot,
    daily_exposure_grid,
    long_range_exposure_grids,
    room_relative_azimuth,
)
from sunlight_house.config import (
    COMPASS_OPTIONS,
    LOCATION_PRESETS,
    Location,
    SimulationConfig,
    default_location_preset,
    default_melbourne_scenario,
    location_from_preset,
    main_window,
    window_on_wall,
)
from sunlight_house.geometry import Room
from sunlight_house.insights import summarize_direct_sun


def create_app() -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index() -> str:
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}
        error: str | None = None
        safe_values: dict[str, str] | None = None

        try:
            config, selected_moment = build_config_and_moment(raw_values)
            form_values = normalize_form_values(raw_values, config)
            window_override_active = has_window_override(form_values)
        except ValueError as exc:
            error = f"{exc} Keeping your current inputs below; the preview uses the nearest valid values."
            form_values = dict(raw_values)
            safe_values = build_safe_form_values(raw_values, defaults)
            for hidden_key in ("windows_json", "day_step_minutes", "year_step_hours"):
                form_values[hidden_key] = safe_values[hidden_key]
            config, selected_moment = build_config_and_moment(safe_values)
            window_override_active = has_window_override(safe_values)

        snapshot = analyze_snapshot(config, selected_moment)
        daily = analyze_day(config, selected_moment.date(), selected_moment.strftime("%B %d"))

        strongest_window, strongest_intensity = snapshot.strongest_window
        season_base_values = normalize_form_values(safe_values or form_values, config)
        preset_urls = seasonal_preset_urls(season_base_values, config.year)

        return render_template(
            "index.html",
            error=error,
            form_values=form_values,
            preset_urls=preset_urls,
            snapshot=snapshot,
            daily=daily,
            strongest_window=strongest_window,
            strongest_intensity=strongest_intensity,
            initial_snapshot_payload=snapshot_payload(
                config,
                selected_moment,
                window_override_active=window_override_active,
            ),
            location_presets=location_presets_payload(),
            compass_options=[label for label, _ in COMPASS_OPTIONS],
        )

    @app.get("/api/snapshot")
    def api_snapshot():
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}

        try:
            config, selected_moment = build_config_and_moment(raw_values)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify(
            snapshot_payload(
                config,
                selected_moment,
                window_override_active=has_window_override(raw_values),
            )
        )

    @app.get("/api/long-range-exposure")
    def api_long_range_exposure():
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}

        try:
            config, _selected_moment = build_config_and_moment(raw_values)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        started_at = perf_counter()
        payload = long_range_payload(config)
        elapsed_ms = (perf_counter() - started_at) * 1000.0
        app.logger.info(
            "Long-range exposure computed in %.1f ms for %s (%s, %.4f, %.4f), facing %s, room %.1fx%.1fx%.1f",
            elapsed_ms,
            config.location.name,
            config.location.timezone_name,
            config.location.latitude,
            config.location.longitude,
            config.window_facing_label,
            config.room.width,
            config.room.depth,
            config.room.height,
        )
        return jsonify(payload)

    @app.get("/healthz")
    def healthz() -> tuple[str, int]:
        return "ok", 200

    return app


def default_form_values() -> dict[str, str]:
    scenario = default_melbourne_scenario()
    room = scenario.room
    window = scenario.windows[0]
    preset = default_location_preset()
    demo_date = "2026-01-15"
    demo_time = "10:00"
    return {
        "location_preset": preset,
        "location_name": scenario.location.name,
        "latitude": f"{scenario.location.latitude}",
        "longitude": f"{scenario.location.longitude}",
        "timezone_name": scenario.location.timezone_name,
        "year": demo_date[:4],
        "selected_date": demo_date,
        "selected_time": demo_time,
        "room_width": f"{room.width}",
        "room_depth": f"{room.depth}",
        "room_height": f"{room.height}",
        "window_facing": scenario.window_facing_label,
        "window_span_center": f"{window.center[0]:.1f}",
        "window_sill_height": f"{window.center[2] - window.height / 2.0:.1f}",
        "window_width": f"{window.width}",
        "window_height": f"{window.height}",
        "windows_json": default_demo_windows_json(),
        "day_step_minutes": str(scenario.day_step_minutes),
        "year_step_hours": str(scenario.year_step_hours),
    }


def default_demo_windows_json() -> str:
    return json.dumps(
        [
            {
                "name": "main_window",
                "wall": "north",
                "span_center": 3.0,
                "sill_height": 0.1,
                "width": 1.5,
                "height": 2.0,
            },
            {
                "name": "side_window",
                "wall": "east",
                "span_center": 2.8,
                "sill_height": 0.1,
                "width": 1.5,
                "height": 2.0,
            },
        ],
        indent=2,
    )


def parse_windows_json(raw_value: str, room: Room) -> tuple:
    raw_text = raw_value.strip()
    if not raw_text:
        return ()
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError("Multi-window JSON must be valid JSON.") from exc

    if not isinstance(payload, list) or not payload:
        raise ValueError("Multi-window JSON must be a non-empty list of window objects.")
    if len(payload) > _MAX_WINDOWS:
        raise ValueError(f"Too many windows: maximum is {_MAX_WINDOWS}.")

    windows = []
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Window {index} must be an object.")
        wall = str(item.get("wall", "")).strip().lower()
        if not wall:
            raise ValueError(f"Window {index} must include a wall.")
        name = str(item.get("name", f"window_{index}")).strip() or f"window_{index}"
        span_center = parse_float(str(item.get("span_center", "")), f"Window {index} span center")
        sill_height = parse_float(str(item.get("sill_height", "")), f"Window {index} sill height")
        width = parse_bounded_float(str(item.get("width", "")), f"Window {index} width", 0.0, _MAX_ROOM_DIM, exclusive_min=True)
        height = parse_bounded_float(str(item.get("height", "")), f"Window {index} height", 0.0, _MAX_ROOM_DIM, exclusive_min=True)
        windows.append(
            window_on_wall(
                name=name,
                room=room,
                wall=wall,
                span_center=span_center,
                center_height=sill_height + 0.5 * height,
                width=width,
                height=height,
            )
        )
    return tuple(windows)


def build_config_and_moment(form_values: dict[str, str]) -> tuple[SimulationConfig, datetime]:
    selected_date = datetime.strptime(form_values["selected_date"], "%Y-%m-%d").date()
    selected_time = datetime.strptime(form_values["selected_time"], "%H:%M").time()
    preset_key = form_values.get("location_preset", "custom").strip()
    if preset_key and preset_key != "custom":
        preset = location_from_preset(preset_key)
        location_name = preset.name
        latitude = preset.latitude
        longitude = preset.longitude
        timezone_name = preset.timezone_name
    else:
        location_name = (form_values["location_name"].strip() or "Custom location")[:_MAX_LOCATION_NAME_LEN]
        latitude = parse_bounded_float(form_values["latitude"], "Latitude", -90.0, 90.0)
        longitude = parse_bounded_float(form_values["longitude"], "Longitude", -180.0, 180.0)
        timezone_name = form_values["timezone_name"].strip()

    timezone = parse_timezone_name(timezone_name)

    room = Room(
        width=parse_bounded_float(form_values["room_width"], "Room width", 0.0, _MAX_ROOM_DIM, exclusive_min=True),
        depth=parse_bounded_float(form_values["room_depth"], "Room depth", 0.0, _MAX_ROOM_DIM, exclusive_min=True),
        height=parse_bounded_float(form_values["room_height"], "Room height", 0.0, _MAX_ROOM_DIM, exclusive_min=True),
    )
    windows = parse_windows_json(form_values.get("windows_json", ""), room)
    if not windows:
        window_width = parse_bounded_float(form_values["window_width"], "Window width", 0.0, _MAX_ROOM_DIM, exclusive_min=True)
        window_height = parse_bounded_float(form_values["window_height"], "Window height", 0.0, _MAX_ROOM_DIM, exclusive_min=True)
        windows = (
            main_window(
                room=room,
                span_center=parse_float(form_values["window_span_center"], "Window span center"),
                center_height=parse_float(form_values["window_sill_height"], "Window sill height")
                + 0.5 * window_height,
                width=window_width,
                height=window_height,
            ),
        )

    facing_label = form_values["window_facing"].strip().upper()
    valid_facings = {label for label, _ in COMPASS_OPTIONS}
    if facing_label not in valid_facings:
        valid_list = ", ".join(label for label, _ in COMPASS_OPTIONS)
        raise ValueError(f"Window facing must be one of: {valid_list}.")

    day_step_minutes = parse_positive_int(form_values["day_step_minutes"], "Daily step", max_val=60)
    year_step_hours = parse_positive_int(form_values["year_step_hours"], "Yearly step", max_val=24)

    year = selected_date.year
    config = SimulationConfig(
        location=Location(
            name=location_name,
            latitude=latitude,
            longitude=longitude,
            timezone_name=timezone_name,
        ),
        room=room,
        windows=windows,
        year=year,
        day_step_minutes=day_step_minutes,
        year_step_hours=year_step_hours,
        window_facing_label=facing_label,
    )

    moment = datetime.combine(selected_date, selected_time, tzinfo=timezone)
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


def parse_bounded_float(
    raw_value: str,
    label: str,
    min_val: float,
    max_val: float,
    *,
    exclusive_min: bool = False,
) -> float:
    value = parse_float(raw_value, label)
    below = value <= min_val if exclusive_min else value < min_val
    if below or value > max_val:
        qualifier = "greater than" if exclusive_min else "at least"
        raise ValueError(f"{label} must be {qualifier} {min_val} and at most {max_val}.")
    return value


def parse_positive_int(raw_value: str, label: str, *, max_val: int) -> int:
    value = parse_float(raw_value, label)
    if value != int(value):
        raise ValueError(f"{label} must be a whole number.")
    int_value = int(value)
    if int_value <= 0:
        raise ValueError(f"{label} must be a positive integer.")
    if int_value > max_val:
        raise ValueError(f"{label} must be at most {max_val}.")
    return int_value


def parse_timezone_name(raw_value: str) -> ZoneInfo:
    try:
        return ZoneInfo(raw_value)
    except Exception as exc:
        raise ValueError("Timezone must be a valid IANA name.") from exc


def snapshot_payload(
    config: SimulationConfig,
    selected_moment: datetime,
    *,
    window_override_active: bool = False,
) -> dict[str, object]:
    snapshot = analyze_snapshot(config, selected_moment)
    daily = analyze_day(config, selected_moment.date(), selected_moment.strftime("%B %d"))
    exposure_grid = daily_exposure_grid(config, daily.patches_over_time)
    strongest_window, strongest_intensity = snapshot.strongest_window
    state = snapshot_state(snapshot.entered_direct_sun, strongest_intensity)
    daylight_times = daylight_window(daily.positions)
    summary = summarize_direct_sun(
        snapshot_state=state,
        entered_direct_sun=daily.entered_direct_sun,
        peak_hours=exposure_grid["peak_hours"],
        sunlit_fraction=exposure_grid["sunlit_fraction"],
        peak_time=daily.peak_time,
    )

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
            "room_azimuth_deg": room_relative_azimuth(config, snapshot.position.azimuth_deg),
            "vector": [float(value) for value in snapshot.vector],
            "room_vector": [float(value) for value in snapshot.room_vector],
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
            "sunrise_time": daylight_times[0].isoformat() if daylight_times[0] else None,
            "sunset_time": daylight_times[1].isoformat() if daylight_times[1] else None,
            "exposure_grid": exposure_grid,
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
            "name": config.windows[0].name,
            "wall": wall_name_for_window(config.windows[0]),
            "facing": config.window_facing_label,
        },
        "is_multi_window": len(config.windows) > 1,
        "window_override_active": window_override_active,
        "summary": summary,
        "window_facing_label": config.window_facing_label,
    }


def long_range_payload(config: SimulationConfig) -> dict[str, object]:
    return {
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
        "window_facing_label": config.window_facing_label,
        "periods": long_range_exposure_grids(config),
    }


def location_presets_payload() -> dict[str, dict[str, str | float]]:
    return {
        key: {
            "name": preset.name,
            "latitude": preset.latitude,
            "longitude": preset.longitude,
            "timezone_name": preset.timezone_name,
        }
        for key, preset in LOCATION_PRESETS.items()
    }


def normalize_form_values(form_values: dict[str, str], config: SimulationConfig) -> dict[str, str]:
    normalized = dict(form_values)
    normalized["location_name"] = config.location.name
    normalized["latitude"] = str(config.location.latitude)
    normalized["longitude"] = str(config.location.longitude)
    normalized["timezone_name"] = config.location.timezone_name
    normalized["year"] = str(config.year)
    normalized["window_facing"] = config.window_facing_label
    normalized["window_sill_height"] = f"{config.windows[0].center[2] - config.windows[0].height / 2.0:.1f}"
    if len(config.windows) > 1:
        normalized["windows_json"] = json.dumps(
            [
                {
                    "name": window.name,
                    "wall": wall_name_for_window(window),
                    "span_center": float(window.center[0] if wall_name_for_window(window) in {"north", "south"} else window.center[1]),
                    "sill_height": float(window.center[2] - window.height / 2.0),
                    "width": float(window.width),
                    "height": float(window.height),
                }
                for window in config.windows
            ],
            indent=2,
        )
    return normalized


def build_safe_form_values(form_values: dict[str, str], defaults: dict[str, str]) -> dict[str, str]:
    safe = dict(defaults)
    location_preset = form_values.get("location_preset", defaults["location_preset"]).strip()
    if location_preset in LOCATION_PRESETS or location_preset == "custom":
        safe["location_preset"] = location_preset

    safe["location_name"] = form_values.get("location_name", defaults["location_name"]).strip() or defaults["location_name"]
    safe["latitude"] = safe_bounded_float_string(
        form_values.get("latitude", defaults["latitude"]), defaults["latitude"], -90.0, 90.0
    )
    safe["longitude"] = safe_bounded_float_string(
        form_values.get("longitude", defaults["longitude"]), defaults["longitude"], -180.0, 180.0
    )
    safe["timezone_name"] = safe_timezone_name(form_values.get("timezone_name", defaults["timezone_name"]), defaults["timezone_name"])

    safe["selected_date"] = safe_date_string(form_values.get("selected_date", defaults["selected_date"]), defaults["selected_date"])
    safe["selected_time"] = safe_time_string(form_values.get("selected_time", defaults["selected_time"]), defaults["selected_time"])
    safe["year"] = str(datetime.strptime(safe["selected_date"], "%Y-%m-%d").year)

    for key in ("room_width", "room_depth", "room_height", "window_width", "window_height"):
        safe[key] = safe_bounded_float_string(
            form_values.get(key, defaults[key]), defaults[key], 0.0, _MAX_ROOM_DIM, exclusive_min=True
        )

    for key in ("window_span_center", "window_sill_height"):
        safe[key] = safe_float_string(form_values.get(key, defaults[key]), defaults[key])

    safe["day_step_minutes"] = safe_bounded_int_string(
        form_values.get("day_step_minutes", defaults["day_step_minutes"]), defaults["day_step_minutes"], 1, 60
    )
    safe["year_step_hours"] = safe_bounded_int_string(
        form_values.get("year_step_hours", defaults["year_step_hours"]), defaults["year_step_hours"], 1, 24
    )

    safe_room = Room(
        width=float(safe["room_width"]),
        depth=float(safe["room_depth"]),
        height=float(safe["room_height"]),
    )
    raw_windows_json = form_values.get("windows_json", defaults["windows_json"])
    safe["windows_json"] = safe_windows_json_string(raw_windows_json, defaults["windows_json"], safe_room)

    window_facing = form_values.get("window_facing", defaults["window_facing"]).strip().upper()
    valid_facings = {label for label, _ in COMPASS_OPTIONS}
    safe["window_facing"] = window_facing if window_facing in valid_facings else defaults["window_facing"]
    return safe


def safe_windows_json_string(raw_value: object, default_value: str, room: Room) -> str:
    if not isinstance(raw_value, str):
        return default_value
    candidate = raw_value.strip()
    if not candidate:
        return default_value
    try:
        parse_windows_json(candidate, room)
    except ValueError:
        return default_value
    return candidate


def has_window_override(form_values: dict[str, str]) -> bool:
    return bool(form_values.get("windows_json", "").strip())


def seasonal_preset_urls(base_values: dict[str, str], year: int) -> dict[str, str]:
    def build_url(month_day: str) -> str:
        return url_for(
            "index",
            **(base_values | {"selected_date": f"{year}-{month_day}", "selected_time": "12:00", "year": str(year)})
        )

    return {
        "Winter solstice": build_url("06-21"),
        "Summer solstice": build_url("12-21"),
        "Equinox": build_url("03-20"),
    }


def safe_float_string(raw_value: str, default_value: str) -> str:
    try:
        return str(float(raw_value))
    except (TypeError, ValueError):
        return default_value


def safe_bounded_float_string(
    raw_value: str,
    default_value: str,
    min_val: float,
    max_val: float,
    *,
    exclusive_min: bool = False,
) -> str:
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return default_value
    below = value <= min_val if exclusive_min else value < min_val
    if below or value > max_val:
        return default_value
    return str(value)


def safe_bounded_int_string(raw_value: str, default_value: str, min_val: int, max_val: int) -> str:
    try:
        value = int(float(raw_value))
    except (TypeError, ValueError):
        return default_value
    return str(value) if min_val <= value <= max_val else default_value


def safe_date_string(raw_value: str, default_value: str) -> str:
    try:
        return datetime.strptime(raw_value, "%Y-%m-%d").date().isoformat()
    except (TypeError, ValueError):
        return default_value


def safe_time_string(raw_value: str, default_value: str) -> str:
    try:
        return datetime.strptime(raw_value, "%H:%M").strftime("%H:%M")
    except (TypeError, ValueError):
        return default_value


def safe_timezone_name(raw_value: str, default_value: str) -> str:
    candidate = (raw_value or "").strip()
    try:
        ZoneInfo(candidate)
    except Exception:
        return default_value
    return candidate


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


def daylight_window(positions) -> tuple[datetime | None, datetime | None]:
    above_horizon = [dt for dt, position in positions if position.elevation_deg > 0.0]
    if not above_horizon:
        return None, None
    return above_horizon[0], above_horizon[-1]


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=True)
