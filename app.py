from __future__ import annotations

import json
import math
import os
import tempfile
from collections import OrderedDict
from datetime import date, datetime, timedelta
from threading import Lock
from time import perf_counter
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, render_template, request, url_for
from werkzeug.exceptions import RequestEntityTooLarge

_MAX_WINDOWS = 10
_MAX_LOCATION_NAME_LEN = 200
_MAX_WINDOW_NAME_LEN = 120
_MAX_WINDOWS_JSON_BYTES = 100_000
_MAX_ROOM_DIM = 500.0  # metres -- sanity cap to prevent extreme compute
_MAX_IFC_UPLOAD_BYTES = 25 * 1024 * 1024
_MAX_YEAR_STEP_HOURS = 12
_ANIMATION_STEP_MINUTES = 10
_DAY_ANIMATION_CACHE_MAX = 24
_SCENE_TOGGLE_VALUES = {"0", "1"}
_SCENE_DOOR_WALLS = {"north", "south", "east", "west"}
_SCENE_FURNITURE_PRESETS = {"none", "living", "dining", "bedroom"}
_day_animation_cache: OrderedDict[tuple, dict[str, object]] = OrderedDict()
_day_animation_cache_lock = Lock()

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
from sunlight_house.geometry import Room, Window
from sunlight_house.ifc_import import IfcImportError, import_ifc_room
from sunlight_house.insights import summarize_direct_sun


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = _MAX_IFC_UPLOAD_BYTES

    @app.errorhandler(RequestEntityTooLarge)
    def request_entity_too_large(_error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Request is too large. IFC uploads are limited to 25 MB."}), 413
        return "Request is too large.", 413

    @app.get("/")
    def index() -> str:
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}
        error: str | None = None
        safe_values: dict[str, str] | None = None

        try:
            config, selected_moment = build_config_and_moment(raw_values)
            form_values = normalize_form_values(raw_values, config)
            scene_details = build_scene_details(form_values, config.room)
            window_override_active = has_window_override(form_values)
        except ValueError as exc:
            error = f"{exc} Keeping your current inputs below; the preview uses the nearest valid values."
            form_values = dict(raw_values)
            safe_values = build_safe_form_values(raw_values, defaults)
            for hidden_key in (
                "windows_json",
                "day_step_minutes",
                "year_step_hours",
                "scene_door_enabled",
                "scene_door_wall",
                "scene_partition_enabled",
                "scene_eaves_enabled",
                "scene_furniture_preset",
            ):
                form_values[hidden_key] = safe_values[hidden_key]
            config, selected_moment = build_config_and_moment(safe_values)
            scene_details = build_scene_details(safe_values, config.room)
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
                scene_details=scene_details,
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
            scene_details = build_scene_details(raw_values, config.room)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify(
            snapshot_payload(
                config,
                selected_moment,
                window_override_active=has_window_override(raw_values),
                scene_details=scene_details,
            )
        )

    @app.get("/api/scene-details")
    def api_scene_details():
        """Return visual-only 3D details without running sunlight analysis."""
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}

        try:
            config, _selected_moment = build_config_and_moment(raw_values)
            scene_details = build_scene_details(raw_values, config.room)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        return jsonify({"scene": scene_details})

    @app.get("/api/day-animation")
    def api_day_animation():
        defaults = default_form_values()
        raw_values = defaults | {key: value for key, value in request.args.items() if value != ""}

        try:
            config, selected_moment = build_config_and_moment(raw_values)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        started_at = perf_counter()
        payload, cache_hit = day_animation_payload(config, selected_moment.date())
        elapsed_ms = (perf_counter() - started_at) * 1000.0
        app.logger.info(
            "Day animation %s in %.1f ms for %s on %s (%d frames)",
            "cache hit" if cache_hit else "computed",
            elapsed_ms,
            config.location.name,
            selected_moment.date().isoformat(),
            len(payload["frames"]),
        )
        return jsonify(payload | {"cache_hit": cache_hit})

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

    @app.post("/api/import-ifc")
    def api_import_ifc():
        upload = request.files.get("ifc_file")
        if upload is None or not upload.filename:
            return jsonify({"error": "Upload an IFC file using the 'ifc_file' field."}), 400
        if not upload.filename.lower().endswith(".ifc"):
            return jsonify({"error": "IFC upload must use a .ifc file."}), 400

        content_length = request.content_length
        if content_length is not None and content_length > _MAX_IFC_UPLOAD_BYTES:
            return jsonify({"error": "IFC upload is too large. Maximum size is 25 MB."}), 413

        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=True) as temp_file:
            try:
                _save_upload_with_limit(upload, temp_file, _MAX_IFC_UPLOAD_BYTES)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 413
            temp_file.flush()
            try:
                payload = import_ifc_room(temp_file.name, max_windows=_MAX_WINDOWS)
            except IfcImportError as exc:
                return jsonify({"error": str(exc)}), 422

        return jsonify(payload)

    @app.get("/healthz")
    def healthz() -> tuple[str, int]:
        return "ok", 200

    return app


