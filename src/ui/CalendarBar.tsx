import { useSyncExternalStore } from 'react';
import { type ConstructionController, DAY_SPEEDS } from '../build/constructionController';
import { formatDollars } from '../plan/costs';
import { INK } from './drawing';

/** The game's clock: the date, money in hand, and how fast the days go. */
export function CalendarBar({ construction }: { construction: ConstructionController }) {
  const c = useSyncExternalStore(construction.subscribe, construction.getSnapshot);
  const label = (d: number) => (d === 0 ? 'Pause' : d < 1 ? '¼ day/s' : `${d} day${d > 1 ? 's' : ''}/s`);
  return (
    <div style={{ position: 'fixed', top: 14, right: 16, display: 'flex', gap: 6, alignItems: 'center', font: '14px Georgia, serif', color: INK }}>
      <strong>{c.date}</strong>
      <strong style={{ color: c.money < c.dailyWages * 3 ? '#8a1c10' : INK, minWidth: 60, textAlign: 'right' }}>{formatDollars(c.money)}</strong>
      {DAY_SPEEDS.map((d, i) => (
        <button
          key={d}
          onClick={() => construction.setSpeed(i)}
          title={i === 0 ? 'Stop the calendar (Space)' : 'Days pass this fast; crews work and mills run each day'}
          style={{
            font: '13px Georgia, serif',
            padding: '3px 8px',
            color: INK,
            background: c.speedIndex === i ? '#d9cdb4' : '#f1e9d8',
            border: `1px solid ${INK}`,
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          {label(d)}
        </button>
      ))}
    </div>
  );
}
