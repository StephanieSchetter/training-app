// Settings (spec 5.7): gym equipment, rest times, swaps, body weight, physio notes, program, Garmin, upload.
import { ReactNode, useRef, useState } from 'react';
import { exportAll } from './export';
import { AppState, Program, setProgram, today, uid, update } from './store';
import { APP_VERSION, syncNow, SyncView, waitingTooLong } from './sync';
import { clock, Icon, Sheet } from './ui';
import { niceDate } from './Views';

type Page = 'main' | 'gyms' | 'rest' | 'swaps' | 'weight' | 'physio';

function Mini({ value, onMinus, onPlus, label }: { value: string; onMinus: () => void; onPlus: () => void; label: string }) {
  return (
    <div className="mini-step">
      <button aria-label={`Less ${label}`} onClick={onMinus}><Icon name="minus" size={18} /></button>
      <b>{value}</b>
      <button aria-label={`More ${label}`} onClick={onPlus}><Icon name="plus" size={18} /></button>
    </div>
  );
}

function Sub({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <main className="page home">
      <div className="row sub-head">
        <button className="icon-btn" aria-label="Back to settings" onClick={onBack}><Icon name="left" /></button>
        <h1>{title}</h1>
        <span className="icon-btn" />
      </div>
      {children}
    </main>
  );
}

const round = (n: number, step: number) => Math.round(n / step) * step;
const WHEN: Record<string, string> = {
  'fifo': 'At the FIFO gym (automatic)',
  'back-flare': 'Back flare (offered after a "worse" check-in)',
  'knee-after-deadlift': 'Knee worse after deadlifts (offered after a "worse" check-in)',
  'manual': 'Available from the Swap button',
};

