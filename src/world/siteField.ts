import {
  CHANNEL_HALF_WIDTH,
  DAM_X,
  riverCenter,
  SITE_BOUNDS,
  SPILLWAY_HALF_WIDTH,
  terrainHeight,
} from '../scene/site';
import { Material, TerrainField } from './terrainField';

/** The style-test valley as editable terrain, sampled at the water sim's cell centers. */
export function createSiteField(dx: number): TerrainField {
  const { x0, x1, z0, z1 } = SITE_BOUNDS;
  const field = new TerrainField({ nx: Math.round((x1 - x0) / dx), nz: Math.round((z1 - z0) / dx), dx, x0, z0 });
  field.generate(terrainHeight, (x, z) => {
    const dz = Math.abs(z - riverCenter(x));
    // Ledge the dam is founded on, running out under both abutments.
    if (Math.abs(x - DAM_X) < 5 && dz > SPILLWAY_HALF_WIDTH * 0.5 && dz < 40) return Material.Rock;
    // A couple of outcrops on the valley sides.
    if (Math.hypot(x + 55, z - 38) < 9 || Math.hypot(x - 70, z + 34) < 7) return Material.Rock;
    if (dz < CHANNEL_HALF_WIDTH * 1.2) return Material.Gravel;
    return Material.Soil;
  });
  return field;
}
