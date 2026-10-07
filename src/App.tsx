import { useState } from 'react';
import { GymSession } from './Gym';
import { isGym, Slot } from './engine/schedule';
import { buildRun } from './runplan';
import { RunSession, startPracticeRun, startRun } from './Run';
import { AppState, currentSpeeds, gymForDate, RunType, SessionLog, today, uid, update, useStore, write } from './store';
import { signIn, syncNow, useSync, waitingTooLong } from './sync';
import { Icon, Sheet } from './ui';
import { Calendar, NAMES, niceDate, SessionView, Settings, Tab, TabBar, Target, TypeIcon } from './Views';

const SHORT: Record<string, string> = { easy: 'Easy', intervals: 'Int', threshold: 'Thr', gymA: 'A', gymB: 'B', gymC: 'C', gymD: 'D' };

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="screen">
      <form className="page home login" onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(await signIn(email.trim(), password));
        setBusy(false);
      }}>
        <h1>Training</h1>
        <p className="muted">Sign in once. This phone stays signed in.</p>
        <label className="field"><span className="field-label">Email</span>
          <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        </label>
        <label className="field"><span className="field-label">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="notice">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function startGym(state: AppState, type: string, slot: Slot | null) {
  const date = today();
  const gym = gymForDate(state, date);
  const swaps: Record<string, string> = {};
  if (gym.id === 'fifo') for (const sw of state.program!.swaps) if (sw.when === 'fifo') swaps[sw.from] = sw.to;
  const session: SessionLog = {
    id: uid(), slotIdx: slot ? slot.idx : null, type, date, gymId: gym.id, week: slot ? slot.week : 1,
    practice: !slot, swaps, warmup: [], startedAt: Date.now(),
  };
  write('sessions', session.id, s => { s.sessions.push(session); s.activeSessionId = session.id; });
}

/** One-line description of a planned session, e.g. "5 × 800 m at 13.8 km/h, 2 min recovery". */
function blurb(state: AppState, s: Slot): string {
  if (isGym(s.type)) {
    const items = state.program!.sessions[s.type].items;
    return `${items.length} exercises · ${gymForDate(state, s.date).name} gym`;
  }
  if (!state.program!.running) return 'Run';
  return buildRun(state.program!, s.week, s.type as RunType, currentSpeeds(state))?.summary ?? 'Run';
}

