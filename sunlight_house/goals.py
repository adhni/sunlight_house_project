from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from typing import Literal

import numpy as np

from .analysis import point_in_polygon, room_sun_vector
from .config import COMPASS_OPTIONS, SimulationConfig, window_on_wall
from .geometry import patches_for_windows
from .solar import generate_day_positions


GoalDirection = Literal["maximize", "minimize"]


@dataclass(frozen=True)
class GoalDefinition:
    key: str
    label: str
    question: str
    direction: GoalDirection
    target_hours: float
    start_hour: int
    end_hour: int
    date_mode: Literal["selected", "winter", "summer"]


GOAL_DEFINITIONS: dict[str, GoalDefinition] = {
    "winter_warmth": GoalDefinition(
        key="winter_warmth",
        label="Winter warmth",
        question="Can this spot receive useful direct winter sun?",
        direction="maximize",
        target_hours=2.0,
        start_hour=8,
        end_hour=16,
        date_mode="winter",
    ),
    "summer_protection": GoalDefinition(
        key="summer_protection",
        label="Summer protection",
        question="Can this spot stay out of strong midday and afternoon summer sun?",
        direction="minimize",
        target_hours=0.5,
        start_hour=11,
        end_hour=18,
        date_mode="summer",
    ),
    "morning_sun": GoalDefinition(
        key="morning_sun",
        label="Morning sun",
        question="Does this spot receive direct sun during the morning?",
        direction="maximize",
        target_hours=1.5,
        start_hour=6,
        end_hour=12,
        date_mode="selected",
    ),
    "screen_protection": GoalDefinition(
        key="screen_protection",
        label="Screen protection",
        question="Can this work spot avoid direct sun through the working day?",
        direction="minimize",
        target_hours=0.25,
        start_hour=8,
        end_hour=18,
        date_mode="selected",
    ),
}

_PROBE_STEP_MINUTES = 20


def _season_date(config: SimulationConfig, mode: str, selected_date: date) -> date:
    if mode == "selected":
        return selected_date
    southern_hemisphere = config.location.latitude < 0.0
    if mode == "winter":
        month = 6 if southern_hemisphere else 12
    else:
        month = 12 if southern_hemisphere else 6
    return date(config.year, month, 21)


def _window_wall(window) -> str:
    normal = tuple(round(float(value), 3) for value in window.outward_normal)
    return {
        (0.0, 1.0, 0.0): "north",
        (0.0, -1.0, 0.0): "south",
        (1.0, 0.0, 0.0): "east",
        (-1.0, 0.0, 0.0): "west",
    }[normal]


def _movement_direction_label(config: SimulationConfig, wall: str, delta: float) -> str:
    if wall in {"north", "south"}:
        local_bearing = 90.0 if delta > 0.0 else 270.0
    else:
        local_bearing = 0.0 if delta > 0.0 else 180.0
    world_bearing = (config.window_facing_deg + local_bearing) % 360.0
    compass_labels = [label for label, _angle in COMPASS_OPTIONS]
    return compass_labels[int(round(world_bearing / 45.0)) % len(compass_labels)]


def _window_rows(config: SimulationConfig) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for window in config.windows:
        wall = _window_wall(window)
        span_center = float(window.center[0] if wall in {"north", "south"} else window.center[1])
        rows.append(
            {
                "name": window.name,
                "wall": wall,
                "span_center": round(span_center, 4),
                "sill_height": round(float(window.center[2] - window.height / 2.0), 4),
                "width": round(float(window.width), 4),
                "height": round(float(window.height), 4),
            }
        )
    return rows


def _zone_points(config: SimulationConfig, x: float, y: float, size: float) -> tuple[np.ndarray, dict[str, float]]:
    half = size / 2.0
    min_x = max(0.0, x - half)
    max_x = min(config.room.width, x + half)
    min_y = max(0.0, y - half)
    max_y = min(config.room.depth, y + half)
    xs = np.linspace(min_x, max_x, 3)
    ys = np.linspace(min_y, max_y, 3)
    points = np.array([[point_x, point_y] for point_y in ys for point_x in xs], dtype=float)
    return points, {
        "x": float(x),
        "y": float(y),
        "size": float(size),
        "min_x": float(min_x),
        "max_x": float(max_x),
        "min_y": float(min_y),
        "max_y": float(max_y),
        "sample_count": int(len(points)),
    }


