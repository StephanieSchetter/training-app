// Progress (spec 5.6 and section 11): recovery, body weight, running and every lift.
import { useState } from 'react';
import { LineChart } from './Chart';
import { addDays } from './engine/schedule';
import { mmss } from './engine/running';
import { easyHrSeries, heldSince, liftChart, liftList, RecoveryKey, recoverySeries, speedSeries, timeTrialSeries, weightSeries } from './stats';
import { AppState, today } from './store';
import { Icon, Segmented } from './ui';

const RANGES = [{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }];
const RECOVERY: { key: RecoveryKey; title: string; unit: string; hint: string }[] = [
  { key: 'readiness', title: 'Training Readiness', unit: '', hint: 'Garmin score each morning, out of 100' },
  { key: 'restingHr', title: 'Resting heart rate', unit: ' bpm', hint: 'Lower is generally better' },
  { key: 'hrv', title: 'HRV, 7-day average', unit: ' ms', hint: 'Overnight heart-rate variability, smoothed over a week' },
  { key: 'sleepHours', title: 'Sleep', unit: ' h', hint: 'Hours asleep each night' },
  { key: 'sleepScore', title: 'Sleep score', unit: '', hint: 'Garmin score, out of 100' },
];

function Panel({ title, hint, value, children }: { title: string; hint?: string; value?: string; children: React.ReactNode }) {
  return (
    <section className="card chart-card">
      <div className="row"><div><b>{title}</b>{hint && <div className="muted small">{hint}</div>}</div>{value && <div className="chart-value">{value}</div>}</div>
      {children}
    </section>
  );
}

function Lift({ state, exId, name }: { state: AppState; exId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const c = liftChart(state, exId);
  const pts = c.series.flatMap(s => s.points);
  const last = c.series[0]?.points.at(-1);
  const fmt = c.kind === 'max' ? (v: number) => `${v} kg` : c.kind === 'percent' ? (v: number) => `${v > 0 ? '+' : ''}${v}%` : c.kind === 'level' ? (v: number) => c.levels[v - 1] ?? String(v) : (v: number) => String(v);
  const held = heldSince(state, exId);
  const kind = c.kind === 'max' ? 'Estimated max' : c.kind === 'percent' ? 'Change since first session at each gym' : c.kind === 'level' ? 'Level reached' : 'Total reps per session';
  return (
    <div className="lift">
      <button className="line tapline" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <div className="grow"><div>{name}</div><div className="muted small">{pts.length ? `${kind} · ${pts.length} session${pts.length === 1 ? '' : 's'}` : 'Not logged yet'}</div>{held && <div className="small warn-text">Weight held: knee or back was worse on {new Date(held + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>}</div>
        <span className="muted nowrap">{last ? fmt(last.y) : ''}</span>
        <span className="muted"><Icon name={open ? 'minus' : 'plus'} size={18} /></span>
      </button>
      {open && (
        <div className="lift-body">
          <LineChart series={c.series} stints={state.stints} format={fmt} stepped={c.kind === 'level'} />
          {c.kind === 'reps' && c.added && (
            <>
              <div className="muted small">Added weight, once weighted</div>
              <LineChart series={c.added} stints={state.stints} format={v => `${v} kg`} />
            </>
          )}
          {c.kind === 'max' && <div className="muted small">From the top set each session: weight × (1 + reps ÷ 30). Ramp-ups and deload weeks are left out.</div>}
          {c.kind === 'percent' && <div className="muted small">The machines differ between gyms, so each gym is measured against its own first session.</div>}
        </div>
      )}
    </div>
  );
}

export function Progress({ state }: { state: AppState }) {
  const [range, setRange] = useState(90);
  const t = today();
  const from = addDays(t, -range);
  const kmh = (v: number) => `${v}`;
  const lifts = liftList(state);
  const tt = timeTrialSeries(state);
  const weight = weightSeries(state);

  return (
    <main className="page home progress">
      <h1>Progress</h1>
      <p className="lead small">Trends, not targets. Shaded bands are FIFO stints. Touch a chart to read a value.</p>

      <h2>Recovery</h2>
      <Segmented options={RANGES} value={range} onChange={v => v && setRange(v)} />
      <div className="chart-grid">
        {RECOVERY.map(r => {
          const s = recoverySeries(state, r.key, from);
          const last = s[0].points.at(-1);
          return (
            <Panel key={r.key} title={r.title} hint={r.hint} value={last ? `${r.key === 'sleepHours' ? last.y.toFixed(1) : Math.round(last.y)}${r.unit}` : undefined}>
              <LineChart series={s} stints={state.stints} height={150} format={v => (r.key === 'sleepHours' ? v.toFixed(1) : String(Math.round(v)))} />
            </Panel>
          );
        })}
        <Panel title="Body weight" hint="Weekly average" value={weight[0].points.at(-1) ? `${weight[0].points.at(-1)!.y} kg` : undefined}>
          <LineChart series={weight} stints={state.stints} height={150} format={v => `${v}`} />
        </Panel>
      </div>

      <h2>Running</h2>
      <div className="chart-grid">
        <Panel title="Intervals" hint="Speed in km/h, prescribed and achieved"><LineChart series={speedSeries(state, 'intervals')} stints={state.stints} format={kmh} /></Panel>
        <Panel title="Threshold" hint="Speed in km/h, prescribed and achieved"><LineChart series={speedSeries(state, 'threshold')} stints={state.stints} format={kmh} /></Panel>
        <Panel title="Easy runs" hint="Average heart rate at the speed run. A new line starts when the speed changes. Falling means fitter."><LineChart series={easyHrSeries(state)} stints={state.stints} format={v => `${v}`} /></Panel>
        <Panel title="5 km time trials" hint="Time per trial against the 20:00 mark" value={tt[0].points.at(-1) ? mmss(tt[0].points.at(-1)!.y) : undefined}>
          <LineChart series={tt} stints={state.stints} format={v => mmss(Math.round(v))} reference={{ value: 1200, label: '20:00' }} />
        </Panel>
      </div>

      <h2>Strength</h2>
      <p className="lead small">Tap a lift to open its chart.</p>
      <div className="chart-grid">
        {lifts.map(g => (
          <div className="stack" key={g.session}>
            <div className="overline">{g.session}</div>
            <div className="card list">{g.items.map(i => <Lift key={i.exId} state={state} exId={i.exId} name={i.name} />)}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
