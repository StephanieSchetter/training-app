// The Today tab (spec 5.1): what to do today, anything that needs a decision, and what's coming.
import { useState } from 'react';
import { readinessSuggestion } from './engine/running';
import { addDays, isGym, shiftFrom, Slot } from './engine/schedule';
import { startGym } from './Gym';
import { startPracticeRun } from './Run';
import { buildRun } from './runplan';
import { AppState, Checkin, currentSpeeds, Feel, gymForDate, RunType, today, uid, update } from './store';
import { syncNow, SyncView, waitingTooLong } from './sync';
import { Icon, Segmented, Sheet } from './ui';
import { HeavyGuardCard, NAMES, niceDate, Target, TravelCard, TypeIcon } from './Views';

const SHORT: Record<string, string> = { easy: 'Easy', intervals: 'Int', threshold: 'Thr', gymA: 'A', gymB: 'B', gymC: 'C', gymD: 'D' };
const FEELS: { value: Feel; label: string }[] = [{ value: 'better', label: 'Better' }, { value: 'same', label: 'Same' }, { value: 'worse', label: 'Worse' }];
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** One-line description of a planned session, e.g. "5 × 800 m at 13.8 km/h, 2 min recovery". */
function blurb(state: AppState, s: Slot): string {
  if (isGym(s.type)) return `${state.program!.sessions[s.type].items.length} exercises · ${gymForDate(state, s.date).name} gym`;
  if (!state.program!.running) return 'Run';
  return buildRun(state.program!, s.week, s.type as RunType, currentSpeeds(state))?.summary ?? 'Run';
}

/** Morning-after check-in (5.4): two rows, about ten seconds. */
function CheckinCard({ state, t }: { state: AppState; t: string }) {
  const [knee, setKnee] = useState<Feel>('same');
  const [back, setBack] = useState<Feel>('same');
  const last = state.sessions.filter(s => !s.practice && s.finishedAt && s.date < t).sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!last || daysBetween(last.date, t) > 3 || state.checkins.some(c => c.sessionId === last.id)) return null;
  const save = () => {
    const sets = state.sets.filter(x => x.sessionId === last.id && !x.extra);
    const tagged = (tag: string) => [...new Set(sets.map(x => x.exId))].filter(ex => state.program!.exercises[ex]?.tags?.includes(tag));
    const anyTagged = (knee === 'worse' && tagged('knee').length > 0) || (back === 'worse' && tagged('back').length > 0);
    const c: Checkin = {
      id: last.id, sessionId: last.id, date: t, knee, back,
      reduce: anyTagged ? 'pending' : undefined,
      backFlare: back === 'worse' ? 'pending' : undefined,
      blockPull: knee === 'worse' && sets.some(x => x.plannedExId === 'deadlift') ? 'pending' : undefined,
    };
    update(s => { s.checkins.push(c); });
  };
  return (
    <div className="card">
      <div className="overline">Morning check-in · after {NAMES[last.type]}</div>
      <b>How do your knee and back feel this morning?</b>
      <div className="field"><div className="field-label">Knee</div><Segmented options={FEELS} value={knee} onChange={v => v && setKnee(v)} /></div>
      <div className="field"><div className="field-label">Back</div><Segmented options={FEELS} value={back} onChange={v => v && setBack(v)} /></div>
      <button className="btn primary fit-h" onClick={save}>Save check-in</button>
    </div>
  );
}

