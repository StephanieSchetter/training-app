import { useEffect, useState } from 'react';
import { dailyChecks } from './daily';
import { GymSession, startGym } from './Gym';
import { Home } from './Home';
import { RunSession, startRun } from './Run';
import { Progress } from './Progress';
import { today, useStore, VIEW_ONLY } from './store';
import { signIn, syncNow, useSync } from './sync';
import { Settings } from './Settings';
import { Stretch } from './Stretch';
import { Calendar, SessionView, Tab, TabBar, Target } from './Views';

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
        <h1>Compound</h1>
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

export function App() {
  const state = useStore();
  const sync = useSync();
  const [tab, setTab] = useState<Tab>('home');
  const [open, setOpen] = useState<Target | null>(null);
  const [stretching, setStretching] = useState(false);
  const t = today();
  const garminDays = Object.keys(state.garminDays).length;
  const ready = sync.auth === 'in' && !!state.program;

  // Once a day, and again when new Garmin data arrives: move missed sessions and check the resting-HR rule.
  useEffect(() => { if (ready) dailyChecks(); }, [ready, t, garminDays]);

  if (sync.auth === 'loading') return <div className="screen" />;
  if (sync.auth === 'out') return <Login />;
  if (!state.program) {
    return (
      <div className="screen"><main className="page home">
        <h1>Compound</h1>
        <p className="muted">{navigator.onLine ? 'Fetching your program…' : 'You are offline. Connect once so the app can fetch your program.'}</p>
        {sync.error && <div className="notice">{sync.error}</div>}
        <button className="btn" onClick={() => syncNow()}>Try again</button>
      </main></div>
    );
  }
  if (!VIEW_ONLY && state.activeSessionId && state.sessions.some(s => s.id === state.activeSessionId)) return <GymSession sessionId={state.activeSessionId} />;
  if (!VIEW_ONLY && state.activeRunId && state.runs.some(r => r.id === state.activeRunId)) return <RunSession runId={state.activeRunId} />;
  if (stretching && !VIEW_ONLY) return <Stretch state={state} onBack={() => setStretching(false)} />;
  if (open) {
    return <SessionView state={state} target={open} onBack={() => setOpen(null)}
      onStart={slot => { setOpen(null); startGym(state, slot.type, slot); }}
      onStartRun={(slot, readiness) => { setOpen(null); startRun(state, slot, false, readiness); }} />;
  }

  return (
    <div className={'screen' + (VIEW_ONLY && tab === 'progress' ? ' wide' : '')}>
      {tab === 'home' && <Home state={state} sync={sync} onOpen={setOpen} onStretch={() => setStretching(true)} onProgress={() => setTab('progress')} />}
      {tab === 'calendar' && <Calendar state={state} onOpen={setOpen} />}
      {tab === 'progress' && <Progress state={state} />}
      {tab === 'settings' && <Settings state={state} sync={sync} />}
      <TabBar tab={tab} onTab={setTab} />
    </div>
  );
}
