from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np


@dataclass(frozen=True)
class Room:
    width: float
    depth: float
    height: float

    def contains_xy(self, point_xy: np.ndarray, *, tol: float = 1e-9) -> bool:
        x, y = np.asarray(point_xy, dtype=float)
        return -tol <= x <= self.width + tol and -tol <= y <= self.depth + tol

    def validate_window(self, window: "Window", *, tol: float = 1e-9) -> None:
        x, y, z = window.center

        if window.width <= 0.0 or window.height <= 0.0:
            raise ValueError(f"Window '{window.name}' must have positive width and height.")
        if z - window.height / 2.0 < 0.0 or z + window.height / 2.0 > self.height:
            raise ValueError(f"Window '{window.name}' must fit within the room height.")

        if np.allclose(window.outward_normal, [0.0, 1.0, 0.0], atol=tol):
            if not np.isclose(y, self.depth, atol=tol):
                raise ValueError(f"North-facing window '{window.name}' must lie on y=depth.")
            if not (0.0 <= x - window.width / 2.0 and x + window.width / 2.0 <= self.width):
                raise ValueError(f"Window '{window.name}' must fit within the north wall width.")
        elif np.allclose(window.outward_normal, [0.0, -1.0, 0.0], atol=tol):
            if not np.isclose(y, 0.0, atol=tol):
                raise ValueError(f"South-facing window '{window.name}' must lie on y=0.")
            if not (0.0 <= x - window.width / 2.0 and x + window.width / 2.0 <= self.width):
                raise ValueError(f"Window '{window.name}' must fit within the south wall width.")
        elif np.allclose(window.outward_normal, [1.0, 0.0, 0.0], atol=tol):
            if not np.isclose(x, self.width, atol=tol):
                raise ValueError(f"East-facing window '{window.name}' must lie on x=width.")
            if not (0.0 <= y - window.width / 2.0 and y + window.width / 2.0 <= self.depth):
                raise ValueError(f"Window '{window.name}' must fit within the east wall depth.")
        elif np.allclose(window.outward_normal, [-1.0, 0.0, 0.0], atol=tol):
            if not np.isclose(x, 0.0, atol=tol):
                raise ValueError(f"West-facing window '{window.name}' must lie on x=0.")
            if not (0.0 <= y - window.width / 2.0 and y + window.width / 2.0 <= self.depth):
                raise ValueError(f"Window '{window.name}' must fit within the west wall depth.")
        else:
            raise ValueError(
                f"Window '{window.name}' must use an axis-aligned outward normal along +/-x or +/-y."
            )


@dataclass(frozen=True)
class Window:
    name: str
    center: np.ndarray
    width: float
    height: float
    outward_normal: np.ndarray

    def __post_init__(self) -> None:
        object.__setattr__(self, "center", np.asarray(self.center, dtype=float))
        normal = np.asarray(self.outward_normal, dtype=float)
        norm = np.linalg.norm(normal)
        if norm == 0:
            raise ValueError("Window normal cannot be zero.")
        object.__setattr__(self, "outward_normal", normal / norm)

    @property
    def inward_normal(self) -> np.ndarray:
        return -self.outward_normal

    def local_axes(self) -> tuple[np.ndarray, np.ndarray]:
        """Return width-axis and height-axis for an axis-aligned vertical window."""
        n = self.outward_normal
        if abs(n[0]) > 0.9:
            u = np.array([0.0, 1.0, 0.0])
        elif abs(n[1]) > 0.9:
            u = np.array([1.0, 0.0, 0.0])
        else:
            raise ValueError("This simple model expects axis-aligned wall windows.")
        v = np.array([0.0, 0.0, 1.0])
        return u, v

    def corners(self) -> list[np.ndarray]:
        u, v = self.local_axes()
        du = 0.5 * self.width * u
        dv = 0.5 * self.height * v
        c = self.center
        return [c - du - dv, c + du - dv, c + du + dv, c - du + dv]

    def wall_segment_xy(self) -> np.ndarray:
        u, _ = self.local_axes()
        du = 0.5 * self.width * u
        start = self.center - du
        end = self.center + du
        return np.vstack([start[:2], end[:2]])


@dataclass(frozen=True)
class SunlightPatch:
    polygon_xy: np.ndarray
    intensity: float
    window_name: str


def intersects_window(sun_direction: np.ndarray, window_normal: np.ndarray) -> float:
    """Return incidence factor for a window, 0 if the sun is behind the glass."""
    sun_direction = np.asarray(sun_direction, dtype=float)
    window_normal = np.asarray(window_normal, dtype=float)
    if sun_direction[2] <= 0:
        return 0.0
    factor = float(np.dot(sun_direction, window_normal))
    return max(0.0, factor)


