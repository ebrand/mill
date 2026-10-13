import { useSyncExternalStore } from 'react';
import { type Cost, formatDollars } from '../plan/costs';
import type { PlanBook } from '../plan/planBook';
import { INK } from './drawing';

function costLine(c: Cost): string {
  const parts: string[] = [];
  if (c.cutYd3 > 0.5) parts.push(`dig ${Math.round(c.cutYd3).toLocaleString()} yd³`);
  if (c.fillYd3 > 0.5) parts.push(`fill ${Math.round(c.fillYd3).toLocaleString()} yd³`);
  if (c.stoneYd3 > 0.5) parts.push(`stone ${Math.round(c.stoneYd3)} yd³`);
  if (c.timberBf > 0.5) parts.push(`timber ${Math.round(c.timberBf).toLocaleString()} bd ft`);
  if (c.ironLb > 0.5) parts.push(`iron ${Math.round(c.ironLb)} lb`);
  return parts.join(' · ');
}

function labor(c: Cost): string {
  const parts = [`${Math.round(c.laborerDays).toLocaleString()} laborer-days`];
  if (c.masonDays > 0.5) parts.push(`${Math.round(c.masonDays)} mason-days`);
  if (c.millwrightDays > 0.5) parts.push(`${Math.round(c.millwrightDays)} millwright-days`);
  return parts.join(' · ');
}

export function WorksPlanPanel({ plans }: { plans: PlanBook }) {
  const s = useSyncExternalStore(plans.subscribe, plans.getSnapshot);
  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        top: 52,
        width: 300,
        maxHeight: '60vh',
        overflowY: 'auto',
        padding: '10px 12px',
        font: '13px Georgia, serif',
        color: INK,
        background: 'rgba(241,233,216,0.94)',
        border: `1px solid ${INK}`,
        display: 'grid',
        gap: 4,
      }}
    >
      <strong>Works plan</strong>
      {s.items.length === 0 ? (
        <div style={{ fontSize: 12 }}>
          Nothing planned. Lay out a race, bank, gate or wheel and choose “Add to plan” to see what it would take before you
          build it.
        </div>
      ) : (
        <>
          {s.items.map((item) => (
            <div key={item.id} style={{ borderTop: `1px solid ${INK}`, paddingTop: 4, display: 'grid', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{item.label}</strong>
                <span>{formatDollars(item.cost.dollars)}</span>
              </div>
              <div style={{ fontSize: 12 }}>{costLine(item.cost) || 'no materials'}</div>
              <div style={{ fontSize: 12 }}>{labor(item.cost)}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => plans.build(item.id)} style={{ font: 'inherit', fontSize: 12 }}>
                  Build
                </button>
                <button onClick={() => plans.remove(item.id)} style={{ font: 'inherit', fontSize: 12 }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 4, display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>Total</strong>
              <strong>{formatDollars(s.total.dollars)}</strong>
            </div>
            <div style={{ fontSize: 12 }}>{costLine(s.total)}</div>
            <div style={{ fontSize: 12 }}>{labor(s.total)}</div>
            <div style={{ fontSize: 11 }}>Estimates at period rates (to be checked); recosted against the ground as works are built.</div>
            <button onClick={() => plans.buildAll()} style={{ font: 'inherit', marginTop: 4 }}>
              Build all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
