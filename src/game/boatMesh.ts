import { BoxGeometry, Group, Mesh } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { BoatSpec } from '../physics/boat';

/** Placeholder hull matching the physics box. +Z is the bow. */
export function createBoatMesh(spec: BoatSpec): Group {
  const { halfWidth: hx, halfHeight: hy, halfLength: hz } = spec;
  const group = new Group();

  const hullMat = new MeshStandardNodeMaterial({ color: 0xb8432f, roughness: 0.6 });
  const deckMat = new MeshStandardNodeMaterial({ color: 0xc9a77a, roughness: 0.8 });
  const cabinMat = new MeshStandardNodeMaterial({ color: 0xeeeae0, roughness: 0.5 });

  const hull = new Mesh(new BoxGeometry(hx * 2, hy * 2, hz * 2), hullMat);
  const deck = new Mesh(new BoxGeometry(hx * 1.8, 0.04, hz * 1.9), deckMat);
  deck.position.y = hy + 0.02;
  const cabin = new Mesh(new BoxGeometry(hx * 1.3, 0.6, hz * 0.6), cabinMat);
  cabin.position.set(0, hy + 0.32, -hz * 0.15);
  const bow = new Mesh(new BoxGeometry(hx * 1.4, hy * 1.6, 0.5), hullMat);
  bow.position.set(0, hy * 0.2, hz + 0.2);
  bow.rotation.x = 0.5;

  for (const m of [hull, deck, cabin, bow]) {
    m.castShadow = true;
    group.add(m);
  }
  return group;
}
