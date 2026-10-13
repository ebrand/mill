import { useSyncExternalStore } from 'react';
import type { ConstructionController } from '../build/constructionController';
import { LUMBER_PRICE } from '../build/constructionController';
import type { StructuresController, StructureView } from '../mill/structuresController';
import { WORKING_HOURS } from '../mill/structuresController';
import { formatDollars } from '../plan/costs';
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

function Item({ v, controller }: { v: StructureView; controller: StructuresController }) {
  const running = v.discharge > 0.02;
  return (
    <div style={{ display: 'grid', gap: 3, paddingTop: 6, borderTop: `1px solid ${INK}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{v.name}</strong>
        {!v.builtIn && (
          <button onClick={() => controller.remove(v.id)} style={{ font: 'inherit', fontSize: 11 }} title="Take it down">
            Remove
          </button>
        )}
      </div>
      {v.kind === 'spillway' ? (
        <div>
          {(v.discharge * CFS_PER_M3S).toFixed(0)} cu ft/s over the crest · pond at {v.etaFrom.toFixed(2)} m
        </div>
      ) : (
      <label style={{ display: 'grid', gap: 2 }}>
        <span>
          Gate {(v.opening * 100).toFixed(0)} cm open{v.opening === 0 ? ' (shut)' : ''} · {(v.discharge * CFS_PER_M3S).toFixed(0)} cu ft/s
        </span>
        <input type="range" min={0} max={v.maxOpening} step={0.01} value={v.opening} onChange={(e) => controller.setOpening(v.id, Number(e.target.value))} />
      </label>
      )}
      {v.kind === 'wheel' ? (
        <>
          <div>
            Fall {(v.head * FT_PER_M).toFixed(1)} ft · wheel {v.wheelHp.toFixed(1)} hp
            {running && v.efficiency < 0.6 ? ' · outside its best range' : ''}
          </div>
          <Meter value={v.speed} label={`${SASH_SAW.name} (needs ${SASH_SAW.ratedHp} hp)`} />
          <div>
            {v.perHour.toFixed(0)} bd ft/hour · <strong>{Math.floor(v.lumber).toLocaleString()}</strong> cut
          </div>
        </>
      ) : v.kind === 'gate' ? (
        <div>
          Water {v.etaFrom.toFixed(2)} m above, {v.etaTo.toFixed(2)} m below
        </div>
      ) : null}
    </div>
  );
}

function Income({ construction, perDay }: { construction: ConstructionController; perDay: number }) {
  const c = useSyncExternalStore(construction.subscribe, construction.getSnapshot);
  return (
    <div>
      Lumber at ${LUMBER_PRICE} a thousand: {formatDollars(perDay)} a day · {formatDollars(c.income)} earned
    </div>
  );
}

export function StructuresPanel({ controller, construction }: { controller: StructuresController; construction?: ConstructionController }) {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const bfPerDay = s.structures.reduce((a, v) => a + v.perHour * WORKING_HOURS, 0);
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 14,
        width: 280,
        maxHeight: '58vh',
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
      <strong>Mill works</strong>
      <div>
        {s.totalHp.toFixed(0)} hp at the wheels · {Math.floor(s.totalLumber).toLocaleString()} board feet cut
      </div>
      {construction && <Income construction={construction} perDay={(bfPerDay / 1000) * LUMBER_PRICE} />}
      {s.structures.map((v) => (
        <Item key={v.id} v={v} controller={controller} />
      ))}
    </div>
  );
}
