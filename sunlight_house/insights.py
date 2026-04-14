from __future__ import annotations

from datetime import datetime


def summarize_direct_sun(
    *,
    snapshot_state: str,
    entered_direct_sun: bool,
    peak_hours: float,
    sunlit_fraction: float,
    peak_time: datetime | None,
) -> dict[str, str]:
    headline = "Moderate direct sun today"
    tone = "neutral"

    if not entered_direct_sun or peak_hours <= 0.0:
        headline = "No direct sun reaches the floor"
        tone = "off"
    elif peak_hours >= 4.0 and sunlit_fraction < 0.2:
        headline = "Strong but concentrated direct sun"
        tone = "strong"
    elif peak_hours >= 4.0:
        headline = "Strong direct sun across the room"
        tone = "strong"
    elif sunlit_fraction >= 0.45:
        headline = "Broad direct sun coverage"
        tone = "active"
    elif peak_hours <= 1.5 and sunlit_fraction <= 0.2:
        headline = "Limited direct sun today"
        tone = "muted"

    coverage_pct = round(sunlit_fraction * 100)
    supporting_bits = [
        f"{coverage_pct}% of the room gets some direct sun",
        f"with a peak floor-cell exposure of {peak_hours:.1f} h",
    ]

    if peak_time is not None and entered_direct_sun:
        supporting_bits.append(f"and the strongest floor patch appears around {peak_time.strftime('%H:%M %Z')}")

    supporting_text = ", ".join(supporting_bits) + "."

    if snapshot_state == "floor_hit":
        moment_text = "Right now the sun reaches the floor."
    elif snapshot_state == "through_window_no_floor_hit":
        moment_text = "Right now the sun enters the window but does not reach the floor."
    else:
        moment_text = "Right now the sun does not enter this window."

    return {
        "headline": headline,
        "tone": tone,
        "supporting_text": supporting_text,
        "moment_text": moment_text,
    }
