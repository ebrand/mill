import { useSyncExternalStore } from 'react';
import type { PlacementController } from '../mill/placement';
import { BREASTSHOT, CFS_PER_M3S, FT_PER_M } from '../mill/wheel';
import { Field, INK } from './drawing';

export function PlacementPanel({ controller }: { controller: PlacementController }) {
  const p = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const wheel = p.kind === 'wheel';
  return (
    <div
      style={{
        position: 'fixed',
        top: 52,
        right: 16,
        width: 280,
        padding: '10px 12px',
        font: '13px Georgia, serif',
        color: INK,
        background: 'rgba(241,233,216,0.94)',
        border: `1px solid ${INK}`,
        display: 'grid',
        gap: 4,
      }}
    >
      <strong>{wheel ? 'Water wheel' : 'Head gate'}</strong>
      <div style={{ fontSize: 12 }}>
        {wheel
          ? 'Click the intake (the end of a headrace, in the water), then the outlet (the tailrace, lower down).'
          : 'Click the intake (in the water), then the outlet on the other side of the dam or bank.'}
      </div>
      <Field label="Width" value={p.params.width} step={0.25} min={0.5} max={wheel ? 4 : 6} suffix="m" onChange={(v) => controller.setParam('width', v)} />
      <Field label="Opening to start" value={p.params.opening} step={0.05} min={0} max={wheel ? 0.6 : 1} suffix="m" onChange={(v) => controller.setParam('opening', v)} />
      {p.sill !== null && (
        <Field label={p.params.sill === null ? 'Sill (race floor)' : 'Sill'} value={p.params.sill ?? p.sill} step={0.05} min={-10} max={30} suffix="m" onChange={(v) => controller.setParam('sill', v)} />
      )}
      <hr style={{ border: 0, borderTop: `1px solid ${INK}`, width: '100%' }} />
      {p.points === 0 && <div>Click where the water comes in.</div>}
      {p.points >= 1 && (
        <div>
          Intake: {p.intakeWet ? `water at ${p.intakeLevel?.toFixed(2)} m` : `dry ground at ${p.intakeLevel?.toFixed(2)} m`}
        </div>
      )}
      {p.points === 1 && <div>Now click where it goes out.</div>}
      {p.points === 2 && (
        <>
          <div>
            Outlet: {p.outletWet ? `water at ${p.outletLevel?.toFixed(2)} m` : `dry ground at ${p.outletLevel?.toFixed(2)} m`}
          </div>
          {wheel && (
            <div>
              Fall {p.head.toFixed(2)} m ({(p.head * FT_PER_M).toFixed(1)} ft) · best {BREASTSHOT.designHead[0]}–{BREASTSHOT.designHead[1]} m
            </div>
          )}
          <div>
            Would pass {(p.discharge * CFS_PER_M3S).toFixed(0)} cu ft/s ({p.discharge.toFixed(2)} m³/s)
            {wheel ? ` · ${p.wheelHp.toFixed(1)} hp · saw at ${Math.round(p.sawSpeed * 100)}%` : ''}
          </div>
        </>
      )}
      {p.warnings.map((w) => (
        <div key={w} style={{ fontWeight: 'bold' }}>
          {w}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button disabled={p.points < 2} onClick={() => controller.commit()} style={{ font: 'inherit', flex: 1 }}>
          Build {wheel ? 'wheel' : 'gate'}
        </button>
        <button disabled={p.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
    </div>
  );
}
