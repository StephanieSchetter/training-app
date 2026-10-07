// Calendar, the read-only view of any past or upcoming session, and Settings.
import { useRef, useState } from 'react';
import { addDays, isGym, Slot } from './engine/schedule';
import { matchActivity, matchLaps, Rep } from './engine/garmin';
import { schemeText } from './Gym';
import { buildPlan } from './plan';
import { buildRun } from './runplan';
import { AppState, currentSpeeds, gymForDate, Program, RunType, SessionLog, setProgram, today, update } from './store';
import { APP_VERSION, syncNow, SyncView, waitingTooLong } from './sync';
import { AppBar, Dock, Icon, Sheet } from './ui';

export const NAMES: Record<string, string> = {
  easy: 'Easy Run', intervals: 'Intervals', threshold: 'Threshold Run',
  gymA: 'Gym A', gymB: 'Gym B', gymC: 'Gym C', gymD: 'Gym D',
};
const SHORT: Record<string, string> = { easy: 'Easy', intervals: 'Int', threshold: 'Thr', gymA: 'A', gymB: 'B', gymC: 'C', gymD: 'D' };
const RIRS = ['0', '1', '2', '3', '4+'];

export function niceDate(d: string, long = false) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short' });
}

export function TypeIcon({ type }: { type: string }) {
  const gym = type.startsWith('gym');
  return <span className={'type ' + (gym ? 'gym' : 'run')}><Icon name={gym ? 'bar' : 'run'} size={20} /></span>;
}

