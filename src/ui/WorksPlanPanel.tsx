import { useSyncExternalStore } from 'react';
import type { Crews } from '../build/construction';
import type { ConstructionController } from '../build/constructionController';
import { type Cost, formatDollars, RATES } from '../plan/costs';
import type { PlanBook } from '../plan/planBook';
import { INK } from './drawing';

const small = { font: 'inherit', fontSize: 12 } as const;

const TRADES: { key: keyof Crews; label: string; wage: number }[] = [
  { key: 'laborers', label: 'Laborers', wage: RATES.laborerWage },
  { key: 'masons', label: 'Masons', wage: RATES.masonWage },
  { key: 'millwrights', label: 'Millwrights', wage: RATES.millwrightWage },
];

function BuildingSite({ construction }: { construction: ConstructionController }) {
  const c = useSyncExternalStore(construction.subscribe, construction.getSnapshot);
  return (
    <div style={{ borderTop: `2px solid ${INK}`, paddingTop: 6, display: 'grid', gap: 4 }}>
      <strong>Building site</strong>
      {TRADES.map((t) => (
        <div key={t.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
          <span>
            {t.label} at ${t.wage.toFixed(2)}/day
          </span>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={() => construction.hire(t.key, c.crews[t.key] - (t.key === 'laborers' ? 5 : 1))} style={small}>
              −
            </button>
            <span style={{ width: 24, textAlign: 'center' }}>{c.crews[t.key]}</span>
            <button onClick={() => construction.hire(t.key, c.crews[t.key] + (t.key === 'laborers' ? 5 : 1))} style={small}>
              +
            </button>
          </span>
        </div>
      ))}
      <div style={{ fontSize: 12 }}>Wages {formatDollars(c.dailyWages)} a day, paid whether there’s work or not.</div>
      {c.jobs.length > 0 && (
        <div style={{ display: 'grid', gap: 3 }}>
          {c.jobs.map((j) => (
            <div key={j.id} style={{ fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{j.label}</span>
                <span>{j.status}</span>
              </div>
              <div style={{ height: 5, border: `1px solid ${INK}` }}>
                <div style={{ width: `${Math.round(j.progress * 100)}%`, height: '100%', background: INK }} />
              </div>
            </div>
          ))}
          {c.jobs.some((j) => j.status === 'done') && (
            <button onClick={() => construction.clearDone()} style={small}>
              Clear finished
            </button>
          )}
        </div>
      )}
      {c.log.length > 0 && (
        <div style={{ fontSize: 11, display: 'grid', gap: 1 }}>
          {c.log.slice(-4).map((l, k) => (
            <div key={k}>
              {l.date}: {l.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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

export function WorksPlanPanel({ plans, construction, sandbox }: { plans: PlanBook; construction?: ConstructionController; sandbox: boolean }) {
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
                {sandbox ? (
                  <button onClick={() => plans.build(item.id)} style={small} title="Build it at once (sandbox)">
                    Build now
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      construction?.start(item);
                      plans.remove(item.id);
                    }}
                    style={small}
                    title="Put it in the construction queue"
                  >
                    Start work
                  </button>
                )}
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
            {sandbox ? (
              <button onClick={() => plans.buildAll()} style={{ font: 'inherit', marginTop: 4 }}>
                Build all now
              </button>
            ) : (
              <button
                onClick={() => {
                  for (const item of [...plans.items]) {
                    construction?.start(item);
                    plans.remove(item.id);
                  }
                }}
                style={{ font: 'inherit', marginTop: 4 }}
              >
                Start all
              </button>
            )}
          </div>
        </>
      )}
      {!sandbox && construction && <BuildingSite construction={construction} />}
    </div>
  );
}
