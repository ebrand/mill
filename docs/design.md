# Design: Mill — a River Mill Simulation

Oct 12, 2026 · @Eric Brand · Draft 2 (replaces the island-builder draft)

Working title only. Inspired by David Macaulay's *Mill* (1983); see [Inspiration and rights](#inspiration-and-rights).

## Summary

A simulation of building and running a 19th-century New England water-powered mill, rendered like Macaulay's pen-and-ink drawings. The player works one stretch of river. They dig earthworks (dams, headraces, millponds, wheel pits, tailraces, spillways), install prime movers (water wheels, later turbines and steam), connect them through simple drivetrain components to machines, and turn raw material into goods. Scenarios move through the century, roughly 1810 to 1880, each era bringing new technology and problems. Later layers add the owner, manager and workers, and possibly a whole region of mills sharing one river.

Think of it as "the book, as a simulation": the sequence the book shows (choose a site, build the dam, raise the mill, install the wheel, upgrade to a turbine) is the game's structure, with real gameplay on top.

## Decisions so far

| Question | Decision |
| --- | --- |
| Visual style | Macaulay-style pen and ink: outlines, hatching, paper, cutaways |
| Scope to start | Small sandbox on one river reach. Regional map later, maybe |
| Structure | Sandbox plus scenarios across the whole century |
| Grid | No build grid. Square grid only under terrain and water (see [Grids](#grids)) |
| Drivetrain | Abstract, connectable components; no gear-level simulation |
| Platform | Browser, WebGPU only |
| Water | Flows and changes level; earthworks reshape it |

## Core loop

1. **Read the site.** Where does the river fall fastest? Where could a dam hold a pond? Which ground is ledge rock (good dam footing) and which is soft fill?
2. **Get head.** Build a dam and/or a headrace that holds its level while the river drops away beside it. Head is the vertical drop available at the wheel, and it's the central currency.
3. **Take the water through a prime mover.** Wheel pit, gate, wheel, tailrace back to the river.
4. **Deliver the power.** Shafts and belts to machines. Machines turn inputs into goods.
5. **Survive the river.** Spring floods overtop dams, summer droughts starve the wheel, ice locks it in winter. The millpond stores water through the bad times.
6. **Grow and modernize** through the eras: more head, better wheels, turbines, steam backup, bigger mills.

The historical heart of mill siting, and the central puzzle: **a race that runs along the contour gains head because the river beside it keeps falling.** That's what the earthwork tools must make satisfying.

## Gameplay flow

One scenario, start to finish. This mirrors how mills were actually built: choose the site, dam the river, dig the race, raise the mill, start the wheel.

1. **Choose a site (regional map).** A river on a period survey map with several candidate reaches. Each shows its trade-offs: fall over the reach, typical summer and spring flow, ledge for dam footings, land price, and distance to timber, stone, roads and market. The regional map is **a choice screen with numbers, not a simulation**; only the chosen site gets the full water sim. Needs seeded site generation.
2. **Survey.** Work out where the head is before building. A surveyor's level tool: click two points, read the difference in height. The central puzzle starts here: a race along the contour gains head while the river falls away beside it.
3. **Plan.** Lay out dam, race, wheel pit and mill as **ghost plans** drawn like engineering drawings. The plan totals earth moved, stone, timber and labor days. Nothing is built yet, so several layouts can be tried cheaply.
4. **Build over time.** Crews work in days. Stone comes from a quarry and timber from a woodlot. **The river doesn't stop during construction**, so order matters: dig the race and pit first, then close the dam in summer low water. A half-built dam in the spring freshet is the classic disaster.
5. **Commission.** Open the head gate, watch the race fill, see the wheel's first turn. Then test and tune: is the fall what the survey promised, is the wheel the right size, how wide should the gate be?
6. **Operate.** Seasons come. Pond management is the skill: hold water for the summer drought, keep gates and spillway ready for the freshet. Machines turn power into goods, goods into money, money into expansion.
7. **Grow through the century.** Raise the dam, lengthen the race, add machines, replace the wheel with a turbine, add steam backup. Each era's scenario starts from what the last era left.

### Pacing (the two clocks)

Different phases need different clocks:

- **Planning:** paused.
- **Construction:** calendar days pass quickly; the water sim catches up only on what changed.
- **Commissioning and dramatic events** (fills, floods, breaches): near real time, where watching the water is the point.
- **Operating through the year:** fast calendar time, probably with a cheap pond-and-flow model standing in for the full sim, dropping back to the full sim when you zoom in or something happens.

The main pacing risk is tedium: laying out works and waiting for crews can feel like homework. Counter it with good fast-forward, strong previews, and something to watch during waits (the river rising against a half-built dam).

## Grids

You asked what kind of grid, if any, works best. Different systems want different answers:

| System | Needs | Best fit |
| --- | --- | --- |
| Terrain + water sim | Uniform cells for the shallow-water solver and the heightfield | **Square grid** (required; invisible to the player) |
| Earthworks | Channels and dams follow curving lines along contours | **Paths, not cells**: draw a centerline, set a profile |
| Buildings, wheels, machines | Rectilinear, with real dimensions | **Free placement** with snapping (to each other, to rotation steps, to race edges) |
| Drivetrain | Connections between components | **A graph** (nodes and links), not a spatial grid |

**Hex** would be great for a regional strategy map but fights everything here: rectangular buildings, straight shafts, contour-following channels. **A visible square build grid** would push channels into 90° staircases, which is wrong for earthworks and looks bad in pen and ink.

Recommendation: **no visible grid.** A square sim grid of about 0.5–1 m underneath (see the resolution risk), path-based earthwork tools, and free placement with snapping on top. If a regional map comes later, it's a separate, coarser layer, and that's where a hex or region graph could make sense.

## Systems

### 1. Terrain and earthworks

- **Heightfield** on the square grid, plus a **material layer** per cell: soil, gravel, ledge rock, clay. Material affects digging cost and whether a dam footing leaks or holds.
- **Generation:** a valley with a river that drops a few meters across the map, a flood plain, and terraces or banks where races can run. Ledge outcrops are placed deliberately as good dam sites.
- **Tools** (path-based, all previewed before commit):
  - *Channel:* a centerline with width, depth and bed slope. The preview shows the water level it would hold.
  - *Embankment / dam:* a crest line with height and crest width; earth or stone.
  - *Dig / fill brush:* for touch-ups.
  - *Structures placed into earthworks:* wheel pit, gate, spillway, flume, culvert.
- **Cut and fill accounting:** volume dug and volume placed, in period units (cubic yards). Earth from a headrace builds the dam. Labor (man-days) and time are the cost.
- **Construction takes time.** Work progresses over days. The river doesn't wait: a half-built dam during a spring freshet is a real hazard.
- **Chunked meshes** so an edit rebuilds only nearby geometry.

### 2. Water simulation

**Model:** 2D shallow water equations with the virtual-pipes method (Mei et al. 2007) on the square grid, running **on the CPU in a Web Worker**. The game constantly needs water values on the CPU (head, flow, gate discharge, flood checks), and that rules out GPU-resident simulation. The GPU only renders the water state it's given each frame.

**Boundaries:** the upstream edge injects the river discharge (seasonal, see below). The downstream edge lets water leave at a rating-curve level.

**Hydraulic structures are links, not cells.** Gates, wheels, turbines and spillways are smaller than or comparable to a cell and follow well-known equations. Each is a link that takes water from one set of cells and delivers it to another:

| Structure | Discharge |
| --- | --- |
| Sluice / head gate | Orifice: Q = C_d · A · √(2g·Δh), with A set by the gate opening |
| Dam crest, spillway | Weir: Q = C · L · H^1.5 |
| Wheel or turbine | Water passes from the forebay (upstream) to the tailrace (downstream). Q is limited by the gate and the machine's capacity |

**Power:** P = η · ρ · g · Q · H, where H is the forebay level minus the tailrace level at that moment, and η depends on the prime mover (rough ranges: undershot 0.2–0.3, breastshot 0.45–0.65, overshot 0.6–0.8, turbines 0.75–0.9 by mid-century; to verify). Because water physically leaves the pond and enters the tailrace, the sim conserves mass and energy without fudges. Two wheels on one pond share its water, and a high tailrace (backwater from floods) cuts head the way it really did.

**Seasons and time scales:** the river's discharge varies over the year (spring freshet, summer low water, autumn rains, winter ice). There are two clocks:
- **The hydraulic clock** runs the shallow-water sim at real physics timesteps. It can run faster than real time, but only as fast as the CPU allows (maybe 5–20×).
- **The calendar clock** moves through days and seasons much faster.

The river re-settles within simulated minutes after a change in inflow, so seasons can be compressed. But **filling a millpond really takes hours to days**. Options: accept a "fill" time-skip that runs the sim to steady state off-screen, solve pond levels with a cheap reservoir model when time is compressed, or scale the pond inflow. **This is a core technical decision for M1–M2.**

**Ice and floods:** ice as a seasonal flag that blocks wheels and reduces flow, not simulated freezing. A dam that is overtopped too long, or is poorly founded, starts to breach. The sim lowers the dam crest over time and the water does the rest. Breaches should be rare, telegraphed in advance, and dramatic.

Tests: mass conservation with structures; steady flow down a sloped channel; orifice and weir links match their formulas; a pond fills to the spillway and then passes the inflow; long-run stability with no NaN or negative depth.

### 3. Prime movers and drivetrain (abstract)

Components are large, connectable pieces. The player decides **what** to connect, not gear ratios.

| Category | Components (by era) | Key attributes |
| --- | --- | --- |
| Prime movers | Undershot, breastshot, overshot wheels; reaction and outward-flow turbines; steam engine (auxiliary, then primary) | Head range, max flow, efficiency, cost, era |
| Transmission | Pit gear/shaft, line shaft (per floor), belt or rope drive between floors/buildings, clutch | Capacity (hp), loss %, length/span |
| Machines | Saw, millstones (grist), carding engine, spinning frame/mule, power loom, trip hammer, finishing | Power demand, throughput, inputs → outputs |

**Power model:** a tree from each prime mover. Power delivered = supply minus transmission losses. If demand exceeds supply, every machine on that tree slows proportionally. That's historically right: mills ran slow in low water, with lower output. Clutches let the player shed load. No torque or rpm simulation.

**Production chains:** logs → lumber (sawmill; first scenario, because lumber builds everything else). Grain → flour. Raw cotton → carding → drawing → spinning → yarn → weaving → cloth. Inputs are bought; outputs are sold or stored. Market prices vary by era and season.

### 4. Economy and (later) people

- **First:** money, construction costs, input purchases, output sales, upkeep. A ledger UI in period style.
- **Later layer:** owner (you), agent/manager, overseer, operatives. Wages, hours, skill, housing in a mill village, turnover. Era events (panics, wars, tariffs) as scenario modifiers. Keep it out of early milestones.
- **Regional later:** other mills on the same river, upstream and downstream. Water rights disputes, ponds that flood a neighbor's land, mill-dam laws. This is the natural way to grow to a region, and it reuses the same water sim at a coarser scale.

### 5. Scenarios across the century

A sketch, not history. The dates and technology need checking against the book and other sources before any are built:

| Era | Situation | New technology / problem |
| --- | --- | --- |
| c. 1810s | A small wooden mill on a modest fall; spinning only | Undershot/breastshot wheel, timber dam, first race |
| c. 1820s–30s | A stone mill; power looms; a mill village | Larger dam and pond, longer headrace, more head |
| c. 1840s–50s | Expansion; dry summers limit output | Turbines (more power from the same water), dam upgrades |
| c. 1860s–80s | Bigger mill, competition, floods | Large turbines, steam backup, rope drives, a flood-damaged dam to rebuild |

Each scenario: a starting site (possibly with inherited works from the previous era), goals (output, profit, survive a flood year), and constraints (budget, water rights, era technology). The sandbox unlocks everything.

### 6. Rendering: pen and ink

This is the signature of the game and its largest art risk. Macaulay's look is black ink on off-white paper: confident outlines, hatching for tone and shadow, stippled or wavy lines for water and terrain, and especially **cutaway and cross-section views** of mechanisms.

Pipeline (three.js WebGPU + TSL post-processing):

1. **Render a G-buffer** with multiple render targets: depth, normals, object/material ID, and a light value per pixel (diffuse lighting, shadow).
2. **Outlines:** edge detection on depth, normal and ID discontinuities. Line weight varies with depth and silhouette, and a small noise offset keeps lines from looking computer-perfect.
3. **Hatching:** tonal art maps (Praun et al. 2001), a set of hatch textures at increasing stroke density chosen by light value, with cross-hatching added in shadow. Strokes are mapped in object or world space, not screen space, so they don't swim when the camera moves.
   - Terrain: strokes follow the slope, like an engraver's contours.
   - Masonry and timber: strokes follow courses and grain.
4. **Water:** a wavy-line texture for still water, plus **flow lines traced from the sim's velocity field** using line integral convolution. Flow visualization becomes part of the art: the player sees where the current is strong because the ink says so.
5. **Paper and ink:** a paper texture, a slightly warm ink color, subtle line breakup. Optional sepia wash for UI and overlays.
6. **Cutaways:** a clipping plane or per-building section cut that reveals the wheel pit, shafts and machines inside, drawn in the same style. It's essential for the drivetrain to be readable, and it's the most Macaulay-like feature we can have.

Camera: Macaulay favors high, dramatic aerial and axonometric views. A narrow field of view (or an orthographic mode) with orbit, pan and zoom.

Known pen-and-ink rendering problems to solve early:
- **Temporal coherence:** hatching that flickers or swims as the camera moves.
- **Stroke density across zoom:** lines must stay a constant on-screen thickness and spacing.
- **Readability:** tone has to separate land, water and structures without color. A restrained accent color (water blue-gray, UI highlights) is a fallback, not a failure.

### 7. UI

- Period-flavored but readable: a ledger for money, a journal for events, plans for earthworks drawn like engineering drawings.
- **Readouts that matter at a glance:** head (ft), flow (cfs), power (hp), pond level against the spillway crest, output per day.
- Tool previews before commit: water level a channel would hold, the head a wheel pit would see, cut and fill volume.

### M1 decisions (water)

- **Solver:** local-inertial shallow water (Bates et al. 2010) on a staggered grid with Manning friction, outflow limiting, and a Froude limiter (flow capped at critical). Exact mass conservation; a lake at rest stays at rest.
- **Dams and spillways are weir edges,** not raised terrain. Terrain steps can't reproduce weir flow in this model (measured effective C ≈ 2.9 against a real 1.7). Weir edges use Q = C·L·H^1.5 with Villemonte submergence, and a dam is a thin wall between pond and tailwater cells.
- **Fixed whole steps:** `advance()` never takes a short leftover step; it carries the remainder. Leftover steps made a deep pond swing by 5 m. There's a regression test.
- **River slope 0.8 %,** down from M0's 3 %, so flow stays subcritical. At 12 m³/s the pond backs up past the upstream edge of the map.
- **Two clocks, for now:** the hydraulic clock runs with speed controls (pause, 1×, 4×, 16×), and the game starts pre-filled near steady state. Filling the pond from dry takes about 19 simulated minutes, under a minute of wall time at 16×. Seasonal calendar compression is still an M5 decision.

## Architecture

| Layer | Owns | Runs |
| --- | --- | --- |
| World | Heightfield, materials, earthworks, structures, buildings | Main thread, plain TS |
| Water sim | Depth, flux, velocity; structure links | Web Worker, fixed step, hydraulic clock |
| Mill sim | Prime movers, drivetrain trees, machines, production | Main thread, fixed tick |
| Economy / calendar | Money, prices, seasons, scenario state | Main thread, calendar clock |
| Render | Terrain, water, buildings, ink post-processing | three.js WebGPU + TSL |
| UI | Tools, ledger, readouts | React (R3F for scene composition only) |

Data between worker and main thread (**decided in M1**): two transferable buffers alternate between worker and main thread, zero-copy, with at most one request in flight. No SharedArrayBuffer, so no COOP/COEP headers are needed anywhere. The main thread copies each state into a float texture (about 2.7 MB at 0.5 m cells) and hands the buffer straight back.

**Carried over from the prototype:** project setup (Vite/React/TS, pinned versions, `.npmrc`), WebGPU/TSL renderer setup, fixed-timestep loop, test setup, and the CPU-vs-GPU check pattern (useful for verifying the LIC flow lines against sim velocities).

**Dropped:** Gerstner ocean, realistic water shading, boat buoyancy, Rapier (nothing needs rigid bodies), island terrain, chase camera.

## Milestones

Each ends with something you can see or play, and its tests passing. **M0 and M3 are go/no-go points.**

0. **M0: style test.** A static scene (sloped terrain, a mill building, a dam, still and flowing water using a fake velocity field) rendered in pen and ink, with outlines, hatching, paper and one cutaway. Orbit the camera and judge coherence. *Exit: you like how it looks and it doesn't swim.* If it can't look good, decide on a fallback style before building systems.
1. **M1: the river.** Valley generation, shallow-water worker with inflow/outflow, steady river, ink water with LIC flow lines. Decide data transfer and the two-clock approach. Tests: mass conservation, steady flow, stability.
   *Status:* sim, worker, LIC water, weirs, speed controls done. Valley generation is still the hand-shaped M0 valley (not seeded).
2. **M2: earthworks.** Channel, embankment and brush tools with previews; cut and fill accounting; water responds live. Pond fills to a spillway. Tests: tool geometry, conservation with structures.
3. **M3: first mill.** Wheel pit with head gate (orifice link), one wheel type, line shaft, sawmill, lumber output, hp readout. *Exit: is siting and building the first mill fun?* Rethink before going on if not.
   *Status (stage A):* the site's existing mill works. A head gate (orifice/weir law) feeds the flume, a breastshot wheel turns P = η·ρ·g·Q·H into horsepower, the drivetrain drives a sash saw (10 hp, 120 board feet an hour, both estimates), and lumber accrues over simulated time. Gate and lumber are saved. 
   *Status (stage B):* players place head gates (through dams or banks) and breastshot wheels with two clicks each, with a live preview of levels, head, flow, horsepower and warnings. A wheel digs its own pit behind a breast of earth. Gates model drowned flow, since a headrace gate usually is. Structures are listed in a "Mill works" panel with their own gates and output, and they're saved. A mill built from scratch on the south bank (gate, about 40 m headrace, wheel into the river) runs at about 38 hp.
4. **M4: plan and build.** Ghost plans for every tool (channel, bank, gate, wheel, mill building) with totals for earth, stone, timber and labor days; a surveyor's level tool; construction over calendar days by crews; quarry and woodlot (backlog #1, #2); construction order and the river during it. Money as a simple budget. *Exit: does building feel like a series of decisions rather than clicks?*
5. **M5: machines and production.** Mill building placement, drivetrain components (line shafts, belts, clutches), machines with proportional slowdown, the sawmill then the cotton chain, market and ledger.
6. **M6: seasons and hazards.** Discharge over the year, droughts, freshets, ice, dam overtopping and breach. The calendar clock and the cheap pond model for fast operation (see Pacing).
7. **M7: site generation and the regional map.** Seeded valleys with ledge, timber and stone; a regional map of candidate reaches with their trade-offs; choosing a site starts a scenario.
8. **M8: scenarios.** The eras, technology progression (wheel types, turbines, steam), objectives, inherited works between eras.
9. **M9: people.** Owner, manager, workers, village, wages.
10. **Later: region as play.** Several mills on one river, neighbours upstream and down, water rights.

## Risks

- **Pen-and-ink quality** (highest): good hand-drawn rendering takes a lot of art direction. Coherence under camera motion is hard. M0 exists to find out early.
- **Sim resolution vs. channel width** (*profiled in M1, resolved for now*): the solver costs about 11.5 ns per cell per step in plain JS. At 0.5 m cells the 260 × 160 m site is 166k cells, 1.9 ms per step, up to about 32× real time on one worker core. A 3 m headrace gets 6 cells. Bigger maps or regions will need the numbers rechecked.
- **Two clocks:** compressed calendar time against a real-physics hydraulic clock, especially for pond filling. Needs a decision, not a hope.
- **Earthwork UX:** path tools on 3D terrain can feel fiddly. Prototype the channel tool early, even before M2 if needed.
- **Realism vs. fun:** the hydraulics should be true, but the player must read results at a glance. Every system needs a clear readout.
- **Historical accuracy:** the era technology and dates in this doc are from memory; verify them before building scenarios.
- **Niche audience:** fine for this project, but worth being honest about.

## Inspiration and rights

*Mill* is inspiration for the period, setting and progression. The game must not copy its illustrations, text, characters or place names, or use *Mill* as the title, without permission from the rights holders. Our art has to be our own pen-and-ink style.

## Open questions

- Map size and sim resolution (see Risks).
- How time passes: pausable real time with fast-forward, or turn-like days?
- Does the player only design, or also direct labor (crews, schedules)?
- Steam as late-era backup only, or a full alternative that makes water optional?
- How much of the book's narrative framing (letters, journals) the scenarios use.
- Regional layer: same engine at coarser resolution, or an abstract map?