const hms = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** The watch activity that goes with a logged session, and for interval/threshold runs the heart rate per rep. */
function GarminCard({ state, date, type, startedAt, reps }: { state: AppState; date: string; type: 'run' | 'strength'; startedAt: number; reps?: Rep[] }) {
  const act = matchActivity(state.garminActs, date, type, startedAt);
  const laps = act && reps?.length ? matchLaps(act.laps, reps) : null;
  return (
    <>
      <h2>Garmin</h2>
      {!act ? <div className="card muted">No watch activity found for this day yet. It shows up after the next Garmin sync.</div> : (
        <>
          <div className="stats">
            <div><div className="overline">Watch time</div><b>{Math.round(act.durationSec / 60)} min</b></div>
            <div><div className="overline">Average HR</div><b>{act.avgHr != null ? Math.round(act.avgHr) : '—'}</b></div>
            <div><div className="overline">Max HR</div><b>{act.maxHr != null ? Math.round(act.maxHr) : '—'}</b></div>
          </div>
          {reps && reps.length > 0 && (laps
            ? (
              <div className="card list">
                {laps.map((l, i) => (
                  <div className="line" key={i}><span>Rep {i + 1}</span><span className="tab">{l.avgHr != null ? `${Math.round(l.avgHr)} bpm` : '—'} <span className="muted small">· {hms(l.sec)}</span></span></div>
                ))}
              </div>
            )
            : <div className="card muted">Couldn't match laps to reps, so only the session average is shown. Pressing lap at the start and end of each rep makes this work.</div>)}
        </>
      )}
    </>
  );
}

/** What to open: a planned slot in the schedule, or a logged session with no slot (practice). */
export type Target = { slotIdx: number } | { sessionId: string };

/** The plan as it would be on that date: gym in use, FIFO swaps, and suggestions from history so far. */
function virtualSession(state: AppState, slot: Slot): SessionLog {
  const gym = gymForDate(state, slot.date);
  const swaps: Record<string, string> = {};
  if (gym.id === 'fifo') for (const sw of state.program!.swaps) if (sw.when === 'fifo') swaps[sw.from] = sw.to;
  return { id: `preview-${slot.idx}`, slotIdx: slot.idx, type: slot.type, date: slot.date, gymId: gym.id, week: slot.week, swaps, warmup: [], startedAt: Date.now() };
}

export function SessionView({ state, target, onBack, onStart, onStartRun }: { state: AppState; target: Target; onBack: () => void; onStart: (slot: Slot) => void; onStartRun: (slot: Slot) => void }) {
  const program = state.program!;
  const slot = 'slotIdx' in target ? state.schedule.find(s => s.idx === target.slotIdx) : undefined;
  const logged = 'sessionId' in target
    ? state.sessions.find(s => s.id === target.sessionId)
    : state.sessions.filter(s => s.slotIdx === target.slotIdx && !s.practice).at(-1);
  const type = logged?.type ?? slot!.type;
  const date = logged?.date ?? slot!.date;
  const week = logged?.week ?? slot!.week;
  const t = today();
  const back = <button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="left" /></button>;
  const when = date === t ? 'Today' : date < t ? 'Past session' : 'Upcoming';

  if (!isGym(type as Slot['type'])) {
    const run = program.running ? buildRun(program, week, type as RunType, currentSpeeds(state)) : null;
    const done = slot ? state.runs.filter(r => r.slotIdx === slot.idx).at(-1) : undefined;
    const ANSWERS = { yes: 'Yes, could have done 2 more reps', no: 'No, that was the limit', dnf: "Couldn't finish all reps" };
    if (done) {
      return (
        <div className="screen">
          <AppBar title={done.title} sub={`${niceDate(date, true)} · Week ${week}`} left={back} />
          <main className="page">
            <div className="stats">
              <div><div className="overline">{done.finishedAt ? 'Completed' : 'In progress'}</div><b>{niceDate(date)}</b></div>
              <div><div className="overline">{done.timeTrial ? '5 km time' : 'Parts done'}</div><b>{done.timeTrial ? (done.timeTrialSec ? `${Math.floor(done.timeTrialSec / 60)}:${String(done.timeTrialSec % 60).padStart(2, '0')}` : '—') : `${done.segs.filter(s => s.done).length} of ${done.segs.length}`}</b></div>
              <div><div className="overline">Next speed</div><b>{done.speedAfter !== undefined ? `${done.speedAfter} km/h` : '—'}</b></div>
            </div>
            {done.answer && <div className="card"><div className="overline">2 more reps?</div>{ANSWERS[done.answer]}{done.speedBefore !== undefined && done.speedAfter !== undefined ? ` Speed ${done.speedBefore} → ${done.speedAfter} km/h.` : ''}</div>}
            {done.segs.length > 0 && (
              <>
                <h2>What you did</h2>
                <div className="card list">
                  {done.segs.map((s, i) => (
                    <div className="line" key={i}>
                      <div><div className={s.done ? '' : 'muted'}>{s.text}</div>{s.work && s.done && s.actual !== s.prescribed && <div className="muted small">Ran at {s.actual} km/h</div>}</div>
                      {s.done ? <span className="ok"><Icon name="check" size={18} /></span> : <span className="muted small">Skipped</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
            <GarminCard state={state} date={done.date} type="run" startedAt={done.startedAt}
              reps={done.type === 'easy' ? undefined : done.segs.filter(s => s.work && s.done && s.km && s.prescribed).map(s => ({ km: s.km!, speed: s.actual ?? s.prescribed! }))} />
          </main>
          {!done.finishedAt && <Dock><button className="btn primary" onClick={() => update(s => { s.activeRunId = done.id; })}>Resume this run</button></Dock>}
        </div>
      );
    }
    return (
      <div className="screen">
        <AppBar title={run?.title ?? NAMES[type]} sub={`${niceDate(date, true)} · Week ${week}`} left={back} />
        <main className="page">
          {!run ? <div className="card muted">The running plan isn't loaded yet. Load the latest program file in Settings.</div> : (
            <>
              <div className="stats">
                <div><div className="overline">{when}</div><b>{niceDate(date)}</b></div>
                <div><div className="overline">Distance</div><b>{run.km.toFixed(1)} km</b></div>
                <div><div className="overline">{run.timeTrial ? 'Where' : 'Incline'}</div><b>{run.timeTrial ? 'Outdoors' : program.running!.incline}</b></div>
              </div>
              <p className="lead">{run.summary}</p>
              {run.over8 && <div className="notice"><Icon name="info" size={16} /> This run comes to more than 8 km in total.</div>}
              {run.sections.map(sec => (
                <div key={sec.title} className="stack">
                  <h2>{sec.title}</h2>
                  <div className="card list">
                    {sec.lines.map((l, i) => (
                      <div className="line" key={i}>
                        <div><div>{l.text}</div>{l.detail && <div className="muted small">{l.detail}</div>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {run.asks && <p className="lead">Press lap on your watch for each rep.</p>}
              {date > t && run.asks && <p className="lead small">Speeds shown are your current ones. They move up or down after each run's "2 more reps?" answer.</p>}
              {date > t && <div className="card muted">This is a preview. The Start button appears here on {niceDate(date, true)}.</div>}
            </>
          )}
        </main>
        {run && slot && date === t && !slot.done && <Dock><button className="btn primary" onClick={() => onStartRun(slot)}>{run.timeTrial ? 'Enter my time' : 'Start this run'}</button></Dock>}
      </div>
    );
  }

  const session = logged ?? virtualSession(state, slot!);
  const plan = buildPlan(state, session);
  const gym = state.profiles.find(p => p.id === session.gymId)!;
  const sets = logged ? state.sets.filter(s => s.sessionId === logged.id) : [];
  const work = sets.filter(s => !s.rampUp && !s.extra);
  const canStart = !logged && slot && slot.date === t && !slot.done;
  const inProgress = logged && !logged.finishedAt;

  return (
    <div className="screen">
      <AppBar title={NAMES[type] + (logged?.practice ? ' · Practice' : '')} sub={`${niceDate(date, true)} · Week ${week}`} left={back} />
      <main className="page">
        <div className="stats">
          <div><div className="overline">{logged ? (inProgress ? 'In progress' : 'Completed') : when}</div><b>{niceDate(date)}</b></div>
          <div><div className="overline">Gym</div><b>{gym.name}</b></div>
          {logged
            ? <div><div className="overline">Sets logged</div><b>{work.length}</b></div>
            : <div><div className="overline">RIR target</div><b>{program.rirByWeek[week]}</b></div>}
        </div>
        {!logged && <p className="lead">{program.weekNotes[week]}{program.sessions[type].note ? ` ${program.sessions[type].note}` : ''}</p>}
        {!logged && date > t && <p className="lead small">Weights shown are based on what you've logged so far. They update after each session.</p>}
        {!logged && date > t && <div className="card muted">This is a preview. The Start button appears here on {niceDate(date, true)}.</div>}
        {logged?.badDay && <div className="card warn-card"><Icon name="flag" /> Flagged as a bad day.</div>}

        <h2>{logged ? 'What you did' : 'The plan'}</h2>
        <div className="card list">
          {plan.map(p => {
            const done = work.filter(s => s.exId === p.ex).sort((a, b) => a.setNo - b.setNo || (a.side ?? '').localeCompare(b.side ?? ''));
            return (
              <div className="line top" key={p.ex}>
                <div className="grow">
                  <div>{p.pair ? <span className="tag">{p.pair}</span> : null}{p.info.name}</div>
                  {p.swapLabel && <div className="small warn-text">{p.swapLabel}</div>}
                  {logged
                    ? (done.length
                      ? done.map(s => <div className="muted small tab" key={s.id}>Set {s.setNo}{s.side ? ` ${s.side}` : ''}: {s.weight != null ? `${s.weight} kg × ` : ''}{s.reps}{s.rir != null ? ` · RIR ${RIRS[s.rir]}` : ''}</div>)
                      : <div className="muted small">Not done</div>)
                    : <div className="muted small">{schemeText(p)}</div>}
                </div>
                {!logged && <div className="muted nowrap right">{p.usesWeight ? (p.targets[0]?.weight != null ? `${p.targets[0].weight} kg` : 'Find load') : 'Bodyweight'}</div>}
                {logged && done.length > 0 && <span className="ok"><Icon name="check" size={18} /></span>}
              </div>
            );
          })}
        </div>
        {logged?.notes && <><h2>Note</h2><div className="card">{logged.notes}</div></>}
        {logged && <GarminCard state={state} date={logged.date} type="strength" startedAt={logged.startedAt} />}

        {!logged && (
          <>
            <h2>Warm-up</h2>
            <div className="card list">
              {program.warmup.map(d => <div className="line" key={d.name}><span>{d.name}</span><span className="muted nowrap">{d.dose}</span></div>)}
            </div>
          </>
        )}
      </main>
      {canStart && <Dock><button className="btn primary" onClick={() => onStart(slot!)}>Start this session</button></Dock>}
      {inProgress && <Dock><button className="btn primary" onClick={() => update(s => { s.activeSessionId = logged!.id; })}>Resume this session</button></Dock>}
    </div>
  );
}

export function Calendar({ state, onOpen }: { state: AppState; onOpen: (t: Target) => void }) {
  const t = today();
  const [month, setMonth] = useState(t.slice(0, 7));
  const [picked, setPicked] = useState(t);
  const first = `${month}-01`;
  const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -dow);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  // Only show a sixth row when the month actually runs into it.
  const weeks = days.slice(0, days[35].slice(0, 7) === month ? 42 : 35);
  const shiftMonth = (n: number) => {
    const d = new Date(first + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const slotsOn = (d: string) => state.schedule.filter(s => s.date === d && !s.skipped).sort((a, b) => a.order - b.order);
  const extrasOn = (d: string) => state.sessions.filter(s => s.date === d && s.slotIdx === null);
  const inStint = (d: string) => state.stints.find(x => d >= x.start && d <= x.end);
  const title = new Date(first + 'T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  const pickedSlots = slotsOn(picked);
  const pickedExtras = extrasOn(picked);
  const stint = inStint(picked);
  const dayType = state.days[picked];

  return (
    <main className="page home">
      <div className="row">
        <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}><Icon name="left" /></button>
        <h1>{title}</h1>
        <button className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}><Icon name="right" /></button>
      </div>

      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div className="cal-head" key={i}>{d}</div>)}
        {weeks.map(d => {
          const sl = slotsOn(d);
          const ex = extrasOn(d);
          return (
            <button key={d} aria-label={niceDate(d, true)}
              className={'cal-day' + (d.slice(0, 7) !== month ? ' out' : '') + (inStint(d) ? ' fifo' : '') + (d === t ? ' today' : '') + (d === picked ? ' picked' : '')}
              onClick={() => setPicked(d)}>
              <span className="cal-num">{Number(d.slice(8))}</span>
              {sl.map(s => <span key={s.idx} className={'chip ' + (isGym(s.type) ? 'gym' : 'run') + (s.done ? ' done' : '')}>{SHORT[s.type]}</span>)}
              {ex.length > 0 && <span className="chip practice">P</span>}
              {state.days[d]?.startsWith('travel') && <span className="chip travel">✈</span>}
            </button>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="chip gym">A</i> Gym</span><span><i className="chip run">Int</i> Run</span><span><i className="chip gym done">A</i> Done</span><span><i className="sw fifo" /> FIFO</span>
      </div>

      <h2>{niceDate(picked, true)}{picked === t ? ' · Today' : ''}</h2>
      {(stint || dayType) && (
        <div className="card muted">
          {stint ? `FIFO: ${stint.location}. ` : ''}{dayType === 'travel-train' ? 'Travel day. Train before you fly.' : dayType === 'travel-none' ? 'Travel day. No training.' : ''}
        </div>
      )}
      {pickedSlots.length + pickedExtras.length === 0 && <div className="card muted">Nothing planned for this day.</div>}
      {pickedSlots.map(s => (
        <button className="card row tapcard" key={s.idx} onClick={() => onOpen({ slotIdx: s.idx })}>
          <TypeIcon type={s.type} />
          <div className="grow"><b>{NAMES[s.type]}</b><div className="muted small">Week {s.week} · {s.done ? 'Done. Tap to review' : picked < t ? 'Not logged' : 'Tap to see the plan'}</div></div>
          {s.done ? <span className="ok"><Icon name="check" /></span> : <span className="muted"><Icon name="right" /></span>}
        </button>
      ))}
      {pickedExtras.map(s => (
        <button className="card row tapcard" key={s.id} onClick={() => onOpen({ sessionId: s.id })}>
          <TypeIcon type={s.type} />
          <div className="grow"><b>{NAMES[s.type]} · Practice</b><div className="muted small">{s.finishedAt ? 'Tap to review' : 'In progress'}</div></div>
          <span className="muted"><Icon name="right" /></span>
        </button>
      ))}
    </main>
  );
}

export function Settings({ state, sync }: { state: AppState; sync: SyncView }) {
  const file = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<Program | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const p = state.program!;

  const read = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Program;
      if (!data.sessions || !data.exercises || !data.block || !data.start) throw new Error('missing parts');
      setIncoming(data);
      setMessage(null);
    } catch {
      setMessage("That file isn't a program file this app can read.");
    }
    if (file.current) file.current.value = '';
  };

  return (
    <main className="page home">
      <h1>Settings</h1>

      <h2>Program</h2>
      <div className="card">
        <div className="row"><span>Loaded</span><b>Block {p.block}</b></div>
        <div className="row"><span>Starts</span><b>{niceDate(p.start)}</b></div>
        <div className="row"><span>Running plan</span><b>{p.running ? 'Loaded' : 'Not loaded'}</b></div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => read(e.target.files?.[0])} />
        <button className="btn" onClick={() => file.current?.click()}>Load a program file</button>
        {message && <div className="notice">{message}</div>}
      </div>

      <h2>Upload</h2>
      <div className="card">
        <div className="row"><span>Waiting to upload</span><b>{sync.pending === 0 ? 'Nothing. All uploaded' : `${sync.pending} item${sync.pending > 1 ? 's' : ''}`}</b></div>
        {waitingTooLong(sync) && <div className="notice">Some items have waited more than 24 hours.</div>}
        {sync.error && <div className="notice">Last attempt failed: {sync.error}</div>}
        <button className="btn" onClick={() => syncNow()}>Upload now</button>
      </div>

      <h2>Garmin</h2>
      <div className="card">
        <div className="row"><span>Last successful sync</span><b>{state.garminStatus?.lastSync ? new Date(state.garminStatus.lastSync).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}</b></div>
        <div className="row"><span>Days of data</span><b>{Object.keys(state.garminDays).length}</b></div>
        <div className="row"><span>Runs and gym sessions</span><b>{state.garminActs.length}</b></div>
        {state.garminStatus && !state.garminStatus.ok && <div className="notice">The last attempt didn't work. The app keeps working; it will try again tomorrow morning.</div>}
      </div>

      <p className="lead small">Gym equipment, rest times, body weight and export will appear here as each part is finished.</p>
      <p className="lead small">App version {APP_VERSION}</p>

      {incoming && (
        <Sheet title={`Load Block ${incoming.block}?`} onClose={() => setIncoming(null)}>
          <p className="muted">
            {incoming.block === p.block
              ? 'This updates the current block. Your schedule and everything you have logged stay as they are.'
              : `This starts a new block on ${niceDate(incoming.start)} and builds a fresh schedule. Everything you have logged is kept.`}
          </p>
          <button className="btn primary" onClick={() => { update(s => setProgram(s, incoming)); setIncoming(null); setMessage(`Block ${incoming.block} loaded.`); }}>Load it</button>
          <button className="btn ghost" onClick={() => setIncoming(null)}>Cancel</button>
        </Sheet>
      )}
    </main>
  );
}

export type Tab = 'home' | 'calendar' | 'settings';

export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'Today', icon: 'home' },
    { id: 'calendar', label: 'Calendar', icon: 'cal' },
    { id: 'settings', label: 'Settings', icon: 'gear' },
  ];
  return (
    <nav className="tabbar">
      <div className="tabbar-in">
        {items.map(i => (
          <button key={i.id} className={tab === i.id ? 'on' : ''} aria-current={tab === i.id} onClick={() => onTab(i.id)}>
            <Icon name={i.icon} /><span>{i.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