def _format_time(moment: datetime) -> str:
    return moment.strftime("%H:%M")


def _probe_positions(config: SimulationConfig, target_date: date, goal: GoalDefinition):
    positions = generate_day_positions(
        config.location.latitude,
        config.location.longitude,
        config.location.timezone_name,
        datetime.combine(target_date, time.min),
        step_minutes=_PROBE_STEP_MINUTES,
    )
    return [
        (moment, position)
        for moment, position in positions
        if goal.start_hour <= moment.hour < goal.end_hour and position.elevation_deg > 0.0
    ]


def _sun_intervals(timeline: list[dict[str, object]], step_minutes: int) -> list[dict[str, object]]:
    intervals: list[dict[str, object]] = []
    active: dict[str, object] | None = None
    for sample in timeline:
        if float(sample["coverage"]) > 0.0:
            if active is None:
                active = {
                    "start": sample["time"],
                    "end": sample["time"],
                    "coverage_total": 0.0,
                    "samples": 0,
                }
            active["end"] = _format_time(sample["moment"] + timedelta(minutes=step_minutes))
            active["coverage_total"] = float(active["coverage_total"]) + float(sample["coverage"])
            active["samples"] = int(active["samples"]) + 1
        elif active is not None:
            active["average_coverage"] = float(active.pop("coverage_total")) / int(active.pop("samples"))
            intervals.append(active)
            active = None
    if active is not None:
        active["average_coverage"] = float(active.pop("coverage_total")) / int(active.pop("samples"))
        intervals.append(active)
    return intervals


def evaluate_probe(
    config: SimulationConfig,
    target_date: date,
    goal: GoalDefinition,
    *,
    x: float,
    y: float,
    size: float,
    _positions=None,
) -> dict[str, object]:
    points, zone = _zone_points(config, x, y, size)
    positions = _positions if _positions is not None else _probe_positions(config, target_date, goal)

    timeline: list[dict[str, object]] = []
    contribution_samples = {window.name: 0.0 for window in config.windows}
    weighted_samples = 0.0
    any_sun_samples = 0

    for moment, position in positions:
        room_vector = room_sun_vector(config, position)
        patches = patches_for_windows(config.room, config.windows, room_vector, config.obstructions)
        union_hits = np.zeros(len(points), dtype=bool)
        window_hits: dict[str, np.ndarray] = {
            window.name: np.zeros(len(points), dtype=bool) for window in config.windows
        }
        for patch in patches:
            hits = np.array([point_in_polygon(point, patch.polygon_xy) for point in points], dtype=bool)
            union_hits |= hits
            window_hits[patch.window_name] |= hits
        coverage = float(np.count_nonzero(union_hits) / len(points))
        weighted_samples += coverage
        any_sun_samples += int(coverage > 0.0)
        for name, hits in window_hits.items():
            contribution_samples[name] += float(np.count_nonzero(hits) / len(points))
        dominant_window = (
            max(window_hits, key=lambda name: np.count_nonzero(window_hits[name]))
            if np.any(union_hits)
            else ""
        )
        timeline.append(
            {
                "moment": moment,
                "time": _format_time(moment),
                "minutes": moment.hour * 60 + moment.minute,
                "coverage": coverage,
                "dominant_window": dominant_window,
            }
        )

    sample_hours = _PROBE_STEP_MINUTES / 60.0
    direct_hours = weighted_samples * sample_hours
    any_sun_hours = any_sun_samples * sample_hours
    intervals = _sun_intervals(timeline, _PROBE_STEP_MINUTES)
    contributions = [
        {
            "window_name": name,
            "hours": value * sample_hours,
        }
        for name, value in sorted(contribution_samples.items(), key=lambda item: item[1], reverse=True)
        if value > 0.0
    ]
    if goal.direction == "maximize":
        met = direct_hours >= goal.target_hours
        score = min(100.0, direct_hours / goal.target_hours * 100.0) if goal.target_hours else 100.0
    else:
        met = direct_hours <= goal.target_hours
        score = 100.0 if met else max(0.0, 100.0 - (direct_hours - goal.target_hours) / 2.0 * 100.0)

    return {
        "date": target_date.isoformat(),
        "date_label": target_date.strftime("%d %b %Y"),
        "window_start": goal.start_hour * 60,
        "window_end": goal.end_hour * 60,
        "direct_sun_hours": direct_hours,
        "any_sun_hours": any_sun_hours,
        "score": score,
        "goal_met": met,
        "first_sun": intervals[0]["start"] if intervals else None,
        "last_sun": intervals[-1]["end"] if intervals else None,
        "intervals": intervals,
        "timeline": [
            {key: value for key, value in sample.items() if key != "moment"}
            for sample in timeline
        ],
        "window_contributions": contributions,
        "zone": zone,
        "step_minutes": _PROBE_STEP_MINUTES,
    }


