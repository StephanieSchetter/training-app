import { useState } from 'react';
import { GymSession } from './Gym';
import { isGym, Slot } from './engine/schedule';
import { AppState, gymForDate, SessionLog, today, uid, update, useStore, write } from './store';
import { signIn, syncNow, useSync, waitingTooLong } from './sync';
import { Icon, Sheet } from './ui';

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

const NAMES: Record<string, string> = {
  easy: 'Easy run', intervals: 'Intervals', threshold: 'Threshold run',
  gymA: 'Gym A', gymB: 'Gym B', gymC: 'Gym C', gymD: 'Gym D',
};
const SHORT: Record<string, string> = { easy: 'Easy', intervals: 'Int', threshold: 'Thr', gymA: 'A', gymB: 'B', gymC: 'C', gymD: 'D' };

function niceDate(d: string, long = false) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: long ? 'long' : 'short', day: 'numeric', month: 'short' });
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

function TypeIcon({ type }: { type: string }) {
  return <span className={'type ' + (isGym(type as Slot['type']) ? 'gym' : 'run')}><Icon name={isGym(type as Slot['type']) ? 'bar' : 'run'} size={20} /></span>;
}

export function App() {
  const state = useStore();
  const sync = useSync();
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

  const p = state.program;
  const t = today();
  const started = t >= p.start;
  const todays = state.schedule.filter(s => s.date === t && !s.skipped).sort((a, b) => a.order - b.order);
  const upcoming = state.schedule.filter(s => s.date > t && !s.done && !s.skipped).slice(0, 7);
  const week = todays[0]?.week ?? state.schedule.find(s => s.date >= t)?.week ?? 1;
  const weekSlots = state.schedule.filter(s => s.week === week);
  const gym = gymForDate(state, t);
  const stint = state.stints.find(x => t >= x.start && t <= x.end);
  const practice = state.sessions.filter(s => s.practice);
  const open = state.sessions.filter(s => !s.finishedAt);

  return (
    <div className="screen">
      <main className="page home">
        <header className="home-head">
          <div>
            <div className="overline">{niceDate(t, true)}</div>
            <h1>{started ? `Block ${p.block} · Week ${week}` : 'Training'}</h1>
            <div className="muted">{started ? `${gym.name} gym${stint ? ` · ${stint.location}` : ''}` : `Block ${p.block} starts ${niceDate(p.start)}`}</div>
          </div>
          <button className={'pill' + (sync.pending ? ' warn' : '')} onClick={() => syncNow()}>
            <Icon name="cloud" size={16} /> {sync.pending ? `${sync.pending} item${sync.pending > 1 ? 's' : ''} waiting to upload` : 'All uploaded'}
          </button>
        </header>

        {waitingTooLong(sync) && (
          <div className="card warn-card">
            <Icon name="cloud" />
            <div>Some items have been waiting more than 24 hours to upload. They are safe on this phone. Check your signal, then tap the upload badge to retry.</div>
          </div>
        )}

        {open.length > 0 && (
          <>
            <h2>In progress</h2>
            {open.map(s => (
              <div className="card row" key={s.id}>
                <TypeIcon type={s.type} />
                <div className="grow"><b>{NAMES[s.type]}{s.practice ? ' · practice' : ''}</b><div className="muted small">{state.sets.filter(x => x.sessionId === s.id && !x.rampUp && !x.extra).length} sets logged</div></div>
                <button className="btn primary fit" onClick={() => update(st => { st.activeSessionId = s.id; })}>Resume</button>
              </div>
            ))}
          </>
        )}

        <h2>Today</h2>
        {todays.length === 0 && (
          <div className="card muted">
            {state.days[t] === 'travel-train' ? 'Travel day. Train before you fly.' : state.days[t] === 'travel-none' ? 'Travel day. No training.' : started ? 'Nothing scheduled today.' : 'Nothing scheduled yet. Your first session is below.'}
          </div>
        )}
        {todays.map(s => {
          const running = open.some(o => o.slotIdx === s.idx);
          return (
            <div className="card row" key={s.idx}>
              <TypeIcon type={s.type} />
              <div className="grow"><b>{NAMES[s.type]}</b><div className="muted small">{s.done ? 'Done' : isGym(s.type) ? `${gym.name} gym` : 'Run screens are coming next'}</div></div>
              {s.done ? <span className="ok"><Icon name="check" /></span>
                : isGym(s.type) && !running ? <button className="btn primary fit" onClick={() => startGym(state, s.type, s)}>Start</button> : null}
            </div>
          );
        })}

        {started && (
          <>
            <h2>This week</h2>
            <div className="weekstrip">
              {weekSlots.map(s => (
                <div key={s.idx} className={(s.done ? 'done ' : '') + (s.date === t ? 'today' : '')}>
                  <span className="muted">{niceDate(s.date).slice(0, 3)}</span>
                  <b>{SHORT[s.type]}</b>
                </div>
              ))}
            </div>
          </>
        )}

        {!started && (
          <>
            <h2>Practice run-through</h2>
            <div className="card">
              <div className="muted small">Try the gym screens before Block 1 starts. Practice sets never count towards suggestions or charts.</div>
              <div className="grid2">
                {['gymB', 'gymC', 'gymA', 'gymD'].map(g => <button className="btn" key={g} onClick={() => startGym(state, g, null)}>{NAMES[g]}</button>)}
              </div>
              {practice.length > 0 && <button className="btn ghost" onClick={() => setConfirmWipe(true)}>Delete practice data · {practice.length} session{practice.length > 1 ? 's' : ''}</button>}
            </div>
          </>
        )}

        <h2>Coming up</h2>
        <div className="card list">
          {upcoming.map(s => (
            <div className="line" key={s.idx}>
              <div className="row"><TypeIcon type={s.type} /><span>{NAMES[s.type]}</span></div>
              <span className="muted">{niceDate(s.date)}</span>
            </div>
          ))}
        </div>
      </main>

      {confirmWipe && (
        <Sheet title="Delete practice data?" onClose={() => setConfirmWipe(false)}>
          <p className="muted">This removes every practice session and its sets. Your gym equipment answers are kept.</p>
          <button className="btn danger" onClick={() => {
            update(s => {
              const ids = new Set(s.sessions.filter(x => x.practice).map(x => x.id));
              s.sessions = s.sessions.filter(x => !ids.has(x.id));
              s.sets = s.sets.filter(x => !ids.has(x.sessionId));
            });
            setConfirmWipe(false);
          }}>Delete practice data</button>
          <button className="btn ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
        </Sheet>
      )}
    </div>
  );
}
