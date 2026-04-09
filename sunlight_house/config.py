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


def default_melbourne_scenario() -> SimulationConfig:
    room = Room(width=6.0, depth=5.0, height=3.0)
    windows = (
        Window(
            name="north_window",
            center=np.array([3.0, room.depth, 1.5]),
            width=2.4,
            height=1.6,
            outward_normal=np.array([0.0, 1.0, 0.0]),
        ),
    )
    for window in windows:
        room.validate_window(window)

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
