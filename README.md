# Sunlight House Lab

Sunlight House Lab is a compact Python project for exploring direct sunlight inside a simple rectangular room.

Public live app: https://sunlight-house-project.onrender.com/

It includes:

- a small Flask app for interactive exploration
- a CLI demo that regenerates example plots
- a lightweight solar and geometry model that stays intentionally narrow

The current app is designed around editable wall windows on a rectangular room. The room stays axis-aligned internally, and the selected compass facing rotates the room relative to the real-world sun.

## What It Does

- computes solar elevation and azimuth from latitude, longitude, local datetime, and timezone
- models a rectangular room with one or more wall windows
- projects direct sunlight from each window onto the floor
- renders a top-down room snapshot for a selected moment
- estimates daily direct-sun-hours exposure across the floor
- estimates yearly and seasonal floor exposure using representative-day sampling
- exposes the model through a Flask web UI suitable for local use or Render deployment

## Current Defaults

The default scenario is a Melbourne daylight demo moment: `2026-01-15 10:00` in `Australia/Melbourne`. This keeps the first load visually useful even when the real current time is after sunset. Use the `Now` button to jump to the current time in the selected timezone.

Default room and window values:

- location: `Melbourne, Australia`
- timezone: `Australia/Melbourne`
- window facing: `NE`
- room: `4.0 m` width, `5.0 m` depth, `3.0 m` ceiling
- Window 1: front wall, centre from left `3.0 m`, sill `0.1 m`, width `1.5 m`, height `2.0 m`
- Window 2: right wall, centre from left `2.8 m`, sill `0.1 m`, width `1.5 m`, height `2.0 m`

The main result tab opens on `Current Moment`.

## Coordinate System

The core solar calculations use a local East-North-Up frame:

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
- `90 deg` = overhead

The sun vector uses:

```python
x = cos(elevation) * sin(azimuth)
y = cos(elevation) * cos(azimuth)
z = sin(elevation)
```

## Web App

Run locally:

```bash
PORT=5001 python3 app.py
```

Then open `http://127.0.0.1:5001`.

The app currently includes:

- preset locations for Melbourne, Jakarta, and Boston
- a custom location mode with draggable map marker
- manual latitude and longitude fields
- manual timezone override under a collapsible advanced section
- an 8-direction window-facing selector
- compact multi-window editing controls
- collapsible room geometry controls
- day-of-year and time-of-day scrubbers
- a `Now` button for the selected timezone
- a `Current Moment` room snapshot
- a `Direct Sun Hours Today` floor map with legend, stats, and in-chart tooltip
- a `Yearly / Seasonal` floor map with `Year`, `Winter`, `Spring`, `Summer`, and `Fall`
- a frontend-only baseline compare tool using `localStorage`

## Long-Range Exposure Logic

Daily exposure uses the selected day with the configured day step.

Yearly and seasonal exposure are estimated rather than fully simulated. The current long-range method:

- chooses `8` representative days per month
- samples each representative day hourly
- keeps only daylight hours where solar elevation is above the horizon
- weights each representative day by how many calendar days it stands in for
- renders long-range results on a coarser floor grid than the daily map
- aggregates into `Year`, `Winter`, `Spring`, `Summer`, and `Fall`

Season labels are hemisphere-aware:

- northern hemisphere:
  - winter: `Dec-Feb`
  - spring: `Mar-May`
  - summer: `Jun-Aug`
  - fall: `Sep-Nov`
- southern hemisphere:
  - winter: `Jun-Aug`
  - spring: `Sep-Nov`
  - summer: `Dec-Feb`
  - fall: `Mar-May`

Long-range maps should be treated as estimated planning views, not engineering-grade annual simulations.

## CLI Demo

Run:

```bash
python3 run_demo.py
```

The demo regenerates example plots in `outputs/` using the default Melbourne scenario.

## Project Layout

```text
sunlight_house_project/
├── app.py
├── README.md
├── render.yaml
├── requirements.txt
├── run_demo.py
├── outputs/
├── static/
│   ├── app.js
│   └── styles.css
├── templates/
│   └── index.html
├── tests/
│   ├── test_analysis.py
│   ├── test_app.py
│   └── test_config.py
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

## Run Tests

The repo uses Python's built-in `unittest` test runner.

```bash
python3 -m unittest discover -s tests
```

## Render Deployment

The repo includes `render.yaml` for a simple Python web service.

Render uses:

- build command: `pip install -r requirements.txt`
- start command: `python3 -m gunicorn app:app --bind 0.0.0.0:$PORT`
- health check path: `/healthz`

## Notes And Limits

- The geometry model is intentionally simple and axis-aligned.
- The web app exposes compact controls for multiple axis-aligned wall windows.
- The model does not include blinds, overhangs, furniture, diffuse sky light, reflections, or external obstructions.
- Floor patches are generated from projected window corners and clipped into room bounds, so edge behavior is still a simplification.
