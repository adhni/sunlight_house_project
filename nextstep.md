# Next Step

## Current product state

The prototype is now in a solid interactive state:

- live room snapshot
- live direct-sun-hours map for the selected day
- preset cities and simple room/window controls
- cleaner Git state with generated `outputs/` ignored

The next work should focus on making the sunlight map easier to read, then extending the same idea across a full year.

## Priority 1: Improve the daily sunlight map

This is the best immediate step because the data is already there.

### Goal

Make `Direct Sun Hours Today` easy to interpret without explanation.

### Improvements

- add a visible legend with hour bands
- add hover or click readout for a floor cell
- add simple summary stats near the map:
  - peak direct sun hours
  - percent of room with any direct sun
  - average direct sun hours over sunlit cells
- tighten the caption so it explains the map in one sentence
- use a more intentional warm color scale from `0 h` to `max h`

### Why this matters

- users can understand the result faster
- the app becomes more useful for planning desk, sofa, plant, or TV placement
- this prepares the UI pattern for yearly maps later

## Priority 2: Add a yearly sunlight-hours floor map

This is the highest-value next feature.

### Goal

Show which parts of the room get the most direct sun across longer periods.

### Suggested views

- yearly total direct-sun hours
- winter direct-sun hours
- summer direct-sun hours
- optional morning / afternoon filters later

### Output

- same top-down room view
- same grid-based heatmap style as the daily map
- same legend model, but in yearly or seasonal hours

### Why this matters

- this is the first genuinely useful furniture-planning feature
- users can compare protected zones vs high-exposure zones over time
- it avoids relying on one selected day only

## Priority 3: Add simple furniture-planning overlays

Only do this after the yearly map exists.

### First version

- simple rectangular blocks
- desk
- sofa
- bed
- dining table

### User interaction

- drag or place a block in the room
- show exposure summary for that block footprint

### Example summary

- `Desk: 2.1 h direct sun on selected day`
- `Sofa zone: high summer afternoon exposure`

### Constraint

Do not turn this into a CAD tool.

## Priority 4: Render deployment polish

The app is already deployable, but a public prototype should be tightened a little.

### Deployment tasks

- verify the Render service from `main`
- check homepage load time
- verify `/healthz`
- verify `/api/snapshot`
- verify the live daily map works after cold start

### Likely issue

- Render cold starts may make the first load feel slow

### Mitigation

- keep the homepage lightweight
- avoid unnecessary server-side plot generation on first load

## Suggested execution order

1. Improve daily sunlight map readability
2. Deploy or verify on Render
3. Build yearly sunlight-hours map
4. Add simple furniture overlays

## Definition of next milestone

The next milestone is done when:

- the daily map has a clear legend and summaries
- the app is live on Render
- a user can compare direct sun hours for a selected day without needing explanation
