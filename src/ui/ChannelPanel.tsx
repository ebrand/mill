import { useSyncExternalStore } from 'react';
import type { ChannelController, ChannelParams, ChannelSection } from '../tools/channelTool';

const YD3 = 1.30795;
const FT = 3.28084;
const INK = '#2b2620';

function Field({
  label,
  value,
  step,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
      <span>{label}</span>
      <span>
        <input
          type="number"
          value={Number(value.toFixed(3))}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
          style={{ width: 64, font: 'inherit', background: 'transparent', border: `1px solid ${INK}`, color: INK }}
        />{' '}
        {suffix}
      </span>
    </label>
  );
}

/** Cross-section in the manner of an engineering drawing: ground before (dashed), after (solid), water. */
function Section({ section }: { section: ChannelSection }) {
  const W = 260;
  const H = 110;
  const { offsets, before, after, water } = section;
  const ys = [...before, ...after, water];
  const minY = Math.min(...ys) - 0.3;
  const maxY = Math.max(...ys) + 0.3;
  const minX = offsets[0];
  const maxX = offsets[offsets.length - 1];
  // Same scale both ways when it fits; otherwise exaggerate vertically (and say so).
  const sx = W / (maxX - minX);
  const sy = Math.min(H / (maxY - minY), sx * 4);
  const exaggeration = sy / sx;
  const px = (x: number) => (x - minX) * sx;
  const py = (y: number) => H - (y - minY) * sy;
  const path = (ys: number[]) => ys.map((y, k) => `${k ? 'L' : 'M'}${px(offsets[k]).toFixed(1)},${py(y).toFixed(1)}`).join(' ');
  // Water surface spans where the new ground is below water level.
  const wet = offsets.filter((_, k) => after[k] < water);
  return (
    <svg width={W} height={H + 14} style={{ display: 'block', marginTop: 6 }}>
      <path d={path(before)} fill="none" stroke={INK} strokeWidth={0.8} strokeDasharray="3 2" />
      <path d={path(after)} fill="none" stroke={INK} strokeWidth={1.3} />
      {wet.length > 1 && (
        <line x1={px(wet[0])} x2={px(wet[wet.length - 1])} y1={py(water)} y2={py(water)} stroke={INK} strokeWidth={0.8} />
      )}
      <text x={0} y={H + 12} fontSize={10} fill={INK}>
        Section at mid-length · dashed: ground now{exaggeration > 1.05 ? ` · vertical ×${exaggeration.toFixed(1)}` : ''}
      </text>
    </svg>
  );
}

export function ChannelPanel({ controller }: { controller: ChannelController }) {
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
            Starts from {s.startsInWater ? 'water' : 'dry ground'} at {s.startLevel?.toFixed(2)} m
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
        <button disabled={s.points < 2} onClick={() => controller.commit()} style={{ font: 'inherit', flex: 1 }}>
          Dig channel
        </button>
        <button disabled={s.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
    </div>
  );
}
