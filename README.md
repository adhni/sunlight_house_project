# Sunlight House Simulation

This project is a compact Python prototype for solar position and direct-sunlight entry in a simple rectangular room. It now includes both:

- a CLI demo that regenerates the example PNG outputs
- a small Flask web app that lets you explore the same model interactively

The goal stays deliberately narrow: physically meaningful solar angles, simple wall-window geometry, direct-sunlight checks, and easy-to-read plots.

## What the project does

- computes solar elevation and azimuth for a fixed location
- uses azimuth in degrees clockwise from north
- uses elevation in degrees above the horizon
- converts solar angles into a unit sun vector in local ENU coordinates
- models a rectangular room with one or more axis-aligned wall windows
- ignores windows when the sun is behind the glazing
- projects direct sunlight rays from the window corners onto the floor
- compares Melbourne winter and summer behavior
- produces daily and yearly visualizations
- exposes the model through a simple web interface suitable for Render deployment

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

For Melbourne in the southern hemisphere, the sun is typically north of the building around solar noon, especially in winter. The default model uses that convention consistently.

## Room model

The default room is:

- width: `6.0 m` in the east-west direction
- depth: `5.0 m` in the south-north direction
- height: `3.0 m`

The default window is on the north wall:

- wall: north
- horizontal center: `x = 3.0 m`
- center height: `z = 1.5 m`
- width: `2.4 m`
- height: `1.6 m`
- outward normal: `(0, 1, 0)`

Sunlight only enters when the sun vector has a positive dot product with the window's outward normal. That dot product is also used as a simple direct-sunlight intensity proxy.

## Main functions

The core API is intentionally small:

- `get_sun_position()`
- `sun_vector()`
- `intersects_window()`
- `project_to_floor()`

## Project layout

```text
sunlight_house_project/
├── app.py
├── README.md
├── render.yaml
├── requirements.txt
├── run_demo.py
├── outputs/
├── static/
│   └── styles.css
├── templates/
│   └── index.html
└── sunlight_house/
    ├── __init__.py
    ├── analysis.py
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

## Run the CLI demo

```bash
python3 run_demo.py
```

The demo:

1. prints sample Melbourne sun positions for solstice and equinox dates
2. simulates one full day every 10 minutes for June 21 and December 21
3. simulates a full year hourly for Melbourne
4. saves plots into `outputs/`
5. prints whether direct sunlight entered for the default Melbourne room

## Run the web app locally

```bash
python3 app.py
```

Then open `http://127.0.0.1:5000`.

The web app includes:

- a draggable map marker for latitude and longitude
- day-of-year and time-of-day levers for quick exploration
- visible azimuth and elevation angle widgets
- a client-side top-down room snapshot for the selected moment
- form controls for location, timezone, room, and window geometry
- a daily window-intensity plot
- a daily floor-patch plot
- a yearly peak-elevation plot
- a seasonal comparison plot for summer solstice, equinox, and winter solstice

The live explorer is inspired by tools such as SunCalc, but it remains focused on this project's own direct-sunlight room model rather than trying to clone the full SunCalc feature set.

## Render deployment

The repo includes `render.yaml` for a simple Python web service.

Render uses:

- build command: `pip install -r requirements.txt`
- start command: `python3 -m gunicorn app:app`

If you prefer to configure Render manually instead of using `render.yaml`, use the same commands.

## Output plots

Running the CLI demo regenerates these example files in `outputs/`:

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
- Timezone handling uses `zoneinfo`, so daylight saving changes are respected.
- The yearly summary is sampled hourly by default.
- The daily plots are sampled every 10 minutes by default.

## Notes on the geometry model

- The geometry is axis-aligned and intentionally simple.
- Windows must lie on one of the room walls and carry an outward-facing wall normal.
- If the sun is below the horizon or behind the glass, the window is ignored.
- Direct rays are projected from the window corners to the floor plane `z = 0`.
- The model does not include blinds, overhangs, furniture, diffuse light, reflections, or inter-room shading.
