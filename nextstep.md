# Next Step

## Current product state

The prototype is now in a stronger interactive state:

- live room snapshot
- live `Direct Sun Hours Today` map with legend, stats, and in-chart hover
- yearly / seasonal floor maps with `Year`, `Winter`, `Spring`, `Summer`, and `Fall`
- preset cities, custom map-based location, and simpler room/window controls
- long-range exposure performance improved for deployment

The next work should shift from pure sunlight geometry toward sunlight interpretation.

## Priority 1: Add a lightweight sun-context layer

This is the best next step because the model already shows where and how long sunlight lands, but not whether that sunlight is helpful or punishing.

### Goal

Add just enough climate context to interpret direct sun as beneficial, neutral, or harsh.

### First version

- add a small `Sun Context` card near the results
- combine:
  - direct sun hours from the existing model
  - temperature context
  - UV context
- generate a short interpretation such as:
  - `Helpful winter sun`
  - `High UV caution`
  - `Likely overheating risk`
  - `Mostly mild sun`

### Constraint

Do not turn this into a full weather dashboard.

### Why this matters

- users care about whether sun is desirable, not only whether it exists
- it makes the app feel more useful without changing the core room model
- it creates a more human framing for the yearly / seasonal maps

## Priority 2: Keep the added data layer minimal

The project likely needs extra data, but the smallest useful version is enough.

### Recommended data

- temperature context
- UV context

### Recommended source style

- monthly or seasonal climate normals first
- avoid live forecasts in the first version

### Avoid for now

- precipitation
- wind
- humidity
- cloud cover
- hourly forecast panels
- a separate weather dashboard

### Why this matters

- keeps the UI focused
- avoids introducing a second product inside the product
- makes the interpretation layer easier to explain and maintain

## Priority 3: Decide how to express the interpretation

The new layer should stay lightweight and readable.

### Options

- one compact summary card
- one short caption under the daily and long-range maps
- a small badge system for `helpful`, `neutral`, and `harsh`

### Recommended direction

- start with one compact summary card
- keep the copy simple and high-level
- do not add another large chart unless needed later

## Priority 4: Continue deployment validation

The long-range performance work is now in place, so the next operational step is to observe real behavior on Render.

### Deployment tasks

- verify yearly / seasonal tab load time on Render
- check the new long-range timing logs
- confirm the long-range request no longer fails
- verify the coarser yearly grid still feels believable

### Why this matters

- this confirms whether the recent performance fixes are enough
- it prevents more product work from piling onto an unstable long-range feature

## Suggested execution order

1. Define the smallest useful temperature + UV context layer
2. Decide where the interpretation appears in the UI
3. Add the first lightweight `Sun Context` card
4. Validate Render behavior after the long-range optimization

## Definition of next milestone

The next milestone is done when:

- the app can frame sunlight as helpful, neutral, or harsh
- the new context layer stays compact and easy to understand
- yearly / seasonal maps remain usable on Render
- the product still feels like a sunlight planner, not a weather dashboard
