**SunRoom Astra — UI redesign plan**

Status: implemented on `codex/sunroom-ui-redesign`. The implementation uses local system fonts; user testing and cross-browser evaluation remain follow-up work. Primary audience assumption: homeowners exploring sunlight in a room, with deeper controls for technically confident users. The intended feel is a calm architectural workspace: the room is prominent, controls are precise, and the result is easy to understand.

The key workflow is: choose a location → adjust the room and windows → explore time → understand the result → try an improvement. A usable example should be available immediately; setup should not require a wizard.

**1. Resolve the current hierarchy problems**

The current page constrains its desktop shell to 1088 px, gives at least 420 px to settings, and stacks a large title, repeated headings, six result tabs, status text, and baseline controls before the model. Time controls appear both in the sidebar and below the 3D view. Location is below the geometry and architecture controls, while historical outdoor conditions appear near the top. Summaries repeat information in the model reading, page summary, and current-moment details.

The first redesign should redistribute attention toward the model and the current decision. Preserve discoverability of advanced tools through clearly named entry points. This follows the principle of showing common controls first and exposing specialized controls when requested; the grouping should be validated with users, rather than assumed to be correct because it looks cleaner. [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

**2. Use three main destinations**

| Destination | User question | Contents |
| --- | --- | --- |
| Room | Where does sunlight land at this time? | 3D/2D switch, room editing, window editing, furniture, one timeline, current sunlight reading |
| Sun exposure | Which areas get sunlight over a day or season? | Today, Seasons, Year; floor maps; one legend and a short explanation |
| Improve | What change helps this part of the room? | Goal selection, zone placement, measured suggestions, comparison, apply and undo |

Map the existing Now and 3D room views into Room. Move Today and Year estimate into Sun exposure. Rename Goal studio to Improve. Make Compare a workspace action. Move Outdoor context into the location panel, labelled “2025 reference data.” Keep IFC import in the workspace menu, labelled “Import room (IFC).” Put azimuth, elevation, vectors, sampling details, and model assumptions behind “Calculation details.”

Room should eventually open in 3D with a fast 2D preview while loading, and a working 2D fallback if WebGL fails. Keep navigation keyboard accessible. Preserve room state, selected object, camera, and time when changing destinations.

**3. Desktop layout**

```text
┌─────────────────────────────────────────────────────────────────────┐
│ SunRoom Astra       Melbourne ▾                 Compare       More ▾ │
├─────────────────────────────────────────────────────────────────────┤
│ Room       Sun exposure       Improve                               │
├───────────────────────────────────────────────┬─────────────────────┤
│ 3D / 2D                  Reset view  Display ▾│ Window 1            │
│                                               │ Front wall · NE     │
│                                               │                     │
│                                               │ Width       Height  │
│                  ROOM CANVAS                  │ Position    Sill    │
│                                               │                     │
│                                               │ Sunlight contribution│
│                                               │                     │
│                                               │ Back to room        │
├───────────────────────────────────────────────┤                     │
│ Date ▾   Play   ─────────●────────   10:00      │                     │
│             Sunrise     Noon      Sunset      │                     │
├───────────────────────────────────────────────┴─────────────────────┤
│ 10:00 · Direct sun reaches the floor.       Calculation details ▾    │
└─────────────────────────────────────────────────────────────────────┘
```

This is a structural wireframe, not a finished visual design. At normal desktop widths use a fluid main canvas and an approximately 300–340 px inspector. Start with 24 px outer gutters, 16–24 px between major areas, a compact header, and a canvas that uses the remaining useful screen height. Avoid a fixed-height layout that clips content at browser zoom. On a 1366 × 768 laptop, the model, time control, and primary editor fields should be visible together.

Use a single inspector: show room dimensions, orientation, and an object list when nothing is selected; show window properties when a window is selected; show furniture properties when furniture is selected. Keep a visible “Back to room” action and a list alternative to selecting tiny objects in the canvas. Do not move keyboard focus in response to background updates.

**4. Interaction rules**

- One current timestamp drives the model, fields, captions, and playback. Consolidate the two scrubbing interfaces. Make the displayed time match the rendered frame; preserve the existing 10-minute playback sampling and explain it briefly where appropriate. Rename the time action to “Use current time” so it cannot be mistaken for a view.
- Keep date and timezone visible near the timeline. Label the initial 2025 setup as an example. Do not make a historical demo or outdoor sample look live.
- Geometry fields update the preview after a short debounce or committed input. Show errors beside the relevant field, retain the typed value, and keep the last valid model visible. Show “Updating…” when the visible result is stale.
- Use one update status. Annual analysis can show progress and retry without blocking room editing. Ignore obsolete responses after newer edits; preserve existing request cancellation and caching behavior.
- Separate physical edits from display options. “Include roof eaves” changes the sunlight calculation. “Hide roof” changes visibility only. Put the former in the room inspector and the latter in Display.
- Keep Display concise: cutaway walls, roof visibility, sunbeams, and scale context. Preserve the explicit mobile “Explore 3D / Done” interaction mode.
- Extend undo to committed design changes, including applied suggestions. Do not fill the undo history with every scrubbed minute or animation frame. Keep changes reversible and selected objects stable.
- Compare should explain what was saved and what changed, using metrics for the same time period. “Save comparison” must be distinct from saving an entire project. Show a useful empty state before a baseline exists.
- In Improve, show the zone, goal, predicted change, and trade-off together. Keep direct-sun hours explicit; do not imply a measured temperature or thermal-comfort improvement. Applying a suggestion should expose an immediate Undo action.

**5. Visual direction**

Use warm off-white for the page, white or pale stone for working surfaces, and charcoal text. Retain teal for controls, amber for sunlight, and violet for selected scene objects. Give these colors consistent roles; pair color with text, outlines, or patterns.

Replace the large hero with a compact SunRoom Astra wordmark and workspace header. Reduce nested cards, pill-shaped navigation, heavy shadows, and background gradients. Use clear dividers, modest 8–12 px corner radii, and stronger spacing to organize the page. Reserve shadows for floating menus and sheets.

Use one reliably loaded sans-serif family, preferably the IBM Plex Sans already named in the stylesheet, with regular, medium, and semibold weights. Start with 16 px body text, 13–14 px supporting labels, and 24–28 px page headings. Use sentence case instead of widespread uppercase labels. Keep numbers aligned and units attached to their fields. Make icon-only controls secondary and give them accessible names.

Shorten labels without changing their meaning: “Peak floor cell” becomes “Most sun at one spot”; “Room with any sun” becomes “Floor receiving sunlight today” in the daily view. Explain that this percentage means sunlight at any point during the day, not the fraction lit right now. Keep legends next to their maps. Show one current-sun statement under the canvas, with deeper measurements available on request.

**6. Mobile and accessibility**

Use a compact location header, a large model, its timeline directly below, and a clear Edit room action. Selecting a window opens a bottom sheet with its fields; the sheet can expand for the keyboard or detailed editing and has a visible Close action. Restore focus to the selection when it closes. At very narrow widths or increased text size, use a full-height editing dialog rather than squeezing fields alongside the model.

Keep Room, Sun exposure, and Improve reachable in a compact navigation bar with safe-area spacing. Do not stack the entire desktop inspector below the viewer. Keep normal page scrolling available outside explicit 3D interaction, and let users leave that mode with an obvious Done control. Pause playback when the app is hidden or an obstructing editor makes it unhelpful.

Use 44 px touch targets as a product design target, visible focus indicators, keyboard-operable tabs and sliders, and text alternatives to chart hover. Respect reduced motion. Modal sheets must manage focus and Escape; sticky elements must not cover the focused control. Test 200% zoom and narrow layouts. Normal text needs at least 4.5:1 contrast and qualifying large text 3:1; verify the actual combinations. WCAG 2.2's AA target-size criterion is 24 × 24 CSS px with exceptions, so 44 px here is a deliberate more generous target, not a statement of that minimum. [W3C: Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C: Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

**7. Implementation sequence**

| Increment | Deliverable | Exit check |
| --- | --- | --- |
| 1. Layout and visual foundation | Compact header, type/color/spacing tokens, wider model area, lighter surfaces, responsive inspector shell; retain existing behavior initially | Model and primary controls fit a laptop; layout works on mobile and at zoom; focus and contrast verified |
| 2. Editing and navigation | Three destinations, shared 2D/3D Room view, contextual inspector, one time controller, mobile editing sheet, consolidated status, design undo | Window edits and time changes remain synchronized; no accidental loss of selection or camera; keyboard and touch workflows pass |
| 3. Results and explanation | Simplified daily/seasonal results, clear Improve workflow, Compare entry point, historical-data labels, revised empty/error/loading states | Users can interpret a result, apply a goal suggestion, and explain the comparison without assistance |

Use focused follow-up PRs based on the lighting work. Keep the Flask and Three.js architecture. Start in `templates/index.html` and `static/styles.css`; extract small template components as the boundaries become clear. In `static/app.js`, separate navigation, shared time state, inspector selection, and update status so the redesign does not add more competing handlers. Reuse the current APIs, cached frames, window model, furniture data, and goal calculations.

Preserve stable input IDs while relocating controls. Update browser tests that assert the old 1088 px layout to test the new usability outcomes. Retain coverage of editing, tab semantics, stale responses, mobile scrolling, fallback, and the sunlight/shadow tests. Add a small set of stable desktop/mobile screenshots and keyboard workflows for the redesigned surfaces.

Whole-project autosave, sharing, exports, and additional 3D realism can follow after the core workflows are validated. Do not display “Project saved” until a complete, versioned scenario is actually persisted; current furniture and baseline storage do not constitute full-project saving.

**8. Definition of success**

Before calling the redesign complete, test these tasks with several people representative of the intended audience. These are proposed acceptance targets, not results already demonstrated:

1. A new user can identify the location, selected time, and sunlight result within 10 seconds.
2. A user can select Window 2, change its width, and see the result without losing the model or hunting through unrelated settings.
3. A user can compare morning and afternoon using a single time control and explain which time is currently shown.
4. A user can switch to winter exposure and distinguish an annual estimate from the current-moment view.
5. A user can apply a suggested change and undo it, knowing what changed.
6. A phone user can edit a window, close the sheet, and resume normal scrolling without being trapped in the canvas.
7. At 1366 × 768, 1440 × 900, 390 × 844, and 320 CSS px width, primary controls remain reachable and the page has no unintended horizontal overflow. At 200% zoom, controls reflow without loss of functionality.

Observe hesitation and errors as well as completion time. Validate the navigation names and mobile sheet in a lightweight prototype before implementing all three increments. The first review should show the Room screen in its default, selected-window, nighttime, loading, and mobile-editing states.