/** What follows a "worse" check-in (6.7). Each offer is Brad's call, and the answer is stored. */
function CheckinOffers({ state }: { state: AppState }) {
  const c = [...state.checkins].sort((a, b) => b.date.localeCompare(a.date)).find(x => x.reduce === 'pending' || x.backFlare === 'pending' || x.blockPull === 'pending');
  if (!c) return null;
  const session = state.sessions.find(s => s.id === c.sessionId);
  const sets = state.sets.filter(x => x.sessionId === c.sessionId && !x.extra);
  const ex = state.program!.exercises;
  const lifts = [...new Set(sets.map(x => x.exId))].filter(id => (c.knee === 'worse' && ex[id]?.tags?.includes('knee')) || (c.back === 'worse' && ex[id]?.tags?.includes('back')));
  const answer = (key: 'reduce' | 'backFlare' | 'blockPull', yes: boolean) => update(s => {
    s.checkins.find(x => x.id === c.id)![key] = yes ? 'yes' : 'no';
    if (!yes) return;
    const now = Date.now();
    if (key === 'reduce') {
      for (const id of lifts) s.reductions.push({ id: uid(), exId: id, createdAt: now, because: c.knee === 'worse' && ex[id]?.tags?.includes('knee') ? 'knee' : 'back' });
    } else if (key === 'backFlare') {
      const t = today();
      const week = s.schedule.find(x => !x.done && !x.skipped && x.date >= t)?.week;
      s.tempSwaps.push({ id: uid(), kind: 'back-flare', week, createdAt: now });
    } else {
      s.tempSwaps.push({ id: uid(), kind: 'block-pull', createdAt: now });
    }
  });
  const what = [c.knee === 'worse' ? 'knee' : null, c.back === 'worse' ? 'back' : null].filter(Boolean).join(' and ');
  const Row = ({ k, title, detail, yes }: { k: 'reduce' | 'backFlare' | 'blockPull'; title: string; detail: string; yes: string }) => (
    <div className="card alert-card">
      <div className="overline">Suggestion · {what} worse after {session ? NAMES[session.type] : 'your last session'}</div>
      <b>{title}</b>
      <div className="muted">{detail}</div>
      <div className="grid2">
        <button className="btn" onClick={() => answer(k, false)}>No thanks</button>
        <button className="btn primary fit-h" onClick={() => answer(k, true)}>{yes}</button>
      </div>
    </div>
  );
  return (
    <>
      {c.reduce === 'pending' && <Row k="reduce" title="Go 10% lighter next time on these lifts" detail={lifts.map(id => ex[id].name).join(', ')} yes="Go lighter" />}
      {c.backFlare === 'pending' && <Row k="backFlare" title="Swap deadlift and single-leg RDL for 45° back extension" detail="For the rest of this training week. Everything else stays the same." yes="Swap them" />}
      {c.blockPull === 'pending' && <Row k="blockPull" title="Pull from blocks at your next deadlift session" detail="Bar set just below the knee, to take load off the knee." yes="Use block pulls" />}
    </>
  );
}

