// Saving and loading: terrain, ground, earth totals, and the water as it stood, so a loaded
// game doesn't have to refill its ponds. Stored in IndexedDB, which keeps typed arrays as
// binary (no base64, no 5 MB localStorage ceiling).

import type { FieldSpec, TerrainField } from '../world/terrainField';

export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  savedAt: number;
  spec: FieldSpec;
  heights: Float32Array;
  material: Uint8Array;
  /** Water depth per cell; null to start the river pre-filled instead. */
  depth: Float32Array | null;
  simTime: number;
  discharge: number;
  cut: number;
  fill: number;
}

/** Why a save can't be loaded into this field, or null if it can. */
export function incompatibility(save: SaveData, field: TerrainField): string | null {
  if (save.version !== SAVE_VERSION) return `save is version ${save.version}, this game reads version ${SAVE_VERSION}`;
  const a = save.spec;
  const b = field.spec;
  if (a.nx !== b.nx || a.nz !== b.nz || a.dx !== b.dx || a.x0 !== b.x0 || a.z0 !== b.z0) return 'save is for a different map size';
  const n = b.nx * b.nz;
  if (save.heights.length !== n || save.material.length !== n) return 'save data is the wrong length';
  if (save.depth && save.depth.length !== n) return 'saved water is the wrong length';
  for (const h of save.heights) if (!Number.isFinite(h)) return 'save contains invalid heights';
  return null;
}

const DB = 'mill';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('save transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export function writeSave(slot: string, data: SaveData): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(data, slot));
}

export async function readSave(slot: string): Promise<SaveData | null> {
  const v = await tx<SaveData | undefined>('readonly', (s) => s.get(slot) as IDBRequest<SaveData | undefined>);
  return v ?? null;
}
