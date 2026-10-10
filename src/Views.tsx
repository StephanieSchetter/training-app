// Calendar, the read-only view of any past or upcoming session, and Settings.
import { useRef, useState } from 'react';
import { addDays, isGym, Slot } from './engine/schedule';
import { matchActivity, matchLaps, Rep } from './engine/garmin';
import { schemeText } from './Gym';
import { ReadinessCard } from './Gym';
import { applyDoubleUp, heavyBeforeIntervals, shiftFrom, travelOptions } from './engine/schedule';
import { autoSwaps, buildPlan, leftOut } from './plan';
import { buildRun, runAdjustFor } from './runplan';
import { AppState, currentSpeeds, gymForDate, RunType, SessionLog, SHIFTS, today, update, VIEW_ONLY } from './store';
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
  const swaps = autoSwaps(state, gym.id, slot.week);
  return { id: `preview-${slot.idx}`, slotIdx: slot.idx, type: slot.type, date: slot.date, gymId: gym.id, week: slot.week, swaps, warmup: [], startedAt: Date.now() };
}

export function SessionView({ state, target, onBack, onStart, onStartRun }: {
  state: AppState; target: Target; onBack: () => void; onStart: (slot: Slot) => void;
  onStartRun: (slot: Slot, readiness?: { score: number; accepted: boolean }) => void;
}) {
  const [runChoice, setRunChoice] = useState<boolean | null>(null);
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
    // Today only: Garmin readiness can suggest an easier version; the preview follows the choice.
    const score = date === t ? state.garminDays[t]?.readiness ?? null : null;
    const adjust = score !== null && runChoice === true ? runAdjustFor(score, type as RunType) : undefined;
    const run = program.running ? buildRun(program, week, type as RunType, currentSpeeds(state), adjust) : null;
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
          {!done.finishedAt && !VIEW_ONLY && <Dock><button className="btn primary" onClick={() => update(s => { s.activeRunId = done.id; })}>Resume this run</button></Dock>}
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
              {date === t && !run.timeTrial && slot && !slot.done && (
                <ReadinessCard score={score} type={type} choice={runChoice} onChoose={(_s, accepted) => setRunChoice(accepted)} />
              )}
              {run.over8 && <div className="notice"><Icon name="info" size={16} /> This run comes to more than {run.capKm} km in total.</div>}
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
        {run && slot && date === t && !slot.done && !VIEW_ONLY && <Dock><button className="btn primary" onClick={() => onStartRun(slot, score !== null && runChoice !== null && !run.timeTrial ? { score, accepted: runChoice } : undefined)}>{run.timeTrial ? 'Enter my time' : 'Start this run'}</button></Dock>}
      </div>
    );
  }

  const session = logged ?? virtualSession(state, slot!);
  const plan = buildPlan(state, session);
  const gym = state.profiles.find(p => p.id === session.gymId)!;
  const sets = logged ? state.sets.filter(s => s.sessionId === logged.id) : [];
  const work = sets.filter(s => !s.rampUp && !s.extra);
  const canStart = !VIEW_ONLY && !logged && slot && slot.date === t && !slot.done;
  const inProgress = !VIEW_ONLY && logged && !logged.finishedAt;

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
                  <div>{p.pair ? <span className="tag">{p.pair}{plan.filter(x => x.pair === p.pair).indexOf(p) + 1}</span> : null}{p.tag ? <span className="tag">{p.tag}</span> : null}{logged ? p.info.name : p.title}</div>
                  {p.swapLabel && <div className="small warn-text">{p.swapLabel}</div>}
                  {logged
                    ? (done.length
                      ? done.map(s => <div className="muted small tab" key={s.id}>Set {s.setNo}{s.side ? ` ${s.side}` : ''}: {s.weight != null ? `${s.weight} kg × ` : ''}{s.reps}{s.rir != null ? ` · RIR ${RIRS[s.rir]}` : ''}</div>)
                      : <div className="muted small">Not done</div>)
                    : <div className="muted small">{schemeText(p)}{p.rir !== program.rirByWeek[week] ? ` · RIR ${p.rir}` : ''}{p.reason && p.reason.startsWith('Held') ? ` · ${p.reason}` : ''}</div>}
                </div>
                {!logged && <div className="muted nowrap right">{p.usesWeight ? (p.targets[0]?.weight != null ? `${p.targets[0].weight} kg` : 'Find load') : 'Bodyweight'}</div>}
                {logged && done.length > 0 && <span className="ok"><Icon name="check" size={18} /></span>}
              </div>
            );
          })}
        </div>
        {!logged && leftOut(state, session).length > 0 && <div className="card muted">Left out this week (back flare): {leftOut(state, session).join(', ')}.</div>}
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