export function Home({ state, sync, onOpen }: { state: AppState; sync: SyncView; onOpen: (t: Target) => void }) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const p = state.program!;
  const t = today();
  const started = t >= p.start;
  const todays = state.schedule.filter(s => s.date === t && !s.skipped).sort((a, b) => a.order - b.order);
  const upcoming = state.schedule.filter(s => s.date > t && !s.done && !s.skipped).slice(0, 7);
  const week = todays[0]?.week ?? state.schedule.find(s => s.date >= t)?.week ?? 1;
  const weekSlots = state.schedule.filter(s => s.week === week && !s.skipped);
  const gym = gymForDate(state, t);
  const stint = state.stints.find(x => t >= x.start && t <= x.end);
  const practiceCount = state.sessions.filter(s => s.practice).length + state.runs.filter(r => r.practice).length;
  const inProgress = state.sessions.filter(s => !s.finishedAt);
  const runsOpen = state.runs.filter(r => !r.finishedAt);
  const garminDay = state.garminDays[t];
  const lastGarmin = state.garminStatus?.lastSync ? Date.parse(state.garminStatus.lastSync) : null;
  const garminStale = state.garminStatus !== null && (lastGarmin === null || Date.now() - lastGarmin > 24 * 3600 * 1000);
  const alerts = state.alerts.filter(a => a.status === 'open');
  const travelDays = Array.from({ length: 15 }, (_, i) => addDays(t, i)).filter(d => state.days[d] === 'travel-none');

  const answerAlert = (id: string, accept: boolean) => update(s => {
    const a = s.alerts.find(x => x.id === id)!;
    a.status = accept ? 'accepted' : 'ignored';
    if (!accept) return;
    if (a.kind === 'intervals-slipping') {
      // Pull-back rule 1: drop the next Gym B.
      const next = s.schedule.find(x => x.type === 'gymB' && !x.done && !x.skipped && x.date >= t);
      if (next) next.skipped = true;
    } else {
      // Pull-back rule 2: two full days off; everything moves two days.
      s.schedule = shiftFrom(s.schedule, t, 2);
    }
  });

  return (
    <main className="page home">
      <header className="home-head">
        <div>
          <div className="overline">{niceDate(t, true)}</div>
          <h1>{started ? `Block ${p.block} · Week ${week}` : 'Training'}</h1>
          <div className="muted">{started ? `${gym.name} gym${stint ? ` · ${stint.location}` : ''}` : `Block ${p.block} starts ${niceDate(p.start)}`}</div>
        </div>
        <button className={'pill' + (sync.pending ? ' warn' : '')} onClick={() => syncNow()}>
          <Icon name="cloud" size={16} /> {sync.pending ? `${sync.pending} to upload` : 'All uploaded'}
        </button>
      </header>

      {waitingTooLong(sync) && (
        <div className="card warn-card"><Icon name="cloud" />
          <div>Some items have been waiting more than 24 hours to upload. They are safe on this phone. Check your signal, then tap the upload badge to retry.</div>
        </div>
      )}
      {garminStale && (
        <div className="card warn-card"><Icon name="info" />
          <div>Garmin data is out of date. Last synced {state.garminStatus?.lastSync ? niceDate(state.garminStatus.lastSync.slice(0, 10)) : 'never'}. Everything else works as normal.</div>
        </div>
      )}
      {garminDay && (
        <div className="stats four">
          <div><div className="overline">Readiness</div><b>{garminDay.readiness ?? '—'}</b></div>
          <div><div className="overline">Sleep</div><b>{garminDay.sleepHours != null ? `${garminDay.sleepHours.toFixed(1)} h` : '—'}</b></div>
          <div><div className="overline">Resting HR</div><b>{garminDay.restingHr ?? '—'}</b></div>
          <div><div className="overline">HRV</div><b>{garminDay.hrv != null ? Math.round(garminDay.hrv) : '—'}</b></div>
        </div>
      )}

      {state.notices.map(n => (
        <div className="card row" key={n.id}>
          <div className="grow"><div className="overline">Schedule change</div>{n.text}</div>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => update(s => { s.notices = s.notices.filter(x => x.id !== n.id); })}><Icon name="x" /></button>
        </div>
      ))}

      <CheckinCard state={state} t={t} />
      <CheckinOffers state={state} />

      {alerts.map(a => (
        <div className="card alert-card" key={a.id}>
          <div className="overline">Suggestion</div>
          {a.kind === 'intervals-slipping' ? (
            <>
              <b>Interval speeds have slipped two sessions in a row.</b>
              <div className="muted">Next week's intervals drop by 0.3 km/h. To help you recover, the suggestion is to skip your next Gym B.</div>
            </>
          ) : (
            <>
              <b>Your resting heart rate has been 5 or more beats above normal for three days.</b>
              <div className="muted">The suggestion is two full days off. Accepting moves every remaining session two days later.</div>
            </>
          )}
          <div className="grid2">
            <button className="btn" onClick={() => answerAlert(a.id, false)}>Ignore</button>
            <button className="btn primary fit-h" onClick={() => answerAlert(a.id, true)}>{a.kind === 'intervals-slipping' ? 'Skip Gym B' : 'Take two days off'}</button>
          </div>
        </div>
      ))}

      {travelDays.map(d => <TravelCard key={d} state={state} date={d} />)}
      <HeavyGuardCard state={state} />

      {inProgress.length + runsOpen.length > 0 && (
        <>
          <h2>In progress</h2>
          {runsOpen.map(r => (
            <div className="card row" key={r.id}>
              <TypeIcon type={r.type} />
              <div className="grow"><b>{r.title}</b><div className="muted small">{r.segs.filter(x => x.done).length} of {r.segs.length} parts done</div></div>
              <button className="btn primary fit" onClick={() => update(st => { st.activeRunId = r.id; })}>Resume</button>
            </div>
          ))}
          {inProgress.map(s => (
            <div className="card row" key={s.id}>
              <TypeIcon type={s.type} />
              <div className="grow"><b>{NAMES[s.type]}{s.practice ? ' · Practice' : ''}</b><div className="muted small">{state.sets.filter(x => x.sessionId === s.id && !x.rampUp && !x.extra).length} sets logged so far</div></div>
              <button className="btn primary fit" onClick={() => update(st => { st.activeSessionId = s.id; })}>Resume</button>
            </div>
          ))}
        </>
      )}

      <h2>Today</h2>
      {todays.length === 0 && (
        <div className="card muted">
          {state.days[t] === 'travel-train' ? 'Travel day. Train before you fly.' : state.days[t] === 'travel-none' ? 'Travel day. No training.' : started ? 'Nothing scheduled today. Enjoy the rest.' : `Nothing scheduled yet. Block ${p.block} starts ${niceDate(p.start, true)}.`}
        </div>
      )}
      {todays.map(s => {
        const running = inProgress.some(o => o.slotIdx === s.idx) || runsOpen.some(o => o.slotIdx === s.idx);
        const sug = garminDay?.readiness != null ? readinessSuggestion(garminDay.readiness, s.type) : null;
        const changes = sug && sug.text !== 'As planned';
        return (
          <div className="card" key={s.idx}>
            <button className="row tapcard bare" onClick={() => onOpen({ slotIdx: s.idx })}>
              <TypeIcon type={s.type} />
              <div className="grow"><b>{NAMES[s.type]}</b><div className="muted small">{blurb(state, s)}</div></div>
              {s.done ? <span className="ok"><Icon name="check" /></span> : <span className="muted"><Icon name="right" /></span>}
            </button>
            {!s.done && changes && <div className="notice"><Icon name="info" size={16} /> Readiness {garminDay!.readiness}: {sug!.text}. You choose when you start.</div>}
            {isGym(s.type) && !s.done && !running && <button className="btn primary" onClick={() => startGym(state, s.type, s)}>Start {NAMES[s.type]}</button>}
            {!isGym(s.type) && !s.done && !running && p.running && <button className="btn primary" onClick={() => onOpen({ slotIdx: s.idx })}>Open {NAMES[s.type]}</button>}
          </div>
        );
      })}

      {started && (
        <>
          <h2>This week</h2>
          <div className="weekstrip">
            {weekSlots.map(s => (
              <button key={s.idx} className={(s.done ? 'done ' : '') + (s.date === t ? 'today' : '')} onClick={() => onOpen({ slotIdx: s.idx })}>
                <span className="muted">{niceDate(s.date).slice(0, 3)}</span>
                <b>{SHORT[s.type]}</b>
              </button>
            ))}
          </div>
        </>
      )}

      <h2>Coming up</h2>
      <div className="card list">
        {upcoming.map(s => (
          <button className="line tapline" key={s.idx} onClick={() => onOpen({ slotIdx: s.idx })}>
            <TypeIcon type={s.type} />
            <div className="grow"><div>{NAMES[s.type]}</div><div className="muted small">{blurb(state, s)}</div></div>
            <span className="muted nowrap small">{niceDate(s.date)}</span>
            <span className="muted"><Icon name="right" size={18} /></span>
          </button>
        ))}
      </div>

      {!started && (
        <>
          <h2>Practice run-through</h2>
          <div className="card">
            <div className="muted small">Try any session before Block {p.block} starts. Practice never counts towards suggestions, speeds or charts.</div>
            <div className="overline">Gym</div>
            <div className="grid2">
              {['gymB', 'gymC', 'gymA', 'gymD'].map(g => <button className="btn" key={g} onClick={() => startGym(state, g, null)}>{NAMES[g]}</button>)}
            </div>
            {p.running && (
              <>
                <div className="overline">Runs</div>
                <div className="grid2">
                  <button className="btn" onClick={() => startPracticeRun(state, 'easy', 1)}>Easy Run</button>
                  <button className="btn" onClick={() => startPracticeRun(state, 'intervals', 1)}>Intervals</button>
                  <button className="btn" onClick={() => startPracticeRun(state, 'threshold', 1)}>Threshold Run</button>
                  <button className="btn" onClick={() => startPracticeRun(state, 'intervals', 4)}>Time Trial</button>
                </div>
              </>
            )}
            {practiceCount > 0 && <button className="btn ghost" onClick={() => setConfirmWipe(true)}>Delete practice data · {practiceCount} session{practiceCount > 1 ? 's' : ''}</button>}
          </div>
        </>
      )}

      {confirmWipe && (
        <Sheet title="Delete practice data?" onClose={() => setConfirmWipe(false)}>
          <p className="muted">This removes every practice session and its sets. Your gym equipment answers are kept.</p>
          <button className="btn danger" onClick={() => {
            update(s => {
              const ids = new Set(s.sessions.filter(x => x.practice).map(x => x.id));
              s.sessions = s.sessions.filter(x => !ids.has(x.id));
              s.sets = s.sets.filter(x => !ids.has(x.sessionId));
              s.runs = s.runs.filter(x => !x.practice);
              if (s.activeSessionId && ids.has(s.activeSessionId)) s.activeSessionId = null;
            });
            setConfirmWipe(false);
          }}>Delete practice data</button>
          <button className="btn ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
        </Sheet>
      )}
    </main>
  );
}
