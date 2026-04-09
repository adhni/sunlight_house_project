from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .geometry import Room, Window


@dataclass(frozen=True)
class Location:
    name: str
    latitude: float
    longitude: float
    timezone_name: str


@dataclass(frozen=True)
class SimulationConfig:
    location: Location
    room: Room
    windows: tuple[Window, ...]
    year: int = 2026
    day_step_minutes: int = 10
    year_step_hours: int = 1


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


def default_melbourne_scenario() -> SimulationConfig:
    room = Room(width=6.0, depth=5.0, height=3.0)
    windows = (
        window_on_wall(
            name="north_window",
            room=room,
            wall="north",
            span_center=3.0,
            center_height=1.5,
            width=2.4,
            height=1.6,
        ),
    )

    return SimulationConfig(
        location=Location(
            name="Melbourne, Australia",
            latitude=-37.8136,
            longitude=144.9631,
            timezone_name="Australia/Melbourne",
        ),
        room=room,
        windows=windows,
    )