def _replace_window(config: SimulationConfig, index: int, *, span: float, sill: float, width: float):
    source = config.windows[index]
    wall = _window_wall(source)
    replacement = window_on_wall(
        name=source.name,
        room=config.room,
        wall=wall,
        span_center=span,
        center_height=sill + float(source.height) / 2.0,
        width=width,
        height=float(source.height),
    )
    windows = list(config.windows)
    windows[index] = replacement
    return replace(config, windows=tuple(windows))


def _suggestion_candidates(
    config: SimulationConfig,
    *,
    eaves_variant: tuple[SimulationConfig, bool] | None,
) -> list[dict[str, object]]:
    candidates: list[dict[str, object]] = []
    for index, window in enumerate(config.windows):
        wall = _window_wall(window)
        span_limit = config.room.width if wall in {"north", "south"} else config.room.depth
        span = float(window.center[0] if wall in {"north", "south"} else window.center[1])
        sill = float(window.center[2] - window.height / 2.0)
        width = float(window.width)
        name = window.name.replace("_", " ")

        for delta in (-0.35, 0.35):
            next_span = min(max(span + delta, width / 2.0), span_limit - width / 2.0)
            actual_delta = next_span - span
            if abs(actual_delta) < 0.1:
                continue
            direction = _movement_direction_label(config, wall, actual_delta)
            wall_label = {
                "north": "front",
                "east": "right",
                "south": "back",
                "west": "left",
            }[wall]
            variant = _replace_window(config, index, span=next_span, sill=sill, width=width)
            candidates.append(
                {
                    "config": variant,
                    "title": f"Move {name} {abs(actual_delta):.2f} m {direction} along the {wall_label} wall",
                    "change_type": "position",
                    "tradeoff": "Keeps the opening size, but changes where its direct beam lands.",
                    "apply": {"windows": _window_rows(variant)},
                }
            )

        width_step = min(0.3, max(width * 0.2, 0.15))
        for delta in (-width_step, width_step):
            next_width = min(max(width + delta, 0.35), span_limit)
            next_width = min(next_width, 2.0 * min(span, span_limit - span))
            if abs(next_width - width) < 0.1:
                continue
            variant = _replace_window(config, index, span=span, sill=sill, width=next_width)
            candidates.append(
                {
                    "config": variant,
                    "title": f"Make {name} {abs(next_width - width):.2f} m {'wider' if next_width > width else 'narrower'}",
                    "change_type": "width",
                    "tradeoff": (
                        "A wider opening may also increase diffuse light, heat and cost beyond this direct-sun model."
                        if next_width > width
                        else "A narrower opening may reduce diffuse daylight and the outside view."
                    ),
                    "apply": {"windows": _window_rows(variant)},
                }
            )

        for delta in (-0.2, 0.2):
            next_sill = min(max(sill + delta, 0.0), config.room.height - float(window.height))
            if abs(next_sill - sill) < 0.08:
                continue
            variant = _replace_window(config, index, span=span, sill=next_sill, width=width)
            candidates.append(
                {
                    "config": variant,
                    "title": f"Move {name} {abs(next_sill - sill):.2f} m {'higher' if next_sill > sill else 'lower'}",
                    "change_type": "height",
                    "tradeoff": "Keeps the glass area constant, but changes sightlines and where the beam reaches the floor.",
                    "apply": {"windows": _window_rows(variant)},
                }
            )

    if eaves_variant is not None:
        variant, enabled = eaves_variant
        candidates.append(
            {
                "config": variant,
                "title": f"{'Add' if enabled else 'Remove'} the modelled roof eaves",
                "change_type": "eaves",
                "tradeoff": "The model uses a fixed eave depth; construction, rain protection and appearance need separate review.",
                "apply": {"eaves_enabled": enabled},
            }
        )
    return candidates