/** Choices for a "Travel — no training" day that still has a session on it (spec 4.3). */
export function TravelCard({ state, date }: { state: AppState; date: string }) {
  if (state.days[date] !== 'travel-none') return null;
  const opts = travelOptions(state.schedule, date);
  const slot = state.schedule.find(s => s.date === date && !s.done && !s.skipped);
  if (!slot || !opts.choices.length) return null;
  const set = (fn: (s: AppState) => void) => update(fn);
  return (
    <div className="card alert-card">
      <div className="overline">Travel day · {niceDate(date, true)}</div>
      <b>{NAMES[slot.type]} is planned, but you're not training this day. What should happen to it?</b>
      {opts.choices.includes('double-up') && (
        <button className="btn option" onClick={() => set(s => { s.schedule = applyDoubleUp(s.schedule, date); })}>
          <b>Double up the next day</b><span className="small muted">{opts.doubleUpOrder!.map(x => NAMES[x]).join(' first, then ')} on {niceDate(addDays(date, 1))}</span>
        </button>
      )}
      <button className="btn option" onClick={() => set(s => { s.schedule = shiftFrom(s.schedule, date, 1); })}>
        <b>Move everything a day later</b><span className="small muted">Every remaining session shifts by one day</span>
      </button>
      {slot.type !== 'intervals' && (
        <button className="btn option" onClick={() => set(s => { s.schedule.find(x => x.idx === slot.idx)!.skipped = true; })}>
          <b>Skip {NAMES[slot.type]}</b><span className="small muted">Leave it out and keep the rest of the schedule as it is</span>
        </button>
      )}
    </div>
  );
}

/** Guard (4.4): a heavy session the day before intervals, with the offer to swap gym sessions around. */
export function HeavyGuardCard({ state }: { state: AppState }) {
  const t = today();
  const heavy = heavyBeforeIntervals(state.schedule.filter(s => s.date >= t))[0];
  if (!heavy) return null;
  const other = state.schedule.find(s => s.date > heavy.date && s.type.startsWith('gym') && s.type !== 'gymC' && !s.done && !s.skipped);
  return (
    <div className="card alert-card">
      <div className="overline">Heads-up</div>
      <b>{NAMES[heavy.type]} now falls on {niceDate(heavy.date, true)}, the day before intervals.</b>
      <div className="muted">Heavy lifting the day before intervals usually costs you on the run.</div>
      {other && (
        <button className="btn" onClick={() => update(s => {
          const a = s.schedule.find(x => x.idx === heavy.idx)!;
          const b = s.schedule.find(x => x.idx === other.idx)!;
          [a.type, b.type] = [b.type, a.type];
        })}>Swap it with {NAMES[other.type]} ({niceDate(other.date)})</button>
      )}
    </div>
  );
}