export function Settings({ state, sync }: { state: AppState; sync: SyncView }) {
  const [page, setPage] = useState<Page>('main');
  const file = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<Program | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [message2, setMessage2] = useState<string | null>(null);
  const [kg, setKg] = useState('');
  const [kgDate, setKgDate] = useState(today());
  const [note, setNote] = useState('');
  const [noteDate, setNoteDate] = useState(today());
  const [swap, setSwap] = useState({ from: '', to: '' });
  const p = state.program!;
  const back = () => setPage('main');
  const name = (id: string) => p.exercises[id]?.name ?? id;

  if (page === 'gyms') {
    return (
      <Sub title="Gym equipment" onBack={back}>
        <p className="lead small">These decide the weights the app can suggest at each gym. Machines appear here after you first use them at that gym.</p>
        {state.profiles.map(g => {
          const patch = (fn: (x: AppState['profiles'][number]) => void) => update(s => fn(s.profiles.find(x => x.id === g.id)!));
          return (
            <div className="stack" key={g.id}>
              <h2>{g.name} gym</h2>
              <div className="card list">
                <div className="line"><span>Dumbbell step</span>
                  <Mini label="dumbbell step" value={`${g.dumbbellStep} kg`} onMinus={() => patch(x => { x.dumbbellStep = Math.max(0.5, round(x.dumbbellStep - 0.5, 0.5)); })} onPlus={() => patch(x => { x.dumbbellStep = round(x.dumbbellStep + 0.5, 0.5); })} />
                </div>
                <div className="line"><div><div>Smallest barbell plate</div><div className="muted small">One plate. The bar goes up by two of these.</div></div>
                  <Mini label="smallest plate" value={g.smallestPlate === null ? 'Not set' : `${g.smallestPlate} kg`} onMinus={() => patch(x => { x.smallestPlate = Math.max(0.25, round((x.smallestPlate ?? 1.25) - 0.25, 0.25)); })} onPlus={() => patch(x => { x.smallestPlate = round((x.smallestPlate ?? 1) + 0.25, 0.25); })} />
                </div>
                <div className="line col"><div>Kettlebell sizes (kg)</div>
                  <input key={g.kettlebells.join()} defaultValue={g.kettlebells.join(', ')} placeholder="e.g. 8, 12, 16, 20" inputMode="text"
                    onBlur={e => { const nums = e.target.value.split(/[ ,]+/).map(Number).filter(n => n > 0).sort((a, b) => a - b); patch(x => { x.kettlebells = nums; }); }} />
                </div>
                {Object.entries(g.machineSteps).map(([ex, step]) => (
                  <div className="line" key={ex}><div><div>{name(ex)}</div><div className="muted small">Weight step on this machine</div></div>
                    <Mini label={`${name(ex)} step`} value={`${step} kg`} onMinus={() => patch(x => { x.machineSteps[ex] = Math.max(0.5, round(step - 0.5, 0.5)); })} onPlus={() => patch(x => { x.machineSteps[ex] = round(step + 0.5, 0.5); })} />
                  </div>
                ))}
                {Object.keys(g.machineSteps).length === 0 && <div className="line muted small">No machines used here yet.</div>}
              </div>
            </div>
          );
        })}
      </Sub>
    );
  }

  if (page === 'rest') {
    const seen = new Set<string>();
    const rows = Object.values(p.sessions).flatMap(s => s.items).filter(i => !seen.has(i.ex) && seen.add(i.ex));
    return (
      <Sub title="Rest times" onBack={back}>
        <p className="lead small">3:00 for the main lifts and 1:30 for everything else, unless you change it here or during a session.</p>
        <div className="card list">
          {rows.map(i => {
            const base = i.scheme.t === 'rpt' ? 180 : 90;
            const rest = state.restOverrides[i.ex] ?? base;
            return (
              <div className="line" key={i.ex}><div><div>{name(i.ex)}</div>{rest !== base && <div className="muted small">Changed from {clock(base)}</div>}</div>
                <Mini label={`${name(i.ex)} rest`} value={clock(rest)} onMinus={() => update(s => { s.restOverrides[i.ex] = Math.max(15, rest - 15); })} onPlus={() => update(s => { s.restOverrides[i.ex] = rest + 15; })} />
              </div>
            );
          })}
        </div>
      </Sub>
    );
  }

  if (page === 'swaps') {
    const planned = [...new Set(Object.values(p.sessions).flatMap(s => s.items.map(i => i.ex)))];
    const all = Object.keys(p.exercises).sort((a, b) => name(a).localeCompare(name(b)));
    return (
      <Sub title="Exercise swaps" onBack={back}>
        {Object.keys(WHEN).map(when => (
          <div className="stack" key={when}>
            <h2>{WHEN[when]}</h2>
            <div className="card list">
              {p.swaps.filter(s => s.when === when).map(s => (
                <div className="line" key={s.from + s.to}>
                  <div><div className="muted small strike">{name(s.from)}</div><div>{name(s.to)}</div></div>
                  {when === 'fifo' && <button className="icon-btn" aria-label={`Remove swap for ${name(s.from)}`} onClick={() => update(st => { st.program!.swaps = st.program!.swaps.filter(x => !(x.when === 'fifo' && x.from === s.from)); })}><Icon name="trash" size={18} /></button>}
                </div>
              ))}
              {!p.swaps.some(s => s.when === when) && <div className="line muted small">None.</div>}
            </div>
          </div>
        ))}
        <h2>Add a FIFO swap</h2>
        <div className="card">
          <div className="muted small">For equipment the FIFO gym doesn't have. Both exercises must already be in your program; new exercises are added when a block is built.</div>
          <label className="field"><span className="field-label">Instead of</span>
            <select value={swap.from} onChange={e => setSwap({ ...swap, from: e.target.value })}>
              <option value="">Choose an exercise</option>
              {planned.map(id => <option key={id} value={id}>{name(id)}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Do this</span>
            <select value={swap.to} onChange={e => setSwap({ ...swap, to: e.target.value })}>
              <option value="">Choose an exercise</option>
              {all.filter(id => id !== swap.from).map(id => <option key={id} value={id}>{name(id)}</option>)}
            </select>
          </label>
          <button className="btn primary fit-h" disabled={!swap.from || !swap.to} onClick={() => {
            update(s => {
              s.program!.swaps = s.program!.swaps.filter(x => !(x.when === 'fifo' && x.from === swap.from));
              s.program!.swaps.push({ when: 'fifo', from: swap.from, to: swap.to, label: 'Not available at FIFO' });
            });
            setSwap({ from: '', to: '' });
          }}>Add swap</button>
        </div>
      </Sub>
    );
  }

  if (page === 'weight') {
    const list = [...state.weights].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <Sub title="Body weight" onBack={back}>
        <div className="card">
          <div className="grid2">
            <label className="field"><span className="field-label">Weight (kg)</span>
              <input inputMode="decimal" value={kg} placeholder={list[0] ? String(list[0].kg) : 'e.g. 82.5'} onChange={e => setKg(e.target.value)} />
            </label>
            <label className="field"><span className="field-label">Date</span>
              <input type="date" value={kgDate} max={today()} onChange={e => setKgDate(e.target.value)} />
            </label>
          </div>
          <button className="btn primary fit-h" disabled={!(Number(kg) > 20 && Number(kg) < 300)} onClick={() => {
            update(s => { s.weights = [...s.weights.filter(w => w.date !== kgDate), { date: kgDate, kg: Math.round(Number(kg) * 10) / 10 }]; });
            setKg('');
          }}>Save weight</button>
        </div>
        <h2>History</h2>
        <div className="card list">
          {list.slice(0, 20).map(w => (
            <div className="line" key={w.date}><span>{niceDate(w.date)}</span><span className="row"><b>{w.kg} kg</b>
              <button className="icon-btn" aria-label={`Remove ${w.date}`} onClick={() => update(s => { s.weights = s.weights.filter(x => x.date !== w.date); })}><Icon name="trash" size={18} /></button></span>
            </div>
          ))}
          {list.length === 0 && <div className="line muted small">Nothing entered yet.</div>}
        </div>
      </Sub>
    );
  }

  if (page === 'physio') {
    const list = [...state.physio].sort((a, b) => b.date.localeCompare(a.date));
    return (
      <Sub title="Physio findings" onBack={back}>
        <p className="lead small">Keep what your physio tells you here with the date it applies from. Notes don't change any rules by themselves; rule changes are made when a block is built.</p>
        <div className="card">
          <label className="field"><span className="field-label">Finding</span>
            <textarea rows={4} value={note} placeholder="What the physio found or advised" onChange={e => setNote(e.target.value)} />
          </label>
          <label className="field"><span className="field-label">Applies from</span>
            <input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} />
          </label>
          <button className="btn primary fit-h" disabled={!note.trim()} onClick={() => { update(s => { s.physio.push({ id: uid(), date: noteDate, text: note.trim() }); }); setNote(''); }}>Save finding</button>
        </div>
        {list.map(f => (
          <div className="card" key={f.id}>
            <div className="row"><div className="overline">From {niceDate(f.date)}</div>
              <button className="icon-btn" aria-label="Remove finding" onClick={() => update(s => { s.physio = s.physio.filter(x => x.id !== f.id); })}><Icon name="trash" size={18} /></button></div>
            <div>{f.text}</div>
          </div>
        ))}
      </Sub>
    );
  }

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
  const lastWeight = [...state.weights].sort((a, b) => b.date.localeCompare(a.date))[0];
  const practiceCount = state.sessions.filter(s => s.practice).length + state.runs.filter(r => r.practice).length;
  const machines = state.profiles.reduce((n, g) => n + Object.keys(g.machineSteps).length, 0);
  const Row = ({ to, title, detail }: { to: Page; title: string; detail: string }) => (
    <button className="line tapline" onClick={() => { setPage(to); window.scrollTo(0, 0); }}>
      <div className="grow"><div>{title}</div><div className="muted small">{detail}</div></div>
      <span className="muted"><Icon name="right" size={18} /></span>
    </button>
  );

  return (
    <main className="page home">
      <h1>Settings</h1>

      <h2>Training</h2>
      <div className="card list">
        <Row to="gyms" title="Gym equipment" detail={`Dumbbell steps, plates, kettlebells · ${machines} machine${machines === 1 ? '' : 's'} set`} />
        <Row to="rest" title="Rest times" detail={`${Object.keys(state.restOverrides).length} changed from the defaults`} />
        <Row to="swaps" title="Exercise swaps" detail={`${p.swaps.filter(s => s.when === 'fifo').length} automatic at the FIFO gym`} />
      </div>

      <h2>You</h2>
      <div className="card list">
        <Row to="weight" title="Body weight" detail={lastWeight ? `${lastWeight.kg} kg on ${niceDate(lastWeight.date)}` : 'Nothing entered yet'} />
        <Row to="physio" title="Physio findings" detail={state.physio.length ? `${state.physio.length} saved` : 'Nothing saved yet'} />
      </div>

      <h2>Program</h2>
      <div className="card">
        <div className="row"><span>Loaded</span><b>Block {p.block}</b></div>
        <div className="row"><span>Starts</span><b>{niceDate(p.start)}</b></div>
        <div className="row"><span>Running plan</span><b>{p.running ? 'Loaded' : 'Not loaded'}</b></div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => read(e.target.files?.[0])} />
        <button className="btn" onClick={() => file.current?.click()}>Load a program file</button>
        {message && <div className="notice">{message}</div>}
      </div>

      <h2>Garmin</h2>
      <div className="card">
        <div className="row"><span>Last successful sync</span><b>{state.garminStatus?.lastSync ? new Date(state.garminStatus.lastSync).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}</b></div>
        <div className="row"><span>Days of data</span><b>{Object.keys(state.garminDays).length}</b></div>
        <div className="row"><span>Runs and gym sessions</span><b>{state.garminActs.length}</b></div>
        {state.garminStatus && !state.garminStatus.ok && <div className="notice">The last attempt didn't work. The app keeps working; it will try again tomorrow morning.</div>}
        <div className="muted small">Syncs by itself at about 08:00 Adelaide time each day.</div>
      </div>

      <h2>Upload</h2>
      <div className="card">
        <div className="row"><span>Waiting to upload</span><b>{sync.pending === 0 ? 'Nothing. All uploaded' : `${sync.pending} item${sync.pending > 1 ? 's' : ''}`}</b></div>
        {waitingTooLong(sync) && <div className="notice">Some items have waited more than 24 hours.</div>}
        {sync.error && <div className="notice">Last attempt failed: {sync.error}</div>}
        <button className="btn" onClick={() => syncNow()}>Upload now</button>
      </div>

      <h2>Export</h2>
      <div className="card">
        <div className="muted small">One Excel file with a sheet for every table: sessions, sets, runs, check-ins, Garmin data, body weight, schedule and settings.</div>
        <button className="btn" onClick={() => setMessage2(`Saved ${exportAll(state, today())} to your downloads.`)}><Icon name="download" size={18} /> Export all to Excel</button>
        {message2 && <div className="muted small">{message2}</div>}
      </div>

      {practiceCount > 0 && (
        <>
          <h2>Practice data</h2>
          <div className="card">
            <div className="muted small">{practiceCount} practice session{practiceCount > 1 ? 's' : ''} from before Block {p.block}. They never counted towards anything.</div>
            <button className="btn danger" onClick={() => update(s => {
              const ids = new Set(s.sessions.filter(x => x.practice).map(x => x.id));
              s.sessions = s.sessions.filter(x => !ids.has(x.id));
              s.sets = s.sets.filter(x => !ids.has(x.sessionId));
              s.runs = s.runs.filter(x => !x.practice);
              if (s.activeSessionId && ids.has(s.activeSessionId)) s.activeSessionId = null;
              if (s.activeRunId && !s.runs.some(r => r.id === s.activeRunId)) s.activeRunId = null;
            })}>Delete practice data</button>
          </div>
        </>
      )}

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
