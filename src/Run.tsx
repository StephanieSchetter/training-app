// Run session flow (spec 5.3) and the speed rules that follow from it (section 7).
import { useState } from 'react';
import { adjustSpeed, mmss, SUB20_SPEED, timeTrialReset } from './engine/running';
import type { Slot } from './engine/schedule';
import { useWakeLock } from './Gym';
import { buildRun } from './runplan';
import { AppState, currentSpeeds, RunLog, RunType, today, uid, update, useStore } from './store';
import { AppBar, Dock, Elapsed, Icon, Sheet, Stepper } from './ui';

/** Practice: same screens using a given week's plan, with nothing counted. */
export function startPracticeRun(state: AppState, type: RunType, week: number) {
  startRun(state, { idx: -1, week, type, date: today(), order: 1 }, true);
}

export function startRun(state: AppState, slot: Slot, practice = false) {
  const type = slot.type as RunType;
  const plan = buildRun(state.program!, slot.week, type, currentSpeeds(state))!;
  const run: RunLog = {
    id: uid(), slotIdx: practice ? null : slot.idx, practice: practice || undefined, type, date: slot.date, week: slot.week,
    title: plan.title + (practice ? ' · Practice' : ''), timeTrial: plan.timeTrial || undefined,
    segs: plan.timeTrial ? [] : plan.sections.flatMap(sec => sec.lines.map(l => ({ section: sec.title, text: l.text, detail: l.detail, work: !!l.work, prescribed: l.speed, actual: l.speed, km: l.km, done: false }))),
    startedAt: Date.now(),
  };
  update(s => { s.runs.push(run); s.activeRunId = run.id; });
}

const patch = (id: string, fn: (r: RunLog, s: AppState) => void) => update(s => fn(s.runs.find(r => r.id === id)!, s));

function finish(id: string, answer?: RunLog['answer']) {
  patch(id, (r, s) => {
    r.finishedAt = Date.now();
    r.answer = answer;
    const slot = s.schedule.find(z => z.idx === r.slotIdx);
    if (slot) slot.done = true;
    s.activeRunId = null;
    if (!answer || r.type === 'easy' || r.practice) return;
    // Weekly rule (7.1): yes -> +0.3; couldn't finish twice running -> -0.3 and, for intervals, the pull-back alert.
    const kind = r.type as 'intervals' | 'threshold';
    const speeds = currentSpeeds(s);
    const answers = s.runs.filter(x => x.type === kind && x.finishedAt && x.answer && !x.practice).sort((a, b) => a.startedAt - b.startedAt).map(x => x.answer!);
    const next = adjustSpeed(speeds[kind], answers);
    r.speedBefore = speeds[kind];
    r.speedAfter = next.speed;
    s.speeds = { ...speeds, [kind]: next.speed };
    if (next.slippingAlert && kind === 'intervals') s.alerts.push({ id: uid(), kind: 'intervals-slipping', date: r.date, status: 'open' });
  });
}

function discard(id: string) {
  update(s => { s.runs = s.runs.filter(r => r.id !== id); s.activeRunId = null; });
}

