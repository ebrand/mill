import { useSyncExternalStore } from 'react';
import type { PlacementController } from '../mill/placement';
import type { PlanBook } from '../plan/planBook';
import { BREASTSHOT, CFS_PER_M3S, FT_PER_M } from '../mill/wheel';
import { Field, INK } from './drawing';

export function PlacementPanel({ controller, plans, sandbox = true }: { controller: PlacementController; plans?: PlanBook; sandbox?: boolean }) {
  const p = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const wheel = p.kind === 'wheel';
  if (p.kind === 'spillway') return <SpillwayPanel controller={controller} plans={plans} sandbox={sandbox} />;
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
        {plans && (
          <button
            disabled={p.points < 2}
            onClick={() => {
              const structure = controller.take();
              if (structure) plans.add({ kind: 'structure', structure });
            }}
            style={{ font: 'inherit', flex: 1 }}
            title="Lay it out in the works plan without building"
          >
            Add to plan
          </button>
        )}
        {sandbox && (
          <button disabled={p.points < 2} onClick={() => controller.commit()} style={{ font: 'inherit' }} title="Build it now">
            Build now
          </button>
        )}
        <button disabled={p.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
    </div>
  );
}

/** Spillway: a crest across the river or a race; it holds the pond to the crest plus the head over it. */
function SpillwayPanel({ controller, plans, sandbox }: { controller: PlacementController; plans?: PlanBook; sandbox: boolean }) {
  const p = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
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
      <strong>Spillway</strong>
      <div style={{ fontSize: 12 }}>
        Click the two ends of the crest, across the river (or a race). Tie the ends into banks or high ground so the water can only go
        over the crest.
      </div>
      {p.sill !== null && (
        <Field label="Crest elevation" value={p.params.sill ?? p.sill} step={0.1} min={-10} max={30} suffix="m" onChange={(v) => controller.setParam('sill', v)} />
      )}
      <hr style={{ border: 0, borderTop: `1px solid ${INK}`, width: '100%' }} />
      {p.points < 2 ? (
        <div>{p.points === 0 ? 'Click one end of the crest.' : 'Click the other end.'}</div>
      ) : (
        <>
          <div>
            Crest {p.length.toFixed(0)} m long ({(p.length * FT_PER_M).toFixed(0)} ft) · {p.openLength.toFixed(0)} m of it open to the water
          </div>
          <div>
            At today’s river ({(p.discharge * CFS_PER_M3S).toFixed(0)} cu ft/s) it runs {(p.head * 100).toFixed(0)} cm deep over the crest
          </div>
          {p.pondLevel !== null && (
            <div>
              <strong>Holds the pond at {p.pondLevel.toFixed(2)} m</strong>
              {p.intakeLevel !== null ? `, ${(p.pondLevel - p.intakeLevel).toFixed(2)} m above the water now` : ''}
            </div>
          )}
        </>
      )}
      {p.warnings.map((w) => (
        <div key={w} style={{ fontWeight: 'bold' }}>
          {w}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {plans && (
          <button
            disabled={p.points < 2}
            onClick={() => {
              const structure = controller.take();
              if (structure) plans.add({ kind: 'structure', structure });
            }}
            style={{ font: 'inherit', flex: 1 }}
          >
            Add to plan
          </button>
        )}
        {sandbox && (
          <button disabled={p.points < 2} onClick={() => controller.commit()} style={{ font: 'inherit' }}>
            Build now
          </button>
        )}
        <button disabled={p.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
    </div>
  );
}
