import type { ChannelSection } from '../tools/channelTool';

export const INK = '#2b2620';
export const YD3 = 1.30795;
export const FT = 3.28084;

export function Field({
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
export function Section({ section, label = 'Section at mid-length' }: { section: ChannelSection; label?: string }) {
  const W = 260;
  const H = 110;
  const { offsets, before, after, water } = section;
  const hasWater = Number.isFinite(water);
  const ys = hasWater ? [...before, ...after, water] : [...before, ...after];
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
  const wet = hasWater ? offsets.filter((_, k) => after[k] < water) : [];
  return (
    <svg width={W} height={H + 14} style={{ display: 'block', marginTop: 6 }}>
      <path d={path(before)} fill="none" stroke={INK} strokeWidth={0.8} strokeDasharray="3 2" />
      <path d={path(after)} fill="none" stroke={INK} strokeWidth={1.3} />
      {wet.length > 1 && (
        <line x1={px(wet[0])} x2={px(wet[wet.length - 1])} y1={py(water)} y2={py(water)} stroke={INK} strokeWidth={0.8} />
      )}
      <text x={0} y={H + 12} fontSize={10} fill={INK}>
        {label} · dashed: ground now{exaggeration > 1.05 ? ` · vertical ×${exaggeration.toFixed(1)}` : ''}
      </text>
    </svg>
  );
}
