# Sunlight House Simulation

This project is a compact Python prototype for solar position and direct-sunlight entry in a simple rectangular room. It keeps the geometry deliberately small and readable while staying physically meaningful enough to compare Melbourne winter and summer behavior.

## What the prototype does

- computes solar elevation and azimuth for a fixed location
- treats azimuth as degrees clockwise from north
- treats elevation as degrees above the horizon
- converts solar angles into a unit sun vector in local ENU coordinates
- models a rectangular room with one or more wall windows
- ignores windows when the sun is behind the glazing
- projects direct sunlight rays from the window corners onto the floor
- produces Melbourne examples for the June 21 winter solstice and December 21 summer solstice
- generates an hourly yearly solar-angle summary and daily room-sunlight plots

## Coordinate system and conventions

The room and solar calculations use a local East-North-Up frame:

- `x`: east
- `y`: north
- `z`: up

Solar azimuth is measured clockwise from north:

- `0 deg` = north
- `90 deg` = east
- `180 deg` = south
- `270 deg` = west

Solar elevation is measured above the horizon:

- `0 deg` = horizon
- `90 deg` = directly overhead

The unit sun vector points from the room toward the sun:

```python
x = cos(elevation) * sin(azimuth)
y = cos(elevation) * cos(azimuth)
z = sin(elevation)
```

For Melbourne in the southern hemisphere, the sun is generally to the north around solar noon, especially in winter. The default demo uses that convention consistently.

## Room model

The default room is:

- width: `6.0 m` in the east-west direction
- depth: `5.0 m` in the south-north direction
- height: `3.0 m`

The default window is on the north wall:

- center: `(3.0, 5.0, 1.5)`
- width: `2.4 m`
- height: `1.6 m`
- outward normal: `(0, 1, 0)`

Because the room interior is south of that wall, sunlight only enters when the sun vector has a positive dot product with the window's outward normal. That dot product is also used as a simple direct-sunlight intensity proxy.

## Main functions

The core API is intentionally small:

- `get_sun_position()`
- `sun_vector()`
- `intersects_window()`
- `project_to_floor()`

## Project layout

```text
sunlight_house_project/
├── README.md
├── requirements.txt
├── run_demo.py
├── outputs/
└── sunlight_house/
    ├── __init__.py
    ├── config.py
    ├── geometry.py
    ├── plotting.py
    └── solar.py
```

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If you do not want a virtual environment, `pip install -r requirements.txt` is enough.

## Run the demo

```bash
python3 run_demo.py
```

The demo will:

1. print sample Melbourne sun positions for solstice and equinox dates
2. simulate one full day every 10 minutes for June 21 and December 21
3. simulate a full year hourly for Melbourne
4. save all plots into `outputs/`
5. print whether direct sunlight entered for the default Melbourne room on the key daily examples

## Output plots

Running the demo regenerates these example files in `outputs/`:

- `june_21_winter_solstice_intensity.png`
  Direct sunlight factor on the default window every 10 minutes.
- `june_21_winter_solstice_patches.png`
  Top-down room view showing where direct sunlight lands on the floor through the day.
- `december_21_summer_solstice_intensity.png`
  Direct sunlight factor on the default window every 10 minutes.
- `december_21_summer_solstice_patches.png`
  Top-down room view showing summer floor patches.
- `melbourne_yearly_noon_elevation.png`
  Daily peak solar elevation derived from an hourly full-year simulation, with key seasonal dates marked.
- `melbourne_key_dates_solar_angles.png`
  Daily elevation and azimuth curves for summer solstice, equinox, and winter solstice.

## Regenerating outputs

Delete or keep the existing PNG files in `outputs/`, then rerun:

```bash
python3 run_demo.py
```

The script overwrites the standard example outputs with fresh results.

## Notes on the solar model

- Solar position uses a NOAA-style calculation from latitude, longitude, local datetime, and timezone.
- Naive datetimes are interpreted in the configured IANA timezone.
- Timezone handling uses `zoneinfo`, so Melbourne standard time and daylight saving time are both respected.
- The yearly summary is sampled hourly.
- The daily solstice runs are sampled every 10 minutes.

## Notes on the geometry model

- The geometry is axis-aligned and intentionally simple.
- Windows must lie on one of the room walls and carry an outward-facing wall normal.
- If the sun is below the horizon or behind the glass, the window is ignored.
- Direct rays are projected from the window corners to the floor plane `z = 0`.
- The model does not include blinds, overhangs, furniture, diffuse light, reflections, or inter-room shading.
