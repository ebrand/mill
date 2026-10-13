import { useSyncExternalStore } from 'react';
import type { PlanBook } from '../plan/planBook';
import type { ChannelController, ChannelParams } from '../tools/channelTool';
import { FT, Field, INK, Section, YD3 } from './drawing';

export function ChannelPanel({ controller, plans }: { controller: ChannelController; plans?: PlanBook }) {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const set = <K extends keyof ChannelParams>(k: K) => (v: ChannelParams[K]) => controller.setParam(k, v);
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
      <strong>Channel</strong>
      <div style={{ fontSize: 12 }}>Click the ground to place points; drag a point to move it; Backspace removes the last.</div>
      <Field label="Bottom width" value={p.bottomWidth} step={0.5} min={0.5} max={12} suffix="m" onChange={set('bottomWidth')} />
      <Field label="Water depth" value={p.depth} step={0.1} min={0.2} max={4} suffix="m" onChange={set('depth')} />
      <Field label="Bed fall, 1 in" value={1 / p.bedSlope} step={100} min={50} max={20000} suffix="" onChange={(v) => controller.setParam('bedSlope', 1 / v)} />
      <Field label="Side slope" value={p.sideSlope} step={0.25} min={0.5} max={4} suffix=": 1" onChange={set('sideSlope')} />
      <Field label="Freeboard" value={p.freeboard} step={0.1} min={0} max={2} suffix="m" onChange={set('freeboard')} />
      <hr style={{ border: 0, borderTop: `1px solid ${INK}`, width: '100%' }} />
      {s.points < 2 ? (
        <div>{s.points === 0 ? 'Start in the pond to draw from it.' : 'Place at least one more point.'}</div>
      ) : (
        <>
          <div>
            Length {s.length.toFixed(0)} m · bed falls {(s.fall * 100).toFixed(0)} cm
          </div>
          <div>
            Starts from {s.startsInWater ? 'water' : s.startsNearWater ? 'the water nearby' : 'dry ground'} at {s.startLevel?.toFixed(2)} m
          </div>
          <div>
            Carries {s.capacity.toFixed(1)} m³/s at {p.depth.toFixed(1)} m deep
          </div>
          <div>
            {s.headAtEnd === null ? 'No water near the end' : `Head at end over nearby water: ${s.headAtEnd.toFixed(2)} m (${(s.headAtEnd * FT).toFixed(1)} ft)`}
          </div>
          <div>
            Cut {(s.cut * YD3).toFixed(0)} yd³ · fill {(s.fill * YD3).toFixed(0)} yd³ · {s.cut >= s.fill ? `${((s.cut - s.fill) * YD3).toFixed(0)} yd³ spare` : `${((s.fill - s.cut) * YD3).toFixed(0)} yd³ short`}
          </div>
          {s.section && <Section section={s.section} />}
        </>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {plans && (
          <button
            disabled={s.points < 2}
            onClick={() => {
              const plan = controller.take();
              if (plan) plans.add({ kind: 'channel', plan });
            }}
            style={{ font: 'inherit', flex: 1 }}
            title="Lay it out in the works plan without digging"
          >
            Add to plan
          </button>
        )}
        <button disabled={s.points < 2} onClick={() => controller.commit()} style={{ font: 'inherit' }} title="Dig it now">
          Dig now
        </button>
        <button disabled={s.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
    </div>
  );
}
