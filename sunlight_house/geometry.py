from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable

import numpy as np


@dataclass(frozen=True)
class Room:
    width: float
    depth: float
    height: float

    def __post_init__(self) -> None:
        dimensions = (self.width, self.depth, self.height)
        if not all(math.isfinite(float(value)) and float(value) > 0.0 for value in dimensions):
            raise ValueError("Room width, depth, and height must be finite positive numbers.")

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
        center = np.asarray(self.center, dtype=float)
        if center.shape != (3,) or not np.all(np.isfinite(center)):
            raise ValueError("Window center must contain three finite coordinates.")
        if not math.isfinite(float(self.width)) or not math.isfinite(float(self.height)):
            raise ValueError("Window width and height must be finite numbers.")
        object.__setattr__(self, "center", center)
        normal = np.asarray(self.outward_normal, dtype=float)
        norm = np.linalg.norm(normal)
        if normal.shape != (3,) or not np.all(np.isfinite(normal)) or norm == 0:
            raise ValueError("Window normal must contain three finite coordinates and cannot be zero.")
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
    source_center_xyz: np.ndarray | None = None


@dataclass(frozen=True)
class ObstructionBox:
    """Axis-aligned sunlight blocker in room coordinates."""

    name: str
    minimum: np.ndarray
    maximum: np.ndarray
    scope: str = "interior"

    def __post_init__(self) -> None:
        minimum = np.asarray(self.minimum, dtype=float)
        maximum = np.asarray(self.maximum, dtype=float)
        if minimum.shape != (3,) or maximum.shape != (3,):
            raise ValueError("Obstruction bounds must contain three coordinates.")
        if not np.all(np.isfinite(minimum)) or not np.all(np.isfinite(maximum)):
            raise ValueError("Obstruction bounds must be finite.")
        if np.any(maximum <= minimum):
            raise ValueError("Obstruction maximum bounds must exceed minimum bounds.")
        if self.scope not in {"interior", "exterior"}:
            raise ValueError("Obstruction scope must be interior or exterior.")
        object.__setattr__(self, "minimum", minimum)
        object.__setattr__(self, "maximum", maximum)


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


def _ray_hits_box(
    origin: np.ndarray,
    direction: np.ndarray,
    box: ObstructionBox,
    *,
    max_distance: float | None = None,
) -> bool:
    """Return whether a forward ray intersects an axis-aligned box."""
    origin = np.asarray(origin, dtype=float)
    direction = np.asarray(direction, dtype=float)
    t_min = 0.0
    t_max = float("inf") if max_distance is None else max_distance

    for axis in range(3):
        if abs(direction[axis]) <= 1e-12:
            if origin[axis] < box.minimum[axis] or origin[axis] > box.maximum[axis]:
                return False
            continue
        first = (box.minimum[axis] - origin[axis]) / direction[axis]
        second = (box.maximum[axis] - origin[axis]) / direction[axis]
        near, far = sorted((first, second))
        t_min = max(t_min, near)
        t_max = min(t_max, far)
        if t_max < t_min:
            return False
    return t_max >= max(t_min, 0.0)


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


def _project_window_corners_to_floor(
    room: Room,
    window: Window,
    corners: list[np.ndarray],
    sun_direction: np.ndarray,
    intensity: float,
) -> SunlightPatch | None:
    incoming = -np.asarray(sun_direction, dtype=float)
    ray_dir = incoming / np.linalg.norm(incoming)

    projected: list[np.ndarray] = []
    for corner in corners:
        hit = _project_point_to_floor(corner, ray_dir)
        if hit is None:
            return None
        projected.append(np.asarray(hit[:2], dtype=float))

    poly = _clip_polygon_to_room(room, np.vstack(projected))
    if len(poly) < 3:
        return None
    if _polygon_area(poly) <= 1e-6:
        return None
    source_center = np.mean(np.vstack(corners), axis=0)
    return SunlightPatch(
        polygon_xy=poly,
        intensity=intensity,
        window_name=window.name,
        source_center_xyz=source_center,
    )


def project_to_floor(room: Room, window: Window, sun_direction: np.ndarray) -> SunlightPatch | None:
    """Project incoming sunlight through a window onto the floor plane."""
    room.validate_window(window)
    intensity = intersects_window(sun_direction, window.outward_normal)
    if intensity <= 0:
        return None
    return _project_window_corners_to_floor(room, window, window.corners(), sun_direction, intensity)


def _window_sample_point(window: Window, column: int, row: int, *, columns: int, rows: int) -> np.ndarray:
    u, v = window.local_axes()
    u_offset = -window.width / 2.0 + (column + 0.5) * window.width / columns
    v_offset = -window.height / 2.0 + (row + 0.5) * window.height / rows
    return window.center + u_offset * u + v_offset * v


