from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .geometry import Room, Window


COMPASS_OPTIONS: tuple[tuple[str, float], ...] = (
    ("N", 0.0),
    ("NE", 45.0),
    ("E", 90.0),
    ("SE", 135.0),
    ("S", 180.0),
    ("SW", 225.0),
    ("W", 270.0),
    ("NW", 315.0),
)

COMPASS_ANGLE_BY_LABEL = {label: angle for label, angle in COMPASS_OPTIONS}


@dataclass(frozen=True)
class Location:
    name: str
    latitude: float
    longitude: float
    timezone_name: str


LOCATION_PRESETS: dict[str, Location] = {
    "melbourne": Location(
        name="Melbourne, Australia",
        latitude=-37.8136,
        longitude=144.9631,
        timezone_name="Australia/Melbourne",
    ),
    "jakarta": Location(
        name="Jakarta, Indonesia",
        latitude=-6.2088,
        longitude=106.8456,
        timezone_name="Asia/Jakarta",
    ),
    "boston": Location(
        name="Boston, United States",
        latitude=42.3601,
        longitude=-71.0589,
        timezone_name="America/New_York",
    ),
}


@dataclass(frozen=True)
class SimulationConfig:
    location: Location
    room: Room
    windows: tuple[Window, ...]
    year: int = 2026
    day_step_minutes: int = 10
    year_step_hours: int = 1
    window_facing_label: str = "N"

    @property
    def window_facing_deg(self) -> float:
        return compass_angle(self.window_facing_label)


def compass_angle(label: str) -> float:
    try:
        return COMPASS_ANGLE_BY_LABEL[label.upper()]
    except KeyError as exc:
        valid = ", ".join(name for name, _ in COMPASS_OPTIONS)
        raise ValueError(f"Window facing must be one of: {valid}.") from exc


def default_location_preset() -> str:
    return "melbourne"


def location_from_preset(preset: str) -> Location:
    try:
        return LOCATION_PRESETS[preset]
    except KeyError as exc:
        valid = ", ".join(sorted(LOCATION_PRESETS))
        raise ValueError(f"Unknown location preset '{preset}'. Expected one of: {valid}.") from exc


def wall_normal(wall: str) -> np.ndarray:
    normals = {
        "north": np.array([0.0, 1.0, 0.0]),
        "south": np.array([0.0, -1.0, 0.0]),
        "east": np.array([1.0, 0.0, 0.0]),
        "west": np.array([-1.0, 0.0, 0.0]),
    }
    try:
        return normals[wall.lower()].copy()
    except KeyError as exc:
        raise ValueError("Wall must be one of: north, south, east, west.") from exc


def window_on_wall(
    *,
    name: str,
    room: Room,
    wall: str,
    span_center: float,
    center_height: float,
    width: float,
    height: float,
) -> Window:
    wall_name = wall.lower()
    if wall_name == "north":
        center = np.array([span_center, room.depth, center_height])
    elif wall_name == "south":
        center = np.array([span_center, 0.0, center_height])
    elif wall_name == "east":
        center = np.array([room.width, span_center, center_height])
    elif wall_name == "west":
        center = np.array([0.0, span_center, center_height])
    else:
        raise ValueError("Wall must be one of: north, south, east, west.")

    window = Window(
        name=name,
        center=center,
        width=width,
        height=height,
        outward_normal=wall_normal(wall_name),
    )
    room.validate_window(window)
    return window


def main_window(
    *,
    room: Room,
    span_center: float,
    center_height: float,
    width: float,
    height: float,
) -> Window:
    # The room model keeps the main window on the local north wall.
    # Window-facing presets rotate the room relative to the real-world sun.
    return window_on_wall(
        name="main_window",
        room=room,
        wall="north",
        span_center=span_center,
        center_height=center_height,
        width=width,
        height=height,
    )


def default_melbourne_scenario() -> SimulationConfig:
    room = Room(width=4.0, depth=5.0, height=3.0)
    windows = (
        main_window(
            room=room,
            span_center=3.0,
            center_height=1.1,
            width=1.5,
            height=2.0,
        ),
    )

    return SimulationConfig(
        location=location_from_preset(default_location_preset()),
        room=room,
        windows=windows,
        window_facing_label="E",
    )
