// Evening stretch (spec 5.8): six stretches, 45 seconds each side, logged done / not done per day.
import { useEffect, useRef, useState } from 'react';
import { useWakeLock } from './Gym';
import { AppState, today, update } from './store';
import { AppBar, Dock, Icon } from './ui';

const HOLD = 45;

export function Stretch({ state, onBack }: { state: AppState; onBack: () => void }) {
  const t = today();
  const list = state.program!.stretches;
  const done = state.stretch[t] ?? [];
  const [end, setEnd] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useWakeLock();

  useEffect(() => {
    if (end === null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [end]);
  const left = end === null ? null : Math.max(0, Math.ceil((end - now) / 1000));
  useEffect(() => {
    if (left === 0 && !fired.current) { fired.current = true; navigator.vibrate?.([300, 120, 300]); }
  }, [left]);

  const start = () => { fired.current = false; setNow(Date.now()); setEnd(Date.now() + HOLD * 1000); };
  const toggle = (i: number) => update(s => {
    const cur = s.stretch[t] ?? [];
    s.stretch[t] = cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i];
  });

  return (
    <div className="screen">
      <AppBar title="Evening stretch" sub={`${done.length} of ${list.length} done · about 8 min`}
        left={<button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="left" /></button>} />
      <div className="segs">{list.map((_, i) => <span key={i} className={done.includes(i) ? 'full' : ''} />)}</div>
      <main className="page">
        <p className="lead">Hold each for 45 seconds, both sides evenly. Use the timer for each side, then tick the stretch off.</p>
        {list.map((s, i) => {
          const on = done.includes(i);
          return (
            <button key={s.name} className={'check' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(i)}>
              <span className="circle">{on && <Icon name="check" size={18} />}</span>
              <span className="check-body"><b>{s.name}</b><span className="small muted">{s.why}</span></span>
            </button>
          );
        })}
        {done.length === list.length && <div className="card done-card"><span className="ok big-ok"><Icon name="check" size={30} /></span><div><b>All six done. Nice work.</b><div className="muted small">Logged for today.</div></div></div>}
      </main>
      <Dock>
        {left !== null && left > 0 && (
          <div className="timer" role="timer">
            <div className="timer-bar"><div style={{ width: `${(left / HOLD) * 100}%` }} /></div>
            <div className="timer-row"><div><div className="overline">Hold</div><div className="timer-num">{left}</div></div>
              <div className="timer-btns"><button onClick={() => setEnd(null)}>Stop</button></div></div>
          </div>
        )}
        {(left === null || left === 0) && <button className="btn primary" onClick={start}>{left === 0 ? 'Time. Start 45 sec again' : 'Start 45 sec timer'}</button>}
      </Dock>
    </div>
  );
}
