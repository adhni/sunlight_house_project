from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


_MAX_SPACES_TO_INSPECT = 250
_MAX_WINDOWS_TO_INSPECT = 2_000


class IfcImportError(ValueError):
    """Raised when an IFC file cannot be reduced to the app room model."""


@dataclass(frozen=True)
class BoundingBox:
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    min_z: float
    max_z: float

    @property
    def width(self) -> float:
        return self.max_x - self.min_x

    @property
    def depth(self) -> float:
        return self.max_y - self.min_y

    @property
    def height(self) -> float:
        return self.max_z - self.min_z

    @property
    def center_x(self) -> float:
        return (self.min_x + self.max_x) / 2.0

    @property
    def center_y(self) -> float:
        return (self.min_y + self.max_y) / 2.0

    @property
    def volume(self) -> float:
        return max(self.width, 0.0) * max(self.depth, 0.0) * max(self.height, 0.0)


def import_ifc_room(path: str | Path, *, max_windows: int = 10) -> dict[str, Any]:
    """Convert one rectangular-ish IFC space into the app's room/window payload."""

    try:
        import ifcopenshell
        import ifcopenshell.geom
    except ImportError as exc:
        raise IfcImportError("IFC import requires the optional 'ifcopenshell' package.") from exc

    try:
        model = ifcopenshell.open(str(path))
        settings = ifcopenshell.geom.settings()
        settings.set(settings.USE_WORLD_COORDS, True)
    except Exception as exc:
        raise IfcImportError("The uploaded file could not be opened as IFC.") from exc

    try:
        space_elements = model.by_type("IfcSpace")
        window_elements = model.by_type("IfcWindow")
    except Exception as exc:
        raise IfcImportError("The uploaded file does not expose usable IFC spaces or windows.") from exc
    if len(space_elements) > _MAX_SPACES_TO_INSPECT:
        raise IfcImportError(f"The IFC file contains too many spaces to inspect (maximum {_MAX_SPACES_TO_INSPECT}).")
    if len(window_elements) > _MAX_WINDOWS_TO_INSPECT:
        raise IfcImportError(
            f"The IFC file contains too many windows to inspect (maximum {_MAX_WINDOWS_TO_INSPECT})."
        )

    spaces = _elements_with_boxes(space_elements, settings)
    if not spaces:
        raise IfcImportError("No IfcSpace geometry was found in this IFC file.")

    space, space_box = max(spaces, key=lambda item: item[1].volume)
    if space_box.width <= 0 or space_box.depth <= 0 or space_box.height <= 0:
        raise IfcImportError("The selected IfcSpace has invalid geometry.")

    windows = []
    used_window_names: set[str] = set()
    diagnostics: list[str] = []
    for element, box in _elements_with_boxes(window_elements, settings):
        mapped = _map_window_to_room(element, box, space_box)
        if mapped is not None:
            mapped["name"] = _unique_window_name(element, used_window_names)
            windows.append(mapped)
        elif _near_space(box, space_box):
            diagnostics.append(f"Skipped window '{_element_name(element)}' because it does not sit on a main room wall.")

    if not windows:
        diagnostics.append("No IfcWindow elements were matched to the selected room boundary.")
    if len(windows) > max_windows:
        diagnostics.append(f"Only the first {max_windows} matched windows were imported.")
        windows = windows[:max_windows]

    return {
        "source": "ifc",
        "space": {
            "name": _element_name(space),
            "global_id": getattr(space, "GlobalId", ""),
        },
        "room": {
            "width": _round_m(space_box.width),
            "depth": _round_m(space_box.depth),
            "height": _round_m(space_box.height),
        },
        "window_facing": "N",
        "windows": windows,
        "diagnostics": [
            "Room orientation defaults to north; verify the imported room bearing.",
            *diagnostics,
        ],
    }


def _elements_with_boxes(elements: list[Any], settings: Any) -> list[tuple[Any, BoundingBox]]:
    boxes = []
    for element in elements:
        try:
            box = _element_box(element, settings)
        except Exception:
            continue
        if box is not None:
            boxes.append((element, box))
    return boxes


def _element_box(element: Any, settings: Any) -> BoundingBox | None:
    import ifcopenshell.geom

    shape = ifcopenshell.geom.create_shape(settings, element)
    # IfcOpenShell returns geometry in metres by default, including for IFC
    # projects authored in millimetres. Do not apply project unit scaling here.
    verts = tuple(float(value) for value in shape.geometry.verts)
    if len(verts) < 3:
        return None
    xs = verts[0::3]
    ys = verts[1::3]
    zs = verts[2::3]
    return BoundingBox(min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


def _map_window_to_room(element: Any, box: BoundingBox, room: BoundingBox) -> dict[str, Any] | None:
    tolerance = max(room.width, room.depth, room.height) * 0.04
    distances = {
        "west": abs(box.center_x - room.min_x),
        "east": abs(box.center_x - room.max_x),
        "south": abs(box.center_y - room.min_y),
        "north": abs(box.center_y - room.max_y),
    }
    wall, distance = min(distances.items(), key=lambda item: item[1])
    if distance > tolerance:
        return None

    if wall in {"north", "south"}:
        span_min = max(box.min_x, room.min_x)
        span_max = min(box.max_x, room.max_x)
        width = span_max - span_min
        if width <= 0.0:
            return None
        span_center = (span_min + span_max) / 2.0 - room.min_x
    else:
        span_min = max(box.min_y, room.min_y)
        span_max = min(box.max_y, room.max_y)
        width = span_max - span_min
        if width <= 0.0:
            return None

        span_center = (span_min + span_max) / 2.0 - room.min_y

    clipped_min_z = max(box.min_z, room.min_z)
    clipped_max_z = min(box.max_z, room.max_z)
    height = clipped_max_z - clipped_min_z
    if width <= 0 or height <= 0:
        return None

    return {
        "name": _element_name(element),
        "wall": wall,
        "span_center": _round_m(span_center),
        "sill_height": _round_m(max(0.0, clipped_min_z - room.min_z)),
        "width": _round_m(width),
        "height": _round_m(height),
    }


def _near_space(box: BoundingBox, room: BoundingBox) -> bool:
    return (
        box.max_x >= room.min_x
        and box.min_x <= room.max_x
        and box.max_y >= room.min_y
        and box.min_y <= room.max_y
        and box.max_z >= room.min_z
        and box.min_z <= room.max_z
    )


def _element_name(element: Any) -> str:
    return str(getattr(element, "Name", "") or getattr(element, "GlobalId", "") or "IFC element")


def _unique_window_name(element: Any, used_names: set[str]) -> str:
    """Keep imported window names stable and unique for the JSON model contract."""
    base_name = (_element_name(element).strip() or "IFC window")[:120]
    global_id = str(getattr(element, "GlobalId", "") or "").strip()
    candidate = base_name
    suffix = global_id or "window"
    counter = 2
    while candidate in used_names:
        marker = f" ({suffix})" if counter == 2 else f" ({suffix}-{counter})"
        candidate = f"{base_name[: max(1, 120 - len(marker))]}{marker}"
        counter += 1
    used_names.add(candidate)
    return candidate


def _round_m(value: float) -> float:
    return round(float(value), 3)
