// Evening mobility routine (spec 5.8, updated after the physio review of 8 Oct 2026): the
// physio-prescribed movements first, then the stretches. Ticked off per day, with a weekly count
// against the 4–5 sessions target.
import { useEffect, useRef, useState } from 'react';
import { addDays } from './engine/schedule';
import { useWakeLock } from './Gym';
import { AppState, today, update } from './store';
import { AppBar, Dock, Icon } from './ui';

const HOLD = 45;

/** Days this week (Monday to Sunday) on which the whole routine was ticked off. */
export function mobilityThisWeek(state: AppState, t: string): number {
  const monday = addDays(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7));
  const all = state.program!.stretches.length;
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter(d => (state.stretch[d] ?? []).length >= all).length;
}

export const mobilityTargetText = (state: AppState) => (state.program!.mobilityTarget ?? [4, 5]).join('–');

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
  const week = mobilityThisWeek(state, t);
  const groups = [
    { title: 'Physio-prescribed · do these first', items: list.map((s, i) => ({ s, i })).filter(x => x.s.physio) },
    { title: list.some(s => s.physio) ? 'Then' : 'Stretches', items: list.map((s, i) => ({ s, i })).filter(x => !x.s.physio) },
  ].filter(g => g.items.length);

  return (
    <div className="screen">
      <AppBar title="Evening mobility" sub={`${done.length} of ${list.length} done today`}
        left={<button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="left" /></button>} />
      <div className="segs">{list.map((_, i) => <span key={i} className={done.includes(i) ? 'full' : ''} />)}</div>
      <main className="page">
        <div className="stats">
          <div><div className="overline">This week</div><b>{week} session{week === 1 ? '' : 's'}</b></div>
          <div><div className="overline">Target</div><b>{mobilityTargetText(state)} a week</b></div>
          <div><div className="overline">Today</div><b>{done.length >= list.length ? 'Done' : `${done.length} of ${list.length}`}</b></div>
        </div>
        <p className="lead small">Tick each one off as you finish it. The 45-second timer below is there for the timed holds; the day counts once everything is ticked.</p>
        {groups.map(g => (
          <div className="stack" key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map(({ s, i }) => {
              const on = done.includes(i);
              return (
                <button key={s.name} className={'check' + (on ? ' on' : '')} aria-pressed={on} onClick={() => toggle(i)}>
                  <span className="circle">{on && <Icon name="check" size={18} />}</span>
                  <span className="check-body">
                    <b>{s.name}</b>
                    {s.dose && <span className="small">{s.dose}</span>}
                    {s.why && <span className="small muted">{s.why}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {done.length === list.length && <div className="card done-card"><span className="ok big-ok"><Icon name="check" size={30} /></span><div><b>Routine done. Nice work.</b><div className="muted small">Logged for today. That's {week} this week.</div></div></div>}
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