def _save_upload_with_limit(upload, destination, max_bytes: int) -> None:
    """Copy an uploaded file while enforcing a limit independent of headers."""
    total = 0
    while True:
        chunk = upload.stream.read(1024 * 1024)
        if not chunk:
            return
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"IFC upload is too large. Maximum size is {max_bytes // (1024 * 1024)} MB.")
        destination.write(chunk)


def default_form_values() -> dict[str, str]:
    scenario = default_melbourne_scenario()
    room = scenario.room
    window = scenario.windows[0]
    preset = default_location_preset()
    demo_date = f"{scenario.year}-01-15"
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
        "scene_door_enabled": "1",
        "scene_door_wall": "south",
        "scene_partition_enabled": "1",
        "scene_eaves_enabled": "1",
        "scene_furniture_preset": "living",
        "day_step_minutes": str(scenario.day_step_minutes),
        "year_step_hours": str(scenario.year_step_hours),
    }


def default_demo_windows_json() -> str:
    scenario = default_melbourne_scenario()

    def payload_for_window(window) -> dict[str, object]:
        wall = wall_name_for_window(window)
        span_center = window.center[0] if wall in {"north", "south"} else window.center[1]
        return {
            "name": window.name,
            "wall": wall,
            "span_center": float(span_center),
            "sill_height": float(window.center[2] - window.height / 2.0),
            "width": float(window.width),
            "height": float(window.height),
        }

    return json.dumps(
        [payload_for_window(window) for window in scenario.windows],
        indent=2,
    )


def parse_windows_json(raw_value: str, room: Room) -> tuple:
    raw_text = raw_value.strip()
    if not raw_text:
        return ()
    if len(raw_text.encode("utf-8")) > _MAX_WINDOWS_JSON_BYTES:
        raise ValueError("Multi-window JSON is too large.")
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError("Multi-window JSON must be valid JSON.") from exc

    if not isinstance(payload, list) or not payload:
        raise ValueError("Multi-window JSON must be a non-empty list of window objects.")
    if len(payload) > _MAX_WINDOWS:
        raise ValueError(f"Too many windows: maximum is {_MAX_WINDOWS}.")

    windows = []
    names: set[str] = set()
    for index, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Window {index} must be an object.")
        wall = str(item.get("wall", "")).strip().lower()
        if not wall:
            raise ValueError(f"Window {index} must include a wall.")
        name = str(item.get("name", f"window_{index}")).strip() or f"window_{index}"
        if len(name) > _MAX_WINDOW_NAME_LEN:
            raise ValueError(f"Window {index} name must be at most {_MAX_WINDOW_NAME_LEN} characters.")
        if name in names:
            raise ValueError(f"Window names must be unique; '{name}' is repeated.")
        names.add(name)
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
    year_step_hours = parse_positive_int(form_values["year_step_hours"], "Yearly step", max_val=_MAX_YEAR_STEP_HOURS)

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
        value = float(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number.")
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
    scene_details: dict[str, object] | None = None,
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
        "windows": [window_payload(window) for window in config.windows],
        "active_window": {
            "name": config.windows[0].name,
            "wall": wall_name_for_window(config.windows[0]),
            "facing": config.window_facing_label,
        },
        "is_multi_window": len(config.windows) > 1,
        "window_override_active": window_override_active,
        "scene": scene_details or build_scene_details(default_form_values(), config.room),
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
        "windows": [window_payload(window) for window in config.windows],
        "window_facing_label": config.window_facing_label,
        "periods": long_range_exposure_grids(config),
    }


def window_payload(window: Window) -> dict[str, object]:
    """Serialize complete window geometry for both 2D and 3D clients."""
    return {
        "name": window.name,
        "wall": wall_name_for_window(window),
        "width": float(window.width),
        "height": float(window.height),
        "sill_height": float(window.center[2] - window.height / 2.0),
        "center_xyz": [float(value) for value in window.center],
        "corners_xyz": [[float(value) for value in corner] for corner in window.corners()],
        "outward_normal": [float(value) for value in window.outward_normal],
        "wall_segment_xy": window.wall_segment_xy().tolist(),
    }


