# Water Simulation Approach for an Island Game

Oct 12, 2026 · @Eric Brand

## Summary

Don't use "very small voxels" for the world's water. A full 3D grid sim gets expensive very quickly, is hard to render well, and fights against the game's core need: large open water between islands. Realistic results come from layering three cheaper techniques, each used only where it pays off.

## Why fine voxels don't scale

Assumes an Eulerian grid sim, the standard approach for voxel water.

- **Cost grows with the cube of resolution.** 128³ is about 2.1M cells. Each step needs advection, a pressure solve (20–40 Jacobi iterations is typical), and projection: roughly 50–100M cell updates per frame. That is impossible in JS on the CPU and a real cost even on the GPU. 256³ is 8 times worse.
- **Rendering the surface is a second problem.** A smooth surface from a grid means marching cubes every frame or raymarching a 3D texture. Either can cost as much as the sim.
- **It only covers a small box.** 128³ at 10 cm cells is a 12.8 m cube. Players traveling between islands leave it within seconds.
- **Physics can't read it cheaply.** Boats and players need water height on the CPU. GPU readback is asynchronous (1–3 frames late) or stalls the pipeline if forced.

## The layered approach

Three layers, each scoped to where it pays off. Costs are rough estimates for a mid-range desktop GPU; integrated and mobile GPUs can be 3–10 times slower, so profile on the weakest target early.

| Layer | Technique | Scope | Approx. cost |
| --- | --- | --- | --- |
| Far field | Gerstner waves, or an FFT ocean spectrum (Tessendorf) with 2–3 cascades | Unbounded ocean | Gerstner: \~0; FFT 256²×3: \~1 ms |
| Near field | GPU heightfield sim (wave equation or shallow water equations) in a grid that follows the player | \~64–128 m around the player | 512² grid: <0.5 ms |
| Set pieces | Particle sim (MLS-MPM or position-based fluids) on WebGPU compute, screen-space fluid rendering | Small bounded regions: waterfalls, a sluice, a splash zone | 50–100k particles: several ms |

### What each layer gives you

1. **Far field:** convincing open ocean. Evaluate the same Gerstner function on the CPU and the GPU, and physics gets exact wave height with no readback. Buoyancy becomes cheap and deterministic, which matters for any future multiplayer.
2. **Near field:** wakes, ripples, splashes, and shoreline interaction, added on top of the far-field waves. Physics can mostly ignore it as visual detail.
   - If water must *move volume* (flooding, rivers, draining off islands), use the shallow water equations with the "virtual pipes" model (Mei et al., 2007). It runs on a 2D grid, handles terrain, and is GPU-friendly: the middle ground between a heightfield and full 3D.
3. **Set pieces:** where "very small voxels in a limited space" belongs, but as particles rather than a grid. Particles handle splashing and pouring better, and screen-space rendering avoids building a mesh. Public WebGPU demos reportedly run MLS-MPM with \~100k particles in the browser: feasible as an effect, not as the world's water.

### Shading matters more than the sim

Perceived realism comes mostly from shading: Fresnel, refraction, depth-based absorption (turquoise to deep blue), shoreline foam from depth differences, foam where waves fold (nearly free from the FFT), and caustics. A mediocre sim with excellent shading looks better than the reverse.

## Stack notes: Three.js + Vite/React/TS

- **Renderer:** Three.js `WebGPURenderer` with TSL (its shader-node language) provides compute shaders, which the near-field and set-piece layers need. The WebGL path forces render-to-texture ping-pong tricks. This area of Three.js changes quickly and browser WebGPU support is not universal: check current release notes and caniuse, and decide on a WebGL fallback.
- **React:** use `@react-three/fiber` for scene composition only. Run sim steps in `useFrame` with refs and pre-allocated buffers. Simulation state never goes through React state, or you get per-frame reconciliation and GC pressure.
- **Physics:** Rapier (WASM) for rigid bodies. For buoyancy, sample 4–8 points per hull against the CPU-side wave function and apply per-point forces. Cheap and stable.
- **Timing:** fixed sim timestep with an accumulator, decoupled from render rate. Wave-equation sims go unstable under variable timesteps (CFL condition), and 120/144 Hz displays would otherwise change water behavior.

## Suggested order

1. Gerstner ocean with good shading, the CPU-mirrored height function, and Rapier buoyancy, plus one island and a controllable boat or raft. Proves the core loop.
2. Near-field GPU heightfield sim for wakes and shoreline interaction.
3. Shallow water equations, only if gameplay needs water that flows.
4. Particle set pieces last, as polish.

**Decided (see [design.md](design.md)):** the game is now a river mill simulation. Water flows and changes level; the water sim moves to a CPU Web Worker on a square grid, and the ocean layers (Gerstner, FFT) and Rapier are dropped.

**Original open decision:** does water need to flow and change level as part of gameplay (flooding, draining, rivers between islands), or is it a dynamic surface to travel across? If the latter, steps 1 and 2 cover nearly everything.
