from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

_MPL_DIR = Path(".mplconfig")
_MPL_DIR.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_MPL_DIR.resolve()))

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.lines import Line2D
from matplotlib.patches import Polygon, Rectangle

from .geometry import Room, SunlightPatch, Window
from .solar import SunPosition


def plot_floor_patches(
    room: Room,
    windows: tuple[Window, ...],
    patches_over_time: list[tuple[datetime, list[SunlightPatch]]],
    title: str,
    output_path: str,
) -> None:
    fig, ax = plt.subplots(figsize=(8.5, 6.5))
    ax.add_patch(Rectangle((0, 0), room.width, room.depth, fill=False, linewidth=2.0, edgecolor="black"))

    for window in windows:
        segment = window.wall_segment_xy()
        ax.plot(segment[:, 0], segment[:, 1], linewidth=5, solid_capstyle="butt", label=window.name.replace("_", " "))

    cmap = plt.colormaps["YlOrBr"]
    total_steps = max(len(patches_over_time) - 1, 1)
    for idx, (dt, patches) in enumerate(patches_over_time):
        color = cmap(0.35 + 0.55 * idx / total_steps)
        for patch in patches:
            poly = Polygon(
                patch.polygon_xy,
                closed=True,
                facecolor=color,
                edgecolor=color,
                linewidth=1.0,
                alpha=0.18 + 0.45 * patch.intensity,
            )
            ax.add_patch(poly)
            centroid = patch.polygon_xy.mean(axis=0)
            ax.text(centroid[0], centroid[1], dt.strftime("%H:%M"), fontsize=7, ha="center", va="center")

    ax.text(room.width / 2.0, room.depth + 0.25, "North", ha="center", va="bottom", fontsize=10)
    ax.text(room.width + 0.25, room.depth / 2.0, "East", ha="left", va="center", fontsize=10, rotation=90)
    ax.set_xlim(-0.3, room.width + 0.7)
    ax.set_ylim(-0.3, room.depth + 0.55)
    ax.set_aspect("equal", adjustable="box")
    ax.grid(True, linestyle="--", linewidth=0.5, alpha=0.4)
    ax.set_xlabel("x position (m, east)")
    ax.set_ylabel("y position (m, north)")
    ax.set_title(title)

    if patches_over_time:
        handles = [
            Line2D([0], [0], color="black", linewidth=5, label="Window"),
            Line2D([0], [0], marker="s", color=cmap(0.75), linestyle="", markersize=10, alpha=0.6, label="Sun patch"),
        ]
        ax.legend(handles=handles, loc="upper left")

    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_daily_intensity(
    times: list[datetime],
    intensities_by_window: dict[str, list[float]],
    title: str,
    output_path: str,
) -> None:
    fig, ax = plt.subplots(figsize=(9.5, 4.8))
    for window_name, intensities in intensities_by_window.items():
        ax.plot(times, intensities, linewidth=2.0, label=window_name.replace("_", " "))

    ax.set_title(title)
    ax.set_ylabel("Direct sunlight factor (0-1)")
    ax.set_xlabel("Local time")
    ax.set_ylim(0.0, 1.05)
    ax.grid(True, linestyle="--", linewidth=0.5, alpha=0.5)
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=2))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    if len(intensities_by_window) > 1:
        ax.legend()
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_yearly_noon_elevation(
    times: list[datetime],
    positions: list[SunPosition],
    key_dates: dict[str, datetime],
    title: str,
    output_path: str,
) -> None:
    elevations = [p.elevation_deg for p in positions]
    fig, ax = plt.subplots(figsize=(10, 4.8))
    ax.plot(times, elevations, linewidth=2.0, color="#c96b22")
    ax.set_title(title)
    ax.set_ylabel("Daily peak solar elevation (deg)")
    ax.set_xlabel("Date")
    ax.grid(True, linestyle="--", linewidth=0.5, alpha=0.5)
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=1))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b"))

    for label, dt in key_dates.items():
        ax.axvline(dt, color="0.4", linestyle=":", linewidth=1.0)
        y_value = np.interp(mdates.date2num(dt), mdates.date2num(times), elevations)
        ax.scatter([dt], [y_value], color="#1f4e79", zorder=3)
        ax.text(dt, y_value + 1.0, label, rotation=90, ha="center", va="bottom", fontsize=8)

    fig.autofmt_xdate()
    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def plot_key_date_solar_angles(
    daily_positions: dict[str, list[tuple[datetime, SunPosition]]],
    title: str,
    output_path: str,
) -> None:
    fig, (ax_el, ax_az) = plt.subplots(2, 1, figsize=(10, 7), sharex=True)
    colors = ["#1f4e79", "#2f855a", "#b85c38"]

    for color, (label, series) in zip(colors, daily_positions.items()):
        times = [dt.hour + dt.minute / 60.0 for dt, _ in series]
        elevations = [pos.elevation_deg for _, pos in series]
        azimuths = [pos.azimuth_deg for _, pos in series]
        ax_el.plot(times, elevations, linewidth=2.0, label=label, color=color)
        ax_az.plot(times, azimuths, linewidth=2.0, label=label, color=color)

    ax_el.set_title(title)
    ax_el.set_ylabel("Elevation (deg)")
    ax_el.grid(True, linestyle="--", linewidth=0.5, alpha=0.5)
    ax_el.legend()

    ax_az.set_ylabel("Azimuth from north (deg, clockwise)")
    ax_az.set_xlabel("Local time")
    ax_az.grid(True, linestyle="--", linewidth=0.5, alpha=0.5)
    ax_az.set_xlim(0.0, 24.0)
    tick_hours = list(range(0, 25, 2))
    ax_az.set_xticks(tick_hours)
    ax_az.set_xticklabels([f"{hour:02d}:00" for hour in tick_hours])

    fig.tight_layout()
    fig.savefig(output_path, dpi=180)
    plt.close(fig)
