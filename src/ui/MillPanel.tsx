import { useSyncExternalStore } from 'react';
import type { MillController } from '../mill/millController';
import { CFS_PER_M3S, FT_PER_M, SASH_SAW } from '../mill/wheel';
import { INK } from './drawing';

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div style={{ height: 6, border: `1px solid ${INK}` }}>
        <div style={{ width: `${Math.min(100, value * 100)}%`, height: '100%', background: INK }} />
      </div>
    </div>
  );
}

export function MillPanel({ mill }: { mill: MillController }) {
  const s = useSyncExternalStore(mill.subscribe, mill.getSnapshot);
  const running = s.discharge > 0.02;
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 14,
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
      <strong>The Mill</strong>
      <label style={{ display: 'grid', gap: 2 }}>
        <span>
          Head gate: {(s.gate * 100).toFixed(0)} cm open {s.gate === 0 ? '(shut)' : ''}
        </span>
        <input
          type="range"
          min={0}
          max={s.gateMax}
          step={0.01}
          value={s.gate}
          onChange={(e) => mill.setGate(Number(e.target.value))}
        />
      </label>
      <div>
        Water to the wheel: {(s.discharge * CFS_PER_M3S).toFixed(0)} cu ft/s ({s.discharge.toFixed(2)} m³/s)
      </div>
      <div>
        Fall at the wheel: {(s.head * FT_PER_M).toFixed(1)} ft ({s.head.toFixed(2)} m)
        {running && s.efficiency < 0.6 ? ' · outside the wheel’s best range' : ''}
      </div>
      <div>
        Wheel: {s.wheelHp.toFixed(1)} hp · to the saw: {s.deliveredHp.toFixed(1)} hp
      </div>
      <Meter value={s.speed} label={`${SASH_SAW.name} speed (needs ${SASH_SAW.ratedHp} hp)`} />
      <div>
        Cutting {s.perHour.toFixed(0)} board feet an hour
        {s.spareHp > 0.5 ? ` · ${s.spareHp.toFixed(0)} hp to spare` : ''}
      </div>
      <div>
        <strong>{Math.floor(s.lumber).toLocaleString()}</strong> board feet cut
      </div>
      {s.pondLevel !== null && <div>Pond at {s.pondLevel.toFixed(2)} m</div>}
    </div>
  );
}