def _day_animation_cache_key(config: SimulationConfig, target_date: date) -> tuple:
    windows = tuple(
        (
            window.name,
            tuple(float(value) for value in window.center),
            float(window.width),
            float(window.height),
            tuple(float(value) for value in window.outward_normal),
        )
        for window in config.windows
    )
    return (
        target_date.isoformat(),
        float(config.location.latitude),
        float(config.location.longitude),
        config.location.timezone_name,
        float(config.room.width),
        float(config.room.depth),
        float(config.room.height),
        windows,
        config.window_facing_label,
        _ANIMATION_STEP_MINUTES,
    )


def _animation_snapshot_payload(config: SimulationConfig, moment: datetime) -> dict[str, object]:
    snapshot = analyze_snapshot(config, moment)
    strongest_window, strongest_intensity = snapshot.strongest_window
    return {
        "selected_moment": moment.isoformat(),
        "snapshot": {
            "elevation_deg": snapshot.position.elevation_deg,
            "azimuth_deg": snapshot.position.azimuth_deg,
            "room_azimuth_deg": room_relative_azimuth(config, snapshot.position.azimuth_deg),
            "vector": [float(value) for value in snapshot.vector],
            "room_vector": [float(value) for value in snapshot.room_vector],
            "entered_direct_sun": snapshot.entered_direct_sun,
            "strongest_window": strongest_window,
            "strongest_intensity": strongest_intensity,
            "state": snapshot_state(snapshot.entered_direct_sun, strongest_intensity),
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
    }


def _compute_day_animation_payload(config: SimulationConfig, target_date: date) -> dict[str, object]:
    timezone = ZoneInfo(config.location.timezone_name)
    midnight = datetime.combine(target_date, datetime.min.time(), tzinfo=timezone)
    frames = [
        _animation_snapshot_payload(config, midnight + timedelta(minutes=minute))
        for minute in range(0, 24 * 60, _ANIMATION_STEP_MINUTES)
    ]
    daylight_indices = [
        index for index, frame in enumerate(frames) if frame["snapshot"]["elevation_deg"] > 0.0
    ]
    if daylight_indices:
        morning_index = daylight_indices[len(daylight_indices) // 4]
        noon_index = max(daylight_indices, key=lambda index: frames[index]["snapshot"]["elevation_deg"])
        evening_index = daylight_indices[(len(daylight_indices) * 3) // 4]
        playback_start_index = daylight_indices[0]
        playback_end_index = daylight_indices[-1]
    else:
        morning_index = 9 * 60 // _ANIMATION_STEP_MINUTES
        noon_index = 12 * 60 // _ANIMATION_STEP_MINUTES
        evening_index = 17 * 60 // _ANIMATION_STEP_MINUTES
        playback_start_index = 0
        playback_end_index = len(frames) - 1

    return {
        "selected_date": target_date.isoformat(),
        "timezone_name": config.location.timezone_name,
        "step_minutes": _ANIMATION_STEP_MINUTES,
        "playback_start_index": playback_start_index,
        "playback_end_index": playback_end_index,
        "presets": {
            "morning": {"label": "Morning", "index": morning_index},
            "noon": {"label": "Solar noon", "index": noon_index},
            "evening": {"label": "Evening", "index": evening_index},
        },
        "frames": frames,
    }


def day_animation_payload(config: SimulationConfig, target_date: date) -> tuple[dict[str, object], bool]:
    key = _day_animation_cache_key(config, target_date)
    with _day_animation_cache_lock:
        cached = _day_animation_cache.get(key)
        if cached is not None:
            _day_animation_cache.move_to_end(key)
            return cached, True

    payload = _compute_day_animation_payload(config, target_date)
    with _day_animation_cache_lock:
        existing = _day_animation_cache.get(key)
        if existing is not None:
            _day_animation_cache.move_to_end(key)
            return existing, True
        _day_animation_cache[key] = payload
        while len(_day_animation_cache) > _DAY_ANIMATION_CACHE_MAX:
            _day_animation_cache.popitem(last=False)
    return payload, False


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


def build_scene_details(form_values: dict[str, str], room: Room) -> dict[str, object]:
    """Build lightweight visual-only scene details sized to the current room."""

    def scene_toggle(key: str, label: str) -> bool:
        value = str(form_values.get(key, "")).strip()
        if value not in _SCENE_TOGGLE_VALUES:
            raise ValueError(f"{label} must be on or off.")
        return value == "1"

    door_wall = str(form_values.get("scene_door_wall", "")).strip().lower()
    if door_wall not in _SCENE_DOOR_WALLS:
        raise ValueError("3D door wall must be north, south, east, or west.")
    furniture_preset = str(form_values.get("scene_furniture_preset", "")).strip().lower()
    if furniture_preset not in _SCENE_FURNITURE_PRESETS:
        raise ValueError("3D furniture preset must be none, living, dining, or bedroom.")

    wall_length = room.width if door_wall in {"north", "south"} else room.depth
    door_width = min(0.9, wall_length * 0.28)
    door_height = min(2.1, room.height * 0.78)
    door_span_center = wall_length * 0.22
    if door_wall == "north":
        door_center = [door_span_center, room.depth, door_height / 2.0]
    elif door_wall == "south":
        door_center = [door_span_center, 0.0, door_height / 2.0]
    elif door_wall == "east":
        door_center = [room.width, door_span_center, door_height / 2.0]
    else:
        door_center = [0.0, door_span_center, door_height / 2.0]

    eave_depth = min(0.5, max(min(room.width, room.depth) * 0.11, 0.04))
    partition_start = [room.width * 0.56, room.depth * 0.58]
    partition_end = [room.width * 0.94, room.depth * 0.58]
    return {
        "version": 1,
        "visual_only": True,
        "door": {
            "enabled": scene_toggle("scene_door_enabled", "3D door"),
            "wall": door_wall,
            "span_center": door_span_center,
            "sill_height": 0.0,
            "width": door_width,
            "height": door_height,
            "center_xyz": door_center,
        },
        "internal_wall": {
            "enabled": scene_toggle("scene_partition_enabled", "3D internal wall"),
            "start_xy": partition_start,
            "end_xy": partition_end,
            "height": min(2.4, room.height * 0.86),
            "thickness": min(0.1, max(min(room.width, room.depth) * 0.02, 0.025)),
        },
        "roof": {
            "enabled": True,
            "eaves_enabled": scene_toggle("scene_eaves_enabled", "3D eaves"),
            "eave_depth": eave_depth,
            "thickness": min(0.12, max(room.height * 0.035, 0.03)),
        },
        "furniture": {"preset": furniture_preset},
    }


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
        form_values.get("year_step_hours", defaults["year_step_hours"]),
        defaults["year_step_hours"],
        1,
        _MAX_YEAR_STEP_HOURS,
    )

    safe_room = Room(
        width=float(safe["room_width"]),
        depth=float(safe["room_depth"]),
        height=float(safe["room_height"]),
    )
    raw_windows_json = form_values.get("windows_json", defaults["windows_json"])
    safe["windows_json"] = safe_windows_json_string(raw_windows_json, defaults["windows_json"], safe_room)

    for key in ("scene_door_enabled", "scene_partition_enabled", "scene_eaves_enabled"):
        candidate = str(form_values.get(key, defaults[key])).strip()
        safe[key] = candidate if candidate in _SCENE_TOGGLE_VALUES else defaults[key]
    door_wall = str(form_values.get("scene_door_wall", defaults["scene_door_wall"])).strip().lower()
    safe["scene_door_wall"] = door_wall if door_wall in _SCENE_DOOR_WALLS else defaults["scene_door_wall"]
    furniture = str(form_values.get("scene_furniture_preset", defaults["scene_furniture_preset"])).strip().lower()
    safe["scene_furniture_preset"] = (
        furniture if furniture in _SCENE_FURNITURE_PRESETS else defaults["scene_furniture_preset"]
    )

    window_facing = form_values.get("window_facing", defaults["window_facing"]).strip().upper()
    valid_facings = {label for label, _ in COMPASS_OPTIONS}
    safe["window_facing"] = window_facing if window_facing in valid_facings else defaults["window_facing"]
    return safe


def safe_windows_json_string(raw_value: object, default_value: str, room: Room) -> str:
    candidate_value = raw_value.strip() if isinstance(raw_value, str) else ""
    candidates = [candidate_value, default_value.strip()]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            parse_windows_json(candidate, room)
        except ValueError:
            continue
        return candidate

    return json.dumps(fallback_windows_for_room(room), indent=2)


def fallback_windows_for_room(room: Room) -> list[dict[str, object]]:
    """Return a valid starter window for any positive room dimensions."""
    width = room.width * 0.5
    height = room.height * 0.6
    sill_height = room.height * 0.1
    return [
        {
            "name": "main_window",
            "wall": "north",
            "span_center": room.width * 0.5,
            "sill_height": sill_height,
            "width": width,
            "height": height,
        }
    ]


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
        value = float(raw_value)
    except (TypeError, ValueError):
        return default_value
    if not math.isfinite(value):
        return default_value
    return str(value)

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
    if not math.isfinite(value):
        return default_value
    below = value <= min_val if exclusive_min else value < min_val
    if below or value > max_val:
        return default_value
    return str(value)


def safe_bounded_int_string(raw_value: str, default_value: str, min_val: int, max_val: int) -> str:
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return default_value
    if not math.isfinite(value) or not value.is_integer():
        return default_value
    int_value = int(value)
    return str(int_value) if min_val <= int_value <= max_val else default_value


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
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
    )
