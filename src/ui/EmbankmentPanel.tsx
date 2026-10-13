import { useSyncExternalStore } from 'react';
import type { PlanBook } from '../plan/planBook';
import type { EmbankmentController } from '../tools/embankmentTool';
import { FT, Field, INK, Section, YD3 } from './drawing';

export function EmbankmentPanel({ controller, plans, sandbox = true }: { controller: EmbankmentController; plans?: PlanBook; sandbox?: boolean }) {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const p = s.params;
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
      <strong>Bank</strong>
      <div style={{ fontSize: 12 }}>
        Earth banks and dams. Click the ground to place points along the crest; drag to move; Backspace removes the last.
      </div>
      {p.crest === null ? (
        <div>The crest height is suggested from the first point (1 m above water or ground).</div>
      ) : (
        <Field label="Crest elevation" value={p.crest} step={0.1} min={-10} max={30} suffix="m" onChange={(v) => controller.setParam('crest', v)} />
      )}
      <Field label="Crest width" value={p.crestWidth} step={0.5} min={0.5} max={10} suffix="m" onChange={(v) => controller.setParam('crestWidth', v)} />
      <Field label="Side slope" value={p.sideSlope} step={0.25} min={1} max={4} suffix=": 1" onChange={(v) => controller.setParam('sideSlope', v)} />
      <hr style={{ border: 0, borderTop: `1px solid ${INK}`, width: '100%' }} />
      {s.points < 2 ? (
        <div>Place at least {2 - s.points} more point{s.points === 1 ? '' : 's'}.</div>
      ) : (
        <>
          <div>
            Length {s.length.toFixed(0)} m · tallest {s.maxHeight.toFixed(1)} m ({(s.maxHeight * FT).toFixed(0)} ft)
          </div>
          <div>
            {s.waterLevel === null || p.crest === null
              ? 'Starts on dry ground'
              : `Crest ${(p.crest - s.waterLevel).toFixed(2)} m above the water where it starts`}
          </div>
          <div>Fill {(s.fill * YD3).toFixed(0)} yd³</div>
          {s.endGround && p.crest !== null && Math.min(...s.endGround) < p.crest && (
            <div style={{ fontWeight: 'bold' }}>
              An end stands on ground {(p.crest - Math.min(...s.endGround)).toFixed(2)} m below the crest: water will go
              around it. Carry the bank into higher ground.
            </div>
          )}
          <div style={{ fontSize: 12 }}>Water over the crest spills as over any ground; a proper spillway comes with gates (M3).</div>
          {s.section && <Section section={s.section} label="Section where tallest" />}
        </>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {plans && (
          <button
            disabled={s.points < 2}
            onClick={() => {
              const plan = controller.take();
              if (plan) plans.add({ kind: 'bank', plan });
            }}
            style={{ font: 'inherit', flex: 1 }}
            title="Lay it out in the works plan without building"
          >
            Add to plan
          </button>
        )}
        {sandbox && (
          <button disabled={s.points < 2} onClick={() => controller.commit()} style={{ font: 'inherit' }} title="Build it now">
            Build now
          </button>
        )}
        <button disabled={s.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
    </div>
  );
}