def _visible_window_rectangles(
    window: Window,
    sun_direction: np.ndarray,
    obstructions: tuple[ObstructionBox, ...],
    *,
    columns: int = 6,
    rows: int = 6,
) -> tuple[list[list[np.ndarray]], float]:
    """Approximate unblocked window regions as merged rectangular sample runs."""
    sun_direction = np.asarray(sun_direction, dtype=float)
    sun_direction = sun_direction / np.linalg.norm(sun_direction)
    incoming = -sun_direction
    exterior = tuple(box for box in obstructions if box.scope == "exterior")
    interior = tuple(box for box in obstructions if box.scope == "interior")
    floor_visible = np.zeros((rows, columns), dtype=bool)
    entry_visible_count = 0
    epsilon = 1e-7

    for row in range(rows):
        for column in range(columns):
            sample = _window_sample_point(window, column, row, columns=columns, rows=rows)
            entry_visible = not any(
                _ray_hits_box(sample + epsilon * sun_direction, sun_direction, box)
                for box in exterior
            )
            if not entry_visible:
                continue
            entry_visible_count += 1
            floor_distance = sample[2] / sun_direction[2]
            floor_visible[row, column] = not any(
                _ray_hits_box(
                    sample + epsilon * incoming,
                    incoming,
                    box,
                    max_distance=max(floor_distance - epsilon, 0.0),
                )
                for box in interior
            )

    entry_fraction = entry_visible_count / float(rows * columns)
    if not np.any(floor_visible):
        return [], entry_fraction

    if np.all(floor_visible):
        return [window.corners()], entry_fraction

    runs_by_row: list[set[tuple[int, int]]] = []
    for row in range(rows):
        runs: set[tuple[int, int]] = set()
        start: int | None = None
        for column in range(columns + 1):
            visible = column < columns and bool(floor_visible[row, column])
            if visible and start is None:
                start = column
            elif not visible and start is not None:
                runs.add((start, column))
                start = None
        runs_by_row.append(runs)

    rectangles: list[tuple[int, int, int, int]] = []
    active: dict[tuple[int, int], int] = {}
    for row, runs in enumerate(runs_by_row):
        for run, start_row in list(active.items()):
            if run not in runs:
                rectangles.append((run[0], run[1], start_row, row))
                del active[run]
        for run in runs:
            active.setdefault(run, row)
    for run, start_row in active.items():
        rectangles.append((run[0], run[1], start_row, rows))

    u, v = window.local_axes()
    corner_sets: list[list[np.ndarray]] = []
    for start_column, end_column, start_row, end_row in rectangles:
        u_start = -window.width / 2.0 + start_column * window.width / columns
        u_end = -window.width / 2.0 + end_column * window.width / columns
        v_start = -window.height / 2.0 + start_row * window.height / rows
        v_end = -window.height / 2.0 + end_row * window.height / rows
        corner_sets.append([
            window.center + u_start * u + v_start * v,
            window.center + u_end * u + v_start * v,
            window.center + u_end * u + v_end * v,
            window.center + u_start * u + v_end * v,
        ])
    return corner_sets, entry_fraction


def window_entry_intensity(
    window: Window,
    sun_direction: np.ndarray,
    obstructions: Iterable[ObstructionBox] = (),
) -> float:
    incidence = intersects_window(sun_direction, window.outward_normal)
    if incidence <= 0:
        return 0.0
    obstruction_tuple = tuple(obstructions)
    if not obstruction_tuple:
        return incidence
    _rectangles, entry_fraction = _visible_window_rectangles(window, sun_direction, obstruction_tuple)
    return incidence * entry_fraction


def estimate_patch_centroid(patch: SunlightPatch) -> np.ndarray:
    return patch.polygon_xy.mean(axis=0)


def patches_for_windows(
    room: Room,
    windows: Iterable[Window],
    sun_direction: np.ndarray,
    obstructions: Iterable[ObstructionBox] = (),
) -> list[SunlightPatch]:
    patches: list[SunlightPatch] = []
    obstruction_tuple = tuple(obstructions)
    for window in windows:
        room.validate_window(window)
        intensity = intersects_window(sun_direction, window.outward_normal)
        if intensity <= 0:
            continue
        if not obstruction_tuple:
            patch = project_to_floor(room, window, sun_direction)
            if patch is not None:
                patches.append(patch)
            continue
        rectangles, _entry_fraction = _visible_window_rectangles(window, sun_direction, obstruction_tuple)
        for corners in rectangles:
            patch = _project_window_corners_to_floor(room, window, corners, sun_direction, intensity)
            if patch is not None:
                patches.append(patch)
    return patches