def _polygon_area(points_xy: np.ndarray) -> float:
    x = points_xy[:, 0]
    y = points_xy[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _project_point_to_floor(point: np.ndarray, ray_dir: np.ndarray) -> np.ndarray | None:
    """Project a point along a ray to the floor plane z=0."""
    if ray_dir[2] >= 0:
        return None
    t = -point[2] / ray_dir[2]
    if t < 0:
        return None
    return point + t * ray_dir


def _interpolate_segment_point(start: np.ndarray, end: np.ndarray, *, axis: int, value: float) -> np.ndarray:
    delta = end[axis] - start[axis]
    if abs(delta) <= 1e-12:
        point = start.copy()
        point[axis] = value
        return point
    t = (value - start[axis]) / delta
    return start + t * (end - start)


def _clip_polygon_half_plane(
    polygon_xy: np.ndarray,
    *,
    inside,
    intersect,
) -> np.ndarray:
    if len(polygon_xy) == 0:
        return polygon_xy

    output: list[np.ndarray] = []
    for index, current in enumerate(polygon_xy):
        previous = polygon_xy[index - 1]
        current_inside = inside(current)
        previous_inside = inside(previous)

        if current_inside:
            if not previous_inside:
                output.append(intersect(previous, current))
            output.append(current)
        elif previous_inside:
            output.append(intersect(previous, current))

    if not output:
        return np.empty((0, 2), dtype=float)
    return np.vstack(output)


def _dedupe_polygon_points(polygon_xy: np.ndarray, *, tol: float = 1e-9) -> np.ndarray:
    if len(polygon_xy) == 0:
        return polygon_xy

    deduped = [polygon_xy[0]]
    for point in polygon_xy[1:]:
        if not np.allclose(point, deduped[-1], atol=tol):
            deduped.append(point)

    if len(deduped) > 1 and np.allclose(deduped[0], deduped[-1], atol=tol):
        deduped.pop()

    if len(deduped) < 3:
        return np.empty((0, 2), dtype=float)
    return np.vstack(deduped)


def _clip_polygon_to_room(room: Room, polygon_xy: np.ndarray) -> np.ndarray:
    clipped = np.asarray(polygon_xy, dtype=float)

    clipped = _clip_polygon_half_plane(
        clipped,
        inside=lambda point: point[0] >= 0.0,
        intersect=lambda start, end: _interpolate_segment_point(start, end, axis=0, value=0.0),
    )
    clipped = _clip_polygon_half_plane(
        clipped,
        inside=lambda point: point[0] <= room.width,
        intersect=lambda start, end: _interpolate_segment_point(start, end, axis=0, value=room.width),
    )
    clipped = _clip_polygon_half_plane(
        clipped,
        inside=lambda point: point[1] >= 0.0,
        intersect=lambda start, end: _interpolate_segment_point(start, end, axis=1, value=0.0),
    )
    clipped = _clip_polygon_half_plane(
        clipped,
        inside=lambda point: point[1] <= room.depth,
        intersect=lambda start, end: _interpolate_segment_point(start, end, axis=1, value=room.depth),
    )

    return _dedupe_polygon_points(clipped)


def project_to_floor(room: Room, window: Window, sun_direction: np.ndarray) -> SunlightPatch | None:
    """Project incoming sunlight through a window onto the floor plane."""
    room.validate_window(window)
    intensity = intersects_window(sun_direction, window.outward_normal)
    if intensity <= 0:
        return None

    incoming = -np.asarray(sun_direction, dtype=float)
    ray_dir = incoming / np.linalg.norm(incoming)

    projected: list[np.ndarray] = []
    for corner in window.corners():
        hit = _project_point_to_floor(corner, ray_dir)
        if hit is None:
            return None
        projected.append(np.asarray(hit[:2], dtype=float))

    poly = _clip_polygon_to_room(room, np.vstack(projected))
    if len(poly) < 3:
        return None
    if _polygon_area(poly) <= 1e-6:
        return None
    return SunlightPatch(polygon_xy=poly, intensity=intensity, window_name=window.name)


def estimate_patch_centroid(patch: SunlightPatch) -> np.ndarray:
    return patch.polygon_xy.mean(axis=0)


def patches_for_windows(room: Room, windows: Iterable[Window], sun_direction: np.ndarray) -> list[SunlightPatch]:
    patches: list[SunlightPatch] = []
    for window in windows:
        patch = project_to_floor(room, window, sun_direction)
        if patch is not None:
            patches.append(patch)
    return patches