export function Calendar({ state, onOpen }: { state: AppState; onOpen: (t: Target) => void }) {
  const t = today();
  const [month, setMonth] = useState(t.slice(0, 7));
  const [picked, setPicked] = useState(t);
  const [sheet, setSheet] = useState<'shift' | 'stint' | null>(null);
  /** Roster mode: the shift being filled in ('clear' removes one), or null when off. */
  const [paint, setPaint] = useState<string | null>(null);
  const [draft, setDraft] = useState({ location: 'Port Hedland', start: t, end: t });
  const shiftOf = (d: string) => SHIFTS.find(x => x.id === state.days[d]);
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

      {paint === null ? (
        <button className="btn slim" onClick={() => setPaint('early')}>Fill in my shifts</button>
      ) : (
        <div className="card roster">
          <div className="row"><b>Pick a shift, then tap each day it applies to</b><button className="link" onClick={() => setPaint(null)}>Done</button></div>
          <div className="roster-chips">
            {SHIFTS.filter(x => !x.id.startsWith('travel')).map(x => (
              <button key={x.id} className={paint === x.id ? 'on' : ''} aria-pressed={paint === x.id} onClick={() => setPaint(x.id)}>
                <b>{x.label}</b><span>{x.hours}</span>
              </button>
            ))}
            <button className={paint === 'clear' ? 'on' : ''} aria-pressed={paint === 'clear'} onClick={() => setPaint('clear')}><b>Clear</b><span>Remove a shift</span></button>
          </div>
          <div className="muted small">Travel days are set one at a time: tap Done, then tap the day.</div>
        </div>
      )}

      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div className="cal-head" key={i}>{d}</div>)}
        {weeks.map(d => {
          const sl = slotsOn(d);
          const ex = extrasOn(d);
          return (
            <button key={d} aria-label={niceDate(d, true)}
              className={'cal-day' + (d.slice(0, 7) !== month ? ' out' : '') + (inStint(d) ? ' fifo' : '') + (d === t ? ' today' : '') + (d === picked ? ' picked' : '')}
              onClick={() => {
                setPicked(d);
                // Roster mode: one tap per day sets the chosen shift.
                if (paint === 'clear') update(s => { delete s.days[d]; });
                else if (paint) update(s => { s.days[d] = paint; });
              }}>
              <span className="cal-num">{Number(d.slice(8))}</span>
              {sl.map(s => <span key={s.idx} className={'chip ' + (isGym(s.type) ? 'gym' : 'run') + (s.done ? ' done' : '')}>{SHORT[s.type]}</span>)}
              {ex.length > 0 && <span className="chip practice">P</span>}
              {shiftOf(d) && <span className={'chip ' + (state.days[d].startsWith('travel') ? 'travel' : 'shift')}>{shiftOf(d)!.short}</span>}
            </button>
          );
        })}
      </div>
      <div className="legend">
        <span><i className="chip gym">A</i> Gym</span><span><i className="chip run">Int</i> Run</span><span><i className="chip gym done">A</i> Done</span><span><i className="sw fifo" /> FIFO</span>
      </div>

      <h2>{niceDate(picked, true)}{picked === t ? ' · Today' : ''}</h2>
      <button className="card row tapcard" onClick={() => setSheet('shift')}>
        <div className="grow">
          <div className="overline">Shift</div>
          <b>{shiftOf(picked)?.label ?? 'Not set'}</b>
          <div className="muted small">{shiftOf(picked)?.hours ?? 'Tap to set your shift or a travel day'}{stint ? ` · FIFO: ${stint.location}` : ''}</div>
        </div>
        <span className="muted"><Icon name="right" /></span>
      </button>
      <TravelCard state={state} date={picked} />
      {pickedSlots.length + pickedExtras.length === 0 && dayType !== 'travel-none' && <div className="card muted">Nothing planned for this day.</div>}
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

      <h2>FIFO stints</h2>
      <div className="card list">
        {[...state.stints].sort((a, b) => a.start.localeCompare(b.start)).map(s => (
          <div className="line" key={s.start + s.location}>
            <div><div>{s.location}</div><div className="muted small">{niceDate(s.start)} to {niceDate(s.end)} · FIFO gym</div></div>
            <button className="icon-btn" aria-label={`Remove ${s.location} stint`} onClick={() => update(st => { st.stints = st.stints.filter(x => !(x.start === s.start && x.end === s.end && x.location === s.location)); })}><Icon name="trash" size={18} /></button>
          </div>
        ))}
        {state.stints.length === 0 && <div className="line muted">None added yet.</div>}
      </div>
      <button className="btn" onClick={() => { setDraft({ location: 'Port Hedland', start: picked, end: picked }); setSheet('stint'); }}>Add a FIFO stint</button>

      {sheet === 'shift' && (
        <Sheet title={niceDate(picked, true)} onClose={() => setSheet(null)}>
          <div className="grid2">
            {SHIFTS.map(x => (
              <button key={x.id} className={'btn option' + (state.days[picked] === x.id ? ' on' : '')} onClick={() => { update(s => { s.days[picked] = x.id; }); setSheet(null); }}>
                <b>{x.label}</b><span className="small muted">{x.hours}</span>
              </button>
            ))}
          </div>
          {state.days[picked] && <button className="btn ghost" onClick={() => { update(s => { delete s.days[picked]; }); setSheet(null); }}>Clear this day</button>}
        </Sheet>
      )}
      {sheet === 'stint' && (
        <Sheet title="Add a FIFO stint" onClose={() => setSheet(null)}>
          <p className="muted">The app switches to the FIFO gym, its swaps and its weight steps for these dates.</p>
          <label className="field"><span className="field-label">Location</span>
            <input value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value })} />
          </label>
          <div className="grid2">
            <label className="field"><span className="field-label">First day</span>
              <input type="date" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value, end: e.target.value > draft.end ? e.target.value : draft.end })} />
            </label>
            <label className="field"><span className="field-label">Last day</span>
              <input type="date" value={draft.end} min={draft.start} onChange={e => setDraft({ ...draft, end: e.target.value })} />
            </label>
          </div>
          <button className="btn primary" disabled={!draft.location.trim() || !draft.start || draft.end < draft.start}
            onClick={() => { update(s => { s.stints.push({ location: draft.location.trim(), start: draft.start, end: draft.end, gym: 'fifo' }); }); setSheet(null); }}>Add stint</button>
        </Sheet>
      )}
    </main>
  );
}

export type Tab = 'home' | 'calendar' | 'progress' | 'settings';

export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: string }[] = [
    { id: 'home', label: 'Today', icon: 'home' },
    { id: 'calendar', label: 'Calendar', icon: 'cal' },
    { id: 'progress', label: 'Progress', icon: 'chart' },
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
