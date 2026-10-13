import { useSyncExternalStore } from 'react';
import { feetInches, gradient, type LevelController } from '../tools/levelTool';
import { INK } from './drawing';

export function LevelPanel({ controller }: { controller: LevelController }) {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const shot = s.shot;
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
      <strong>Surveyor’s level</strong>
      <div style={{ fontSize: 12 }}>
        Click two points to sight between them. Click again to carry the line on from the last point. Water reads as its surface.
      </div>
      {!shot ? (
        <div>{s.points === 0 ? 'Click the first staff point.' : 'Click the second staff point.'}</div>
      ) : (
        <>
          <div>
            Back staff {shot.a.toFixed(2)} m{shot.aWater ? ' (water)' : ''} · fore staff {shot.b.toFixed(2)} m{shot.bWater ? ' (water)' : ''}
          </div>
          <div style={{ fontSize: 15 }}>
            <strong>
              {shot.rise < 0 ? 'Falls' : 'Rises'} {feetInches(Math.abs(shot.rise))}
            </strong>{' '}
            ({Math.abs(shot.rise).toFixed(2)} m) in {Math.round(shot.distance)} m
          </div>
          <div>{gradient(shot.rise, shot.distance)}</div>
        </>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button disabled={!shot} onClick={() => controller.commit()} style={{ font: 'inherit', flex: 1 }}>
          Enter in field book
        </button>
        <button disabled={s.points === 0} onClick={() => controller.clear()} style={{ font: 'inherit' }}>
          Clear
        </button>
      </div>
      {s.book.length > 0 && (
        <div style={{ borderTop: `1px solid ${INK}`, paddingTop: 4, fontSize: 12, display: 'grid', gap: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>Field book</strong>
            <button onClick={() => controller.clearBook()} style={{ font: 'inherit', fontSize: 11 }}>
              Clear book
            </button>
          </div>
          {s.book.map((e) => (
            <div key={e.n}>
              {e.n}. {e.rise < 0 ? 'fall' : 'rise'} {feetInches(Math.abs(e.rise))} in {Math.round(e.distance)} m ({gradient(e.rise, e.distance)})
            </div>
          ))}
          <div>
            Total: {(() => {
              const total = s.book.reduce((a, e) => a + e.rise, 0);
              const dist = s.book.reduce((a, e) => a + e.distance, 0);
              return `${total < 0 ? 'fall' : 'rise'} ${feetInches(Math.abs(total))} over ${Math.round(dist)} m`;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
