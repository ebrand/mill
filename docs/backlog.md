# Backlog

Ideas and features not yet scheduled into a milestone. See [design.md](design.md) for milestones; each item notes where it likely fits and what it depends on.

| # | Item | Likely milestone | Depends on |
| --- | --- | --- | --- |
| 1 | **Quarry stone** for construction | New: resources, before or with M3 | Terrain material layer (ledge rock), construction costs |
| 2 | **Harvest lumber** for construction | New: resources, before or with M3 | Trees/woodlots on the map, construction costs |
| 3 | **Plan the dam, headrace and mill** to work out required resources | M2–M3 | Earthwork tools (M2), building catalog, resource types (1, 2) |
| 4 | **Earthworks for proper headrace flow** | M2 | Water sim (M1), channel tool |

## Notes

**1. Quarry stone.** Ledge outcrops are already in the design as good dam footings; they double as quarry sites. Open questions: extraction rate (labor, tools), hauling distance as a cost, whether quarrying changes the terrain (a pit that can flood is a nice touch).

**2. Harvest lumber.** Needs trees on the map, which M0 doesn't have yet. They'd also improve the drawings, since Macaulay's scenes rely on them. Open questions: regrowth or a finite stand, a sawmill as the first mill (lumber builds everything else), and seasonal limits (winter logging, spring log drives).

**3. Planning.** A "plan" mode where the player lays out the dam, headrace, wheel pit and mill as ghosted outlines, and the game totals what they need: earth to move (cut/fill), stone, timber, labor and time. That ties 1, 2 and 4 together. It also suggests drawing plans as period engineering drawings (plan and section views), which fits the pen-and-ink style. Open question: whether plans can be changed mid-construction, and at what cost.

**4. Earthworks for headrace flow.** The headrace must carry water from the pond to the wheel with a slight, even fall. Too steep wastes head; too flat or too narrow can't carry enough flow. The channel tool should show the water level and flow it would hold before you dig, using the M1 sim. This is the core puzzle described in design.md ("a race that runs along the contour gains head").