export function App() {
  const state = useStore();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>('home');
  const [open, setOpen] = useState<Target | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  if (sync.auth === 'loading') return <div className="screen" />;
  if (sync.auth === 'out') return <Login />;
  if (!state.program) {
    return (
      <div className="screen"><main className="page home">
        <h1>Training</h1>
        <p className="muted">{navigator.onLine ? 'Fetching your program…' : 'You are offline. Connect once so the app can fetch your program.'}</p>
        {sync.error && <div className="notice">{sync.error}</div>}
        <button className="btn" onClick={() => syncNow()}>Try again</button>
      </main></div>
    );
  }
  if (state.activeSessionId) return <GymSession sessionId={state.activeSessionId} />;
  if (state.activeRunId && state.runs.some(r => r.id === state.activeRunId)) return <RunSession runId={state.activeRunId} />;
  if (open) {
    return <SessionView state={state} target={open} onBack={() => setOpen(null)}
      onStart={slot => { setOpen(null); startGym(state, slot.type, slot); }}
      onStartRun={slot => { setOpen(null); startRun(state, slot); }} />;
  }

  const p = state.program;
  const t = today();
  const started = t >= p.start;
  const todays = state.schedule.filter(s => s.date === t && !s.skipped).sort((a, b) => a.order - b.order);
  const upcoming = state.schedule.filter(s => s.date > t && !s.done && !s.skipped).slice(0, 7);
  const week = todays[0]?.week ?? state.schedule.find(s => s.date >= t)?.week ?? 1;
  const weekSlots = state.schedule.filter(s => s.week === week);
  const gym = gymForDate(state, t);
  const stint = state.stints.find(x => t >= x.start && t <= x.end);
  const practiceCount = state.sessions.filter(s => s.practice).length + state.runs.filter(r => r.practice).length;
  const inProgress = state.sessions.filter(s => !s.finishedAt);
  const runsOpen = state.runs.filter(r => !r.finishedAt);
  const alerts = state.alerts.filter(a => a.status === 'open');
  const answerAlert = (id: string, accept: boolean) => update(s => {
    const a = s.alerts.find(x => x.id === id)!;
    a.status = accept ? 'accepted' : 'ignored';
    // Pull-back rule 1: drop the next Gym B.
    const next = accept ? s.schedule.find(x => x.type === 'gymB' && !x.done && !x.skipped && x.date >= t) : undefined;
    if (next) next.skipped = true;
  });

  return (
    <div className="screen">
      {tab === 'calendar' && <Calendar state={state} onOpen={setOpen} />}
      {tab === 'settings' && <Settings state={state} sync={sync} />}
      {tab === 'home' && (
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
            <div className="card warn-card">
              <Icon name="cloud" />
              <div>Some items have been waiting more than 24 hours to upload. They are safe on this phone. Check your signal, then tap the upload badge to retry.</div>
            </div>
          )}

          {alerts.map(a => (
            <div className="card alert-card" key={a.id}>
              <div className="overline">Suggestion</div>
              <b>Interval speeds have slipped two sessions in a row.</b>
              <div className="muted">Next week's intervals drop by 0.3 km/h. To help you recover, the suggestion is to skip your next Gym B.</div>
              <div className="grid2">
                <button className="btn" onClick={() => answerAlert(a.id, false)}>Ignore</button>
                <button className="btn primary fit-h" onClick={() => answerAlert(a.id, true)}>Skip Gym B</button>
              </div>
            </div>
          ))}

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
            const running = inProgress.some(o => o.slotIdx === s.idx);
            return (
              <div className="card" key={s.idx}>
                <button className="row tapcard bare" onClick={() => setOpen({ slotIdx: s.idx })}>
                  <TypeIcon type={s.type} />
                  <div className="grow"><b>{NAMES[s.type]}</b><div className="muted small">{blurb(state, s)}</div></div>
                  {s.done ? <span className="ok"><Icon name="check" /></span> : <span className="muted"><Icon name="right" /></span>}
                </button>
                {isGym(s.type) && !s.done && !running && <button className="btn primary" onClick={() => startGym(state, s.type, s)}>Start {NAMES[s.type]}</button>}
                {!isGym(s.type) && !s.done && p.running && !runsOpen.some(r => r.slotIdx === s.idx) && <button className="btn primary" onClick={() => startRun(state, s)}>Start {NAMES[s.type]}</button>}
              </div>
            );
          })}

          {started && (
            <>
              <h2>This week</h2>
              <div className="weekstrip">
                {weekSlots.map(s => (
                  <button key={s.idx} className={(s.done ? 'done ' : '') + (s.date === t ? 'today' : '')} onClick={() => setOpen({ slotIdx: s.idx })}>
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
              <button className="line tapline" key={s.idx} onClick={() => setOpen({ slotIdx: s.idx })}>
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
        </main>
      )}

      <TabBar tab={tab} onTab={setTab} />

      {confirmWipe && (
        <Sheet title="Delete practice data?" onClose={() => setConfirmWipe(false)}>
          <p className="muted">This removes every practice session and its sets. Your gym equipment answers are kept.</p>
          <button className="btn danger" onClick={() => {
            update(s => {
              const ids = new Set(s.sessions.filter(x => x.practice).map(x => x.id));
              s.sessions = s.sessions.filter(x => !ids.has(x.id));
              s.sets = s.sets.filter(x => !ids.has(x.sessionId));
              s.runs = s.runs.filter(x => !x.practice);
            });
            setConfirmWipe(false);
          }}>Delete practice data</button>
          <button className="btn ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
        </Sheet>
      )}
    </div>
  );
}
