# Next Step Plan

## Current state

The project is in a good prototype state:

- core solar math is implemented and runnable
- the Flask web app works locally
- the UI now prioritizes room setup, then time exploration, then analysis
- `render.yaml` already exists for a simple Render web service

The next work should focus on two tracks:

1. making the product more useful for real room-planning decisions
2. publishing the current version to Render cleanly

## Product priorities

### 1. Annual floor exposure heatmap

This is the highest-value next feature.

Goal:

- show which parts of the floor get direct sun over a full year
- make it useful for furniture placement decisions

Suggested output:

- top-down room heatmap
- cumulative direct-sun hours by floor cell
- optional filters:
  - annual
  - winter
  - summer
  - morning
  - afternoon

Why this comes next:

- it is more actionable than a single-time snapshot
- it turns the prototype into a real planning tool

### 2. Furniture-planning mode

After the heatmap exists, add simple furniture overlays.

Start simple:

- rectangle blocks for sofa, desk, bed, dining table
- user can position them in the room
- show direct-sun exposure summary for each item footprint

Do not add full CAD-style editing.

### 3. Improve live workspace clarity

The current layout is much better, but it can still improve.

Next UI refinements:

- add clearer visual scale or room dimensions on the snapshot
- add a subtle window-position mini-preview in setup
- add better empty-state messaging when sunlight does not hit the floor
- reduce visual emphasis of angle widgets even further if they remain secondary

### 4. Performance pass

Before treating the web app as a public demo, reduce heavy page work.

Current risk:

- the main page renders several Matplotlib plots server-side on load

This is acceptable locally, but on Render free tier it may feel slow.

Recommended next performance changes:

- keep the live snapshot fast
- lazy-load analysis plots only when the user opens the analysis section
- or move heavy plot generation to explicit refresh actions only

## Render publish plan

## Goal

Deploy the current Flask app as a public web prototype on Render with minimal extra complexity.

## Current deployment assets

Already present:

- `render.yaml`
- `gunicorn` in `requirements.txt`
- `app = create_app()` in `app.py`
- `PORT` support in the Flask run path

Current Render config:

- build command: `pip install -r requirements.txt`
- start command: `python3 -m gunicorn app:app`

## Recommended deployment steps

### Phase 1. First public deploy

1. Create a new Web Service on Render from the GitHub repo.
2. Use the existing `render.yaml` if Render detects it.
3. Confirm branch is `main`.
4. Confirm runtime is Python.
5. Deploy the app.

### Phase 2. Post-deploy verification

After the first deploy, verify:

- homepage loads
- preset locations work
- room snapshot updates
- `/healthz` returns `200`
- `/api/snapshot` returns valid JSON
- analysis plots render without timeout

### Phase 3. Tighten for public sharing

If the deploy works, then improve operational quality:

- add a short app description in Render
- set the service name cleanly
- verify cold-start behavior
- check free-tier sleep/wake behavior

## Likely deployment risks

### 1. Slow first load

Most likely issue.

Reason:

- the server currently generates multiple plots on the main page request

Mitigation:

- lazy-load plots
- or generate fewer plots on initial load

### 2. Memory pressure

Possible if many plot requests happen close together.

Mitigation:

- keep figures closed cleanly
- avoid generating unnecessary plots on every request
- consider caching later if needed

### 3. Map tile dependency

The client map depends on public OpenStreetMap tiles.

Mitigation:

- acceptable for prototype use
- keep the map optional and hidden behind custom location

### 4. Free-tier cold start

Expected behavior on Render free plan.

Mitigation:

- mention it in README if needed
- keep app startup light

## Recommended near-term changes before public sharing

These are not blockers for first deploy, but they are worth doing soon:

1. Add lazy analysis loading.
2. Add a small deployment note to `README.md`.
3. Add a visible error state in the web UI if snapshot requests fail.
4. Consider pinning major dependency versions more tightly if deployment reproducibility becomes an issue.

## Suggested execution order

### Now

- deploy current app to Render
- verify homepage, snapshot API, and health endpoint

### Next

- reduce initial page weight by deferring heavy plots

### After that

- build annual floor exposure heatmap

### Then

- add furniture placement overlays and exposure scoring

## Definition of done for public prototype

The current version is good enough to publish once these are true:

- Render deploy succeeds from `main`
- homepage opens reliably
- snapshot interactions work
- no obvious server error on plot rendering
- README includes basic public run/deploy notes

## Nice-to-have later

- downloadable image export from the web UI
- shareable URLs for a saved room configuration
- more city presets
- multiple windows
- simple shading devices such as blinds or overhangs
