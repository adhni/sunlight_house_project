# Next Step

## Product direction

The next phase should narrow the product before expanding the model.

The current app already does a meaningful amount of sunlight simulation, but the main product question is still too loose. It can show sunlight geometry, daily exposure, and yearly / seasonal patterns, yet it is not obvious what decision the tool is helping a user make.

The next milestone should therefore focus on product clarity, interpretation, and simplification rather than more geometric scope.

## Core problem to solve

The app should help users answer a small set of practical questions:

- How much direct sun does this room get?
- When does the room get that sun?
- Is that sun likely to feel beneficial, neutral, or harsh?

This is a stronger near-term framing than trying to become a general room-planning tool.

## Product positioning

For now, the app should feel like:

- a sunlight planning tool
- a way to explore room orientation and window placement effects
- a lightweight interpretation tool for direct sun quality

For now, the app should not try to become:

- a full architectural modeling tool
- a general floor-plan editor
- a weather dashboard
- a complete thermal comfort simulator

## Main strategy

The strategy is:

1. Define the user decision more clearly
2. Simplify the interface around that decision
3. Add lightweight interpretation and recommendations
4. Improve interaction quality
5. Expand modeling scope only after the product becomes easier to understand and use

## Priority 1: Clarify the use cases

Before adding more features, the product should be described in terms of concrete use cases.

### Recommended near-term use cases

- compare how different window orientations change direct sun
- check whether a room gets useful winter sun
- spot whether a room may receive harsh summer sun
- understand where direct sunlight lands across the floor

### Why this matters

- it gives the UI a clearer purpose
- it helps decide which controls should be visible first
- it creates a basis for summaries and recommendations

## Priority 2: Simplify the UI with progressive disclosure

The current experience likely exposes too many controls too early relative to the value the user gets at first glance.

The next design pass should reduce initial cognitive load.

### Recommended direction

- show only the most important inputs by default
- keep advanced inputs hidden behind expandable sections
- make the primary result obvious immediately
- reduce label and control density where possible

### Likely default-visible controls

- location
- room size
- window facing
- one or two key window controls
- main result mode

### Likely advanced controls

- manual timezone override
- detailed geometry inputs
- finer simulation parameters
- comparison and expert-style tools

### Why this matters

- the app will feel easier to approach
- it better matches the current product maturity
- it makes the interpretation layer more visible

## Priority 3: Add a lightweight interpretation layer

This should be the first product-level improvement after simplification.

The existing model already provides enough signal to support a compact interpretation layer without becoming a weather product.

### Goal

Add a small summary that helps the user understand whether the sunlight is likely to be helpful, neutral, or harsh.

### First version

- add a compact `Sun Context` or `Summary` card near the main results
- combine:
  - direct sun hours from the existing model
  - simple temperature context
  - simple UV context
- produce short outputs such as:
  - `Helpful winter sun`
  - `Mostly mild sun`
  - `High UV caution`
  - `Likely overheating risk`

### Constraint

Do not turn this into a full weather dashboard.

### Why this matters

- users care about whether sunlight is desirable, not just present
- it translates geometry into a more human decision frame
- it responds directly to the feedback requesting summary and recommendation output

## Priority 4: Improve wording and result clarity

Some improvements are small but high value.

### Recommended quick wins

- rename the legend to `Direct sun exposure time (hours)` or similar
- make clear that the map is about direct sun, not generic daylight
- tighten supporting labels and helper text around the main charts
- clearly distinguish estimated yearly / seasonal views from the daily map

### Why this matters

- it removes basic ambiguity
- it improves trust without requiring major engineering work

## Priority 5: Improve direct manipulation

The current slider-based geometry controls are functional, but not ideal.

Direct manipulation should be a next-wave UX improvement after the app becomes clearer and simpler overall.

### Recommended direction

- allow click-and-drag window placement in the room view
- keep numeric controls available for precision
- use drag interaction to make the model feel more immediate and spatial

### Why not first

- better interaction will not solve weak product framing on its own
- the product should first become easier to understand at a higher level

## Priority 6: Defer custom room layouts

Custom room layouts are valuable, but they should not be the next step.

### Why to defer

- they increase model complexity
- they increase UI complexity
- they make simplification harder
- they risk expanding scope before the current product purpose is clear

### Better trigger for this work

Custom layouts become a stronger next step only after:

- the app has a clear product framing
- the simplified UI feels stable
- summary and recommendation features prove useful
- users still clearly want more geometric flexibility

## Suggested execution order

1. Rewrite the product framing around a few concrete sunlight-planning questions
2. Simplify the UI using progressive disclosure
3. Add the first compact summary / recommendation layer
4. Improve wording, labels, and chart clarity
5. Add direct manipulation for window placement
6. Reassess whether broader geometry support is justified

## Definition of next milestone

The next milestone is done when:

- the app clearly communicates what problem it helps solve
- the first screen feels less overwhelming
- the results explain what the sunlight means, not only how many hours there are
- the app still feels like a sunlight planner rather than a general modeling tool

## Practical takeaway

The right next move is not more geometry first.

The right next move is to make the current product easier to understand, easier to use, and more explicit about the decisions it supports.
