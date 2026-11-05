// Evening mobility routine (spec 5.8, updated after the physio review of 8 Oct 2026): the
// physio-prescribed movements first, then the stretches. Ticked off per day, with a weekly count
// against the 4–5 sessions target.
import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays } from './engine/schedule';
import { useWakeLock } from './Gym';
import { buildPlan, HOLD_CAP, lastSet, sidePlankAim, stageNames } from './plan';
import { AppState, gymForDate, MOBILITY, SessionLog, SetLog, today, uid, update, write } from './store';
import { AppBar, Dock, Icon, Segmented, Stepper } from './ui';

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
        {state.program!.sessions[MOBILITY] && <SidePlankCard state={state} />}
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

/** Side plank with hip dips at the end of the evening stretches (5 Nov 2026; before that, the end of every gym session).
 *  Each set and side is logged as in the gym (dips, hold, controlled, stage) under a mobility session for the day, so the
 *  aim and the stage rule carry on from the gym history. */
function SidePlankCard({ state }: { state: AppState }) {
  const t = today();
  const existing = state.sessions.find(s => s.type === MOBILITY && s.date === t && !s.practice);
  const [newId] = useState(uid);
  const session: SessionLog = useMemo(() => existing ?? {
    id: newId, slotIdx: null, type: MOBILITY, date: t, gymId: gymForDate(state, t).id,
    week: state.schedule.filter(x => x.date <= t).sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.week ?? 1,
    swaps: {}, warmup: [], startedAt: Date.now(),
  }, [existing, newId, t, state]);
  const item = buildPlan(state, session).find(i => i.scheme.t === 'stage' && i.scheme.hold);
  const logged = state.sets.filter(x => x.sessionId === session.id && !!item && x.exId === item.ex && !x.rampUp).sort((a, b) => a.ts - b.ts);
  const steps = item ? Array.from({ length: item.targets.length }, (_, i) => i + 1).flatMap(n => (['L', 'R'] as const).map(side => ({ n, side }))) : [];
  const next = steps.find(st => !logged.some(x => x.setNo === st.n && x.side === st.side));
  const last = item && next ? lastSet(state, item.ex, next.n, next.side, session, false) : undefined;
  const aim = item ? sidePlankAim(item, last, item.targets[0]?.reps ?? 10) : null;
  const key = next ? `${next.n}${next.side}` : 'done';
  const [form, setForm] = useState<{ key: string; reps: number; hold: number | null; controlled: boolean; stage: number | undefined }>({ key: '', reps: 0, hold: null, controlled: false, stage: undefined });
  const f = form.key === key ? form : { key, reps: aim?.reps ?? 10, hold: aim?.hold ?? 20, controlled: false, stage: logged.at(-1)?.level ?? item?.level };
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  if (!item || item.scheme.t !== 'stage') return null;
  const scheme = item.scheme;
  const range = scheme.range;

  const log = () => {
    if (!next) return;
    navigator.vibrate?.(25);
    const now = Date.now();
    const id = uid();
    const row: SetLog = {
      id, sessionId: session.id, exId: item.ex, plannedExId: item.plannedEx, setNo: next.n, side: next.side,
      weight: null, reps: f.reps, rir: null, controlled: f.controlled, level: f.stage, holdSec: f.hold ?? undefined,
      suggestedWeight: null, suggestedReps: aim?.reps ?? null, ts: now,
    };
    if (!existing) write('sessions', session.id, s => { s.sessions.push({ ...session, startedAt: now, finishedAt: now }); });
    else write('sessions', session.id, s => { s.sessions.find(x => x.id === session.id)!.finishedAt = now; });
    write('sets', id, s => { s.sets.push(row); });
  };
  const undo = () => { const x = logged.at(-1); if (x) update(s => { s.sets = s.sets.filter(y => y.id !== x.id); }); };

  return (
    <div className="stack">
      <h2>Then: side plank</h2>
      <div className="card">
        <b>{item.title}</b>
        <div className="muted small">{item.targets.length} × {range[0]}–{range[1]} dips + hold, each side. On your elbow, body straight; lower the hip and lift it back up, then hold at the top until your form starts to go.</div>
        {logged.length > 0 && <div className="small">{logged.map(x => `Set ${x.setNo} ${x.side === 'L' ? 'left' : 'right'}: ${x.reps}${x.holdSec != null ? ` + ${x.holdSec} s` : ''}`).join(' · ')}</div>}
      </div>
      {next ? (
        <div className="card">
          <div className="overline">Set {next.n} of {item.targets.length} · {next.side === 'L' ? 'Left' : 'Right'} side</div>
          <div className="muted small">Aim today: {aim?.reps} dips, then hold {aim?.hold ?? 20} s{last && aim?.sameStage ? (aim.hold === HOLD_CAP ? ' (45 s is the top for holds; progress now comes from dips and the next stage)' : ' (same dips, 5 s more hold than last time; the dips go up once the hold reaches 45 s)') : ''}. Stop the hold when your hips start to sag.</div>
          {last && <div className="muted small">Last time: {last.reps} dips{last.holdSec != null ? ` + ${last.holdSec} s` : ''}</div>}
          <Stepper label="Dips" unit="reps" value={f.reps} onMinus={() => set({ reps: Math.max(0, f.reps - 1) })} onPlus={() => set({ reps: f.reps + 1 })} onType={v => set({ reps: v ?? 0 })} />
          <Stepper label="Hold at the end" unit="seconds" value={f.hold} onMinus={() => set({ hold: Math.max(0, (f.hold ?? 0) - 5) })} onPlus={() => set({ hold: (f.hold ?? 0) + 5 })} onType={v => set({ hold: v })} />
          <button className={'check' + (f.controlled ? ' on' : '')} aria-pressed={f.controlled} onClick={() => set({ controlled: !f.controlled })}>
            <span className="circle">{f.controlled && <Icon name="check" size={18} />}</span>
            <span className="check-body"><b>Controlled</b><span className="small muted">Tick it whenever the set was controlled, whatever the reps. The stage goes up once every set, both sides, is {range[1]} dips and ticked.</span></span>
          </button>
          <div className="field">
            <div className="field-label">Stage</div>
            <Segmented options={stageNames(state.program!, scheme).map((name, i) => ({ value: i + 1, label: `${i + 1}: ${name}` }))} value={f.stage ?? 1} onChange={v => v && set({ stage: v })} />
          </div>
          <button className="btn primary" onClick={log}>Log {next.side === 'L' ? 'left' : 'right'} side</button>
          {logged.length > 0 && <button className="btn ghost" onClick={undo}>Undo the last set</button>}
        </div>
      ) : (
        <div className="card done-card"><span className="ok big-ok"><Icon name="check" size={30} /></span><div><b>Side plank done for today.</b>
          <div className="muted small">Logged. The next aim follows from today.</div>
          <button className="btn ghost" onClick={undo}>Undo the last set</button></div></div>
      )}
    </div>
  );
}