def goal_studio_payload(
    config: SimulationConfig,
    selected_date: date,
    *,
    goal_key: str,
    x: float,
    y: float,
    size: float,
    eaves_variant: tuple[SimulationConfig, bool] | None = None,
) -> dict[str, object]:
    try:
        goal = GOAL_DEFINITIONS[goal_key]
    except KeyError as exc:
        valid = ", ".join(GOAL_DEFINITIONS)
        raise ValueError(f"Goal must be one of: {valid}.") from exc

    analysis_date = _season_date(config, goal.date_mode, selected_date)
    positions = _probe_positions(config, analysis_date, goal)
    baseline = evaluate_probe(config, analysis_date, goal, x=x, y=y, size=size, _positions=positions)
    suggestions: list[dict[str, object]] = []
    for candidate in _suggestion_candidates(config, eaves_variant=eaves_variant):
        projected = evaluate_probe(
            candidate["config"],
            analysis_date,
            goal,
            x=x,
            y=y,
            size=size,
            _positions=positions,
        )
        base_hours = float(baseline["direct_sun_hours"])
        projected_hours = float(projected["direct_sun_hours"])
        improvement = (
            projected_hours - base_hours
            if goal.direction == "maximize"
            else base_hours - projected_hours
        )
        if improvement < 0.05:
            continue
        suggestions.append(
            {
                "title": candidate["title"],
                "change_type": candidate["change_type"],
                "reason": (
                    f"The sampled zone gains {improvement:.2f} coverage-weighted direct-sun hours."
                    if goal.direction == "maximize"
                    else f"The sampled zone avoids {improvement:.2f} coverage-weighted direct-sun hours."
                ),
                "tradeoff": candidate["tradeoff"],
                "projected_hours": projected_hours,
                "projected_score": projected["score"],
                "improvement_hours": improvement,
                "apply": candidate["apply"],
            }
        )
    suggestions.sort(key=lambda item: (float(item["improvement_hours"]), float(item["projected_score"])), reverse=True)

    return {
        "goal": {
            "key": goal.key,
            "label": goal.label,
            "question": goal.question,
            "direction": goal.direction,
            "target_hours": goal.target_hours,
            "target_copy": (
                f"Target: at least {goal.target_hours:g} coverage-weighted hours"
                if goal.direction == "maximize"
                else f"Target: no more than {goal.target_hours:g} coverage-weighted hours"
            ),
        },
        "probe": baseline,
        "suggestions": suggestions[:3],
        "tested_change_count": len(_suggestion_candidates(config, eaves_variant=eaves_variant)),
        "method": (
            f"The zone uses 9 evenly spaced floor samples every {_PROBE_STEP_MINUTES} minutes. "
            "Suggestions change one window property or the existing fixed-depth eaves at a time; everything else stays fixed. "
            "Window contribution rows are calculated separately, so overlapping beams can appear in more than one row."
        ),
        "scope_note": (
            "This compares direct beam sunlight only. It does not calculate diffuse daylight, reflections, glare probability, "
            "heat gain, energy use, structure or construction cost."
        ),
    }
