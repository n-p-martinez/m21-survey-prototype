# From a house to a refinery: handling large facility drawings

The prototype reads one page: a plot plan of a house lot, with one walkthrough video. A real Method 21 site arrives as a drawing set: a key plan, unit plot plans, hundreds of P&IDs, often isometrics, and sometimes a 3D model. These are the changes that scale it. Research and sources are in `unicorn_pm/docs/research/2026_11_12_method_21_site_drawings_and_route_inputs.md`; findings there are from search summaries and unverified.

## What each file contributes

| File | Gives the app | Today in the prototype |
|---|---|---|
| Plot plans (key plan and unit plans) | Where: units, areas, equipment, access roads, scale | One plot plan page |
| P&IDs | What is in regulated service, and component and tag counts | Not read |
| Process flow diagrams, heat and material balances, safety data sheets | Stream composition for service determination | Not read |
| Equipment and component lists | IDs to match against | Not read |
| Aerial or drone imagery | A current base map | Not used |
| Walkthrough video and photos | What is actually there today, and what it looks like | Read |
| An existing LDAR database export | Tags, locations, history | Not read; Skybridge sample pending |

## Proposed pipeline for a drawing set

1. **Triage each file.** Page count, page size, vector or scanned, and whether it carries coordinates (ISO or TerraGo geospatial PDF). Vector text is read directly; only image regions go to OCR or vision.
2. **Build a sheet index first.** Read every title block (drawing number, title, unit, revision, date) before anything else, and show the index for a person to confirm. Separate plot plans, P&IDs and isometrics.
3. **Work one unit at a time.** Units are the natural boundary for areas, routes and review. A unit plot plan is the base map; its P&IDs say what to look for.
4. **Tile large sheets.** Split each sheet into overlapping tiles so small text and symbols are read at full resolution, and keep every result in sheet coordinates.
5. **Georeference when possible.** A geospatial PDF or a few known points place the plan on aerial imagery, so video, photo and GPS positions land on the right pin.
6. **Link P&IDs to the plot plan.** A P&ID tag or line number becomes a candidate component; the video confirms it exists and where; the technician confirms the type.
7. **One review queue.** Drawing extractions and video proposals go through the same confirm, correct or reject step, with the same accuracy meter and the same feedback loop.
8. **Expect stale drawings.** Out-of-date P&IDs are a common enforcement finding, so field verification stays in every scenario, as the 10/28 room said.

## Changes to this code

| Area | Change |
|---|---|
| `server/ai.ts` | A title block reader; a tiled plot plan reader; a P&ID tag reader. Each returns sheet coordinates. |
| `shared/types.ts` | A `Sheet` (file, page, drawing number, unit, revision, geo transform) and a `sheetId` on areas, reference points and components |
| `server/pipeline.ts` | Process per unit; cap AI calls per sheet; resume after interruption |
| `web/` | A sheet index screen and a sheet switcher on the plan view |
| Video | Long videos already sample evenly up to `M21_MAX_FRAMES`. For a facility, record per unit and link each video to its unit. |