export function RunSession({ runId }: { runId: string }) {
  const state = useStore();
  const run = state.runs.find(r => r.id === runId)!;
  const [leaving, setLeaving] = useState(false);
  const [asking, setAsking] = useState(false);
  useWakeLock();

  const plan = buildRun(state.program!, run.week, run.type, currentSpeeds(state))!;
  const closeBtn = <button className="icon-btn" aria-label="Leave run" onClick={() => (run.segs.some(s => s.done) ? setLeaving(true) : discard(run.id))}><Icon name="x" /></button>;
  const leaveSheet = leaving && (
    <Sheet title="Leave this run?" onClose={() => setLeaving(false)}>
      <p className="muted">What you've ticked off is saved. You can pick it up again from the home screen.</p>
      <button className="btn" onClick={() => update(s => { s.activeRunId = null; })}>Leave and resume later</button>
      <button className="btn danger" onClick={() => discard(run.id)}>Delete this run</button>
      <button className="btn ghost" onClick={() => setLeaving(false)}>Keep going</button>
    </Sheet>
  );

  if (run.timeTrial) return <TimeTrial state={state} run={run} closeBtn={closeBtn} />;

  const cur = run.segs.findIndex(s => !s.done);
  const seg = cur >= 0 ? run.segs[cur] : undefined;
  const workTotal = run.segs.filter(s => s.work).length;
  const workDone = run.segs.filter(s => s.work && s.done).length;
  const allDone = cur < 0;
  const end = () => (plan.asks ? setAsking(true) : finish(run.id));
  const kind = run.type as 'intervals' | 'threshold';
  const speedNow = plan.asks ? currentSpeeds(state)[kind] : 0;

  return (
    <div className="screen">
      <AppBar title={run.title} sub={<><Icon name="clock" size={13} /> <Elapsed since={run.startedAt} /> · Week {run.week}</>} left={closeBtn}
        right={<button className="link" onClick={end}>End</button>} />
      <div className="segs">{run.segs.map((s, i) => <span key={i} className={(s.done ? 'full ' : '') + (i === cur ? 'cur' : '')} />)}</div>

      <main className="page">
        {plan.over8 && cur === 0 && <div className="notice"><Icon name="info" size={16} /> This run comes to more than 8 km in total ({plan.km.toFixed(1)} km).</div>}

        {seg ? (
          <>
            <div className="card target-card">
              <div className="row"><div className="overline">Now · {seg.section}</div><div className="overline">{cur + 1} of {run.segs.length}</div></div>
              <div className="targ run-now">{seg.text}</div>
              {seg.detail && <div className="muted">{seg.detail}</div>}
            </div>
            {seg.work && seg.prescribed !== undefined && (
              <Stepper label="Speed you ran" unit="km/h" value={(seg.actual ?? seg.prescribed).toFixed(1)}
                onMinus={() => patch(run.id, r => { r.segs[cur].actual = Math.round(((r.segs[cur].actual ?? seg.prescribed!) - 0.1) * 10) / 10; })}
                onPlus={() => patch(run.id, r => { r.segs[cur].actual = Math.round(((r.segs[cur].actual ?? seg.prescribed!) + 0.1) * 10) / 10; })} />
            )}
            {plan.asks && <p className="lead small">Press lap on your watch for each rep.</p>}
          </>
        ) : (
          <div className="card done-card"><span className="ok big-ok"><Icon name="check" size={30} /></span><div><b>Every part done. Nice work.</b><div className="muted small">Tap a line below if you need to untick it.</div></div></div>
        )}

        {[...new Set(run.segs.map(s => s.section))].map(section => (
          <div className="stack" key={section}>
            <h2>{section}</h2>
            <div className="card list">
              {run.segs.map((s, i) => s.section !== section ? null : (
                <button key={i} className={'setrow planrow' + (i === cur ? ' cur' : '') + (s.done ? ' done' : '')} disabled={!s.done}
                  onClick={() => patch(run.id, r => { r.segs[i].done = false; })}>
                  <span className={'circle sm' + (s.done ? ' on' : '')}>{s.done && <Icon name="check" size={14} />}</span>
                  <span className="grow"><span className="plan-ex"><span>{s.text}</span>{s.detail && <span className="muted small">{s.detail}</span>}</span></span>
                  {s.work && s.done && s.actual !== undefined && s.actual !== s.prescribed && <span className="muted small nowrap">ran {s.actual.toFixed(1)}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </main>

      <Dock>
        {seg
          ? <button className="btn primary" onClick={() => { navigator.vibrate?.(25); patch(run.id, r => { r.segs[cur].done = true; }); window.scrollTo(0, 0); }}>Done</button>
          : <button className="btn primary" onClick={end}>{plan.asks ? 'One question, then finish' : 'Finish run'}</button>}
      </Dock>

      {asking && (
        <Sheet title="Could you have done 2 more reps at this speed?" onClose={() => setAsking(false)}>
          <p className="muted">
            {workDone < workTotal
              ? `You ticked ${workDone} of ${workTotal} reps.`
              : run.practice ? 'Practice only: your answer changes nothing.' : `This sets next week's speed. You ran at ${speedNow} km/h today.`}
          </p>
          {workDone === workTotal && (
            <>
              <button className="btn option" onClick={() => finish(run.id, 'yes')}><b>Yes</b><span className="small muted">Next week goes up to {(speedNow + 0.3).toFixed(1)} km/h</span></button>
              <button className="btn option" onClick={() => finish(run.id, 'no')}><b>No</b><span className="small muted">Next week stays at {speedNow} km/h</span></button>
            </>
          )}
          <button className="btn option" onClick={() => finish(run.id, 'dnf')}><b>Couldn't finish all reps</b><span className="small muted">Speed stays the same, unless it happens twice in a row</span></button>
          <button className="btn ghost" onClick={() => setAsking(false)}>Back to the run</button>
        </Sheet>
      )}
      {leaveSheet}
    </div>
  );
}

function TimeTrial({ state, run, closeBtn }: { state: AppState; run: RunLog; closeBtn: React.ReactNode }) {
  const [min, setMin] = useState(22);
  const [sec, setSec] = useState(30);
  const before = currentSpeeds(state);
  const total = min * 60 + sec;
  const res = timeTrialReset(total, { intervals: before.intervals, strides: before.strides });
  const diff = (a: number, b: number) => { const d = Math.round((a - b) * 10) / 10; return d === 0 ? 'no change' : `${d > 0 ? '+' : ''}${d.toFixed(1)}`; };
  const gap = total - 20 * 60;

  return (
    <div className="screen">
      <AppBar title="5 km Time Trial" sub={`Week ${run.week} · outdoors, flat`} left={closeBtn} />
      <main className="page">
        <p className="lead">Enter your 5 km time. The app works out your new speeds and you confirm them.</p>
        <Stepper label="Minutes" unit="min" value={min} onMinus={() => setMin(m => Math.max(12, m - 1))} onPlus={() => setMin(m => m + 1)} />
        <Stepper label="Seconds" unit="sec" value={String(sec).padStart(2, '0')} onMinus={() => setSec(s => (s + 59) % 60)} onPlus={() => setSec(s => (s + 1) % 60)} />

        <div className="stats">
          <div><div className="overline">Your time</div><b>{mmss(total)}</b></div>
          <div><div className="overline">Average</div><b>{res.ttSpeed.toFixed(2)} km/h</b></div>
          <div><div className="overline">Sub-20 ({SUB20_SPEED.toFixed(1)})</div><b>{gap <= 0 ? 'Done!' : `${mmss(gap)} to go`}</b></div>
        </div>

        <h2>New speeds</h2>
        <div className="card list">
          <div className="line"><span>Intervals</span><span><b>{res.intervals.toFixed(1)}</b> <span className="muted small">was {before.intervals} · {diff(res.intervals, before.intervals)}</span></span></div>
          <div className="line"><span>Threshold</span><span><b>{res.threshold.toFixed(1)}</b> <span className="muted small">was {before.threshold} · {diff(res.threshold, before.threshold)}</span></span></div>
          <div className="line"><span>Strides</span><span><b>{res.strides.toFixed(1)}</b> <span className="muted small">was {before.strides} · {diff(res.strides, before.strides)}</span></span></div>
        </div>
        <p className="lead small">Easy-run pace stays on the plan for now. Warm-up, recoveries and cool-down speeds never change.</p>
      </main>
      <Dock>
        <button className="btn primary" onClick={() => patch(run.id, (r, s) => {
          r.timeTrialSec = total;
          r.finishedAt = Date.now();
          s.activeRunId = null;
          if (r.practice) return;
          r.speedBefore = before.intervals;
          r.speedAfter = res.intervals;
          s.speeds = { intervals: res.intervals, threshold: res.threshold, strides: res.strides };
          const slot = s.schedule.find(z => z.idx === r.slotIdx);
          if (slot) slot.done = true;
          s.activeRunId = null;
        })}>{run.practice ? 'Finish practice (nothing changes)' : 'Confirm new speeds'}</button>
      </Dock>
    </div>
  );
}
