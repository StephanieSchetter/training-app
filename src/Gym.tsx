// Gym session flow (spec 5.2): start -> warm-up -> one exercise per screen -> finish.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { gridStep, roundNearest } from './engine/weights';
import { NORDIC_LEVELS } from './engine/progression';
import { blocks, buildPlan, lastSet, PlanItem, Step, stepsFor } from './plan';
import { AppState, SessionLog, SetLog, uid, update, useStore, write } from './store';
import { AppBar, clock, Dock, Elapsed, Icon, Segmented, Sheet, Stepper } from './ui';

type Phase = 'start' | 'warmup' | 'lifts' | 'finish';
const RIRS = ['0', '1', '2', '3', '4+'];
const fmtKg = (w: number | null) => (w === null ? '—' : `${w} kg`);
const sideName = (s?: 'L' | 'R') => (s === 'L' ? 'Left' : s === 'R' ? 'Right' : '');
const setText = (s: SetLog) => `${s.weight != null ? `${s.weight} kg × ` : ''}${s.reps}${s.rir != null ? ` · RIR ${RIRS[s.rir]}` : ''}`;
export const schemeText = (p: PlanItem) => (p.scheme.t === 'rpt' ? `${p.targets.length} sets · ${p.repsLabel.join(' / ')}` : `${p.targets.length} × ${p.repsLabel[0] ?? ''}`) + (p.info.eachSide ? ' each side' : '');

function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const ask = () => navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {});
    const onVis = () => { if (document.visibilityState === 'visible') ask(); };
    ask();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release().catch(() => {}); };
  }, []);
}

function buzz() {
  // Vibration only: Brad asked for no sound in the gym.
  navigator.vibrate?.([400, 150, 400, 150, 400]);
}

interface Timer { end: number; total: number }

function RestTimer({ timer, onAdd, onClose }: { timer: Timer; onAdd: () => void; onClose: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => { fired.current = false; }, [timer.end]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((timer.end - now) / 1000));
  useEffect(() => {
    if (left === 0 && !fired.current) { fired.current = true; buzz(); }
  }, [left]);
  const pct = Math.max(0, Math.min(100, ((timer.end - now) / (timer.total * 1000)) * 100));
  return (
    <div className={'timer' + (left === 0 ? ' over' : '')} role="timer">
      <div className="timer-bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="timer-row">
        <div>
          <div className="overline">{left === 0 ? 'Rest over' : 'Rest'}</div>
          <div className="timer-num">{left === 0 ? 'Go' : clock(left)}</div>
        </div>
        <div className="timer-btns">
          {left > 0 && <button onClick={onAdd}>+30 sec</button>}
          <button onClick={onClose}>{left === 0 ? 'Close' : 'Skip'}</button>
        </div>
      </div>
    </div>
  );
}

function discard(sessionId: string) {
  update(s => {
    s.sessions = s.sessions.filter(x => x.id !== sessionId);
    s.sets = s.sets.filter(x => x.sessionId !== sessionId);
    s.activeSessionId = null;
  });
}

export function GymSession({ sessionId }: { sessionId: string }) {
  const state = useStore();
  const session = state.sessions.find(s => s.id === sessionId)!;
  const sets = state.sets.filter(s => s.sessionId === sessionId);
  const [phase, setPhase] = useState<Phase>(sets.length ? 'lifts' : 'start');
  const [leaving, setLeaving] = useState(false);
  useWakeLock();

  const plan = useMemo(() => buildPlan(state, session), [state, session]);
  const program = state.program!;
  const gym = state.profiles.find(p => p.id === session.gymId)!;
  const name = program.sessions[session.type].name + (session.practice ? ' · practice' : '');
  const sub = <>Week {session.week} · {gym.name}</>;
  const closeBtn = <button className="icon-btn" aria-label="Leave session" onClick={() => (sets.length || session.warmup.length ? setLeaving(true) : discard(session.id))}><Icon name="x" /></button>;

  const leaveSheet = leaving && (
    <Sheet title="Leave this session?" onClose={() => setLeaving(false)}>
      <p className="muted">Everything you've logged is saved. You can pick it up again from the home screen.</p>
      <button className="btn" onClick={() => update(s => { s.activeSessionId = null; })}>Leave and resume later</button>
      <button className="btn danger" onClick={() => discard(session.id)}>Delete this session</button>
      <button className="btn ghost" onClick={() => setLeaving(false)}>Keep going</button>
    </Sheet>
  );

  if (phase === 'start') {
    const swapped = plan.filter(p => p.swapLabel);
    return (
      <div className="screen">
        <AppBar title={name} sub={sub} left={closeBtn} />
        <main className="page">
          <div className="stats">
            <div><div className="overline">Week</div><b>{session.week} of {program.weeks}</b></div>
            <div><div className="overline">RIR target</div><b>{program.rirByWeek[session.week]}</b></div>
            <div><div className="overline">Gym</div><b>{gym.name}</b></div>
          </div>
          <p className="lead">{program.weekNotes[session.week]}{program.sessions[session.type].note ? ` ${program.sessions[session.type].note}` : ''}</p>

          <h2>Readiness</h2>
          <div className="card muted">No Garmin data yet. Suggestions will appear here once Garmin is connected.</div>

          {swapped.length > 0 && (
            <>
              <h2>Swaps at this gym</h2>
              <div className="card list">
                {swapped.map(p => (
                  <div className="line" key={p.ex}>
                    <div><div className="strike muted small">{program.exercises[p.plannedEx].name}</div><div>{p.info.name}</div></div>
                    <Icon name="swap" />
                  </div>
                ))}
              </div>
            </>
          )}

          <h2>Today's exercises</h2>
          <div className="card list">
            {plan.map(p => (
              <div className="line" key={p.ex}>
                <div>
                  <div>{p.pair ? <span className="tag">{p.pair}{blocks(plan).find(b => b.includes(p))!.indexOf(p) + 1}</span> : null}{p.info.name}</div>
                  <div className="muted small">{schemeText(p)}</div>
                </div>
                <div className="muted nowrap">{p.usesWeight ? (p.targets[0]?.weight != null ? fmtKg(p.targets[0].weight) : 'Find load') : 'Bodyweight'}</div>
              </div>
            ))}
          </div>
        </main>
        <Dock><button className="btn primary" onClick={() => setPhase('warmup')}>Start warm-up</button></Dock>
        {leaveSheet}
      </div>
    );
  }

  if (phase === 'warmup') {
    const n = session.warmup.length;
    return (
      <div className="screen">
        <AppBar title="Warm-up" sub={`${n} of ${program.warmup.length} done · about 6 min`} left={closeBtn}
          right={<button className="link" onClick={() => setPhase('lifts')}>Skip</button>} />
        <div className="segs">{program.warmup.map((_, i) => <span key={i} className={session.warmup.includes(i) ? 'full' : ''} />)}</div>
        <main className="page">
          {program.warmup.map((d, i) => {
            const on = session.warmup.includes(i);
            return (
              <button key={i} className={'check' + (on ? ' on' : '')} aria-pressed={on} onClick={() => write('sessions', session.id, s => {
                const x = s.sessions.find(z => z.id === session.id)!;
                x.warmup = on ? x.warmup.filter(k => k !== i) : [...x.warmup, i];
              })}>
                <span className="circle">{on && <Icon name="check" size={18} />}</span>
                <span className="check-body">
                  <span className="check-top"><b>{d.name}</b><span className="dose">{d.dose}</span></span>
                  <span className="small muted">{d.how}</span>
                </span>
              </button>
            );
          })}
          <p className="lead">Then 1–2 lighter ramp-up sets of the first lift before the top set.</p>
        </main>
        <Dock><button className="btn primary" onClick={() => setPhase('lifts')}>Start lifting</button></Dock>
        {leaveSheet}
      </div>
    );
  }

  if (phase === 'finish') {
    const work = sets.filter(s => !s.rampUp && !s.extra);
    const mins = Math.round((Date.now() - session.startedAt) / 60000);
    const doneEx = plan.filter(p => work.some(s => s.exId === p.ex)).length;
    return (
      <div className="screen">
        <AppBar title="Session summary" sub={name} left={<button className="icon-btn" aria-label="Back to exercises" onClick={() => setPhase('lifts')}><Icon name="left" /></button>} />
        <main className="page">
          <div className="stats">
            <div><div className="overline">Time</div><b>{mins} min</b></div>
            <div><div className="overline">Exercises</div><b>{doneEx} of {plan.length}</b></div>
            <div><div className="overline">Sets</div><b>{work.length}</b></div>
          </div>
          {session.badDay && <div className="card warn-card"><Icon name="flag" /> Flagged as a bad day. Misses today won't count.</div>}
          <h2>What you did</h2>
          <div className="card list">
            {plan.map(p => {
              const done = work.filter(s => s.exId === p.ex).sort((a, b) => a.setNo - b.setNo || (a.side ?? '').localeCompare(b.side ?? ''));
              return (
                <div className="line top" key={p.ex}>
                  <div>
                    <div>{p.info.name}</div>
                    <div className="muted small">{done.length ? done.map(s => `${s.weight != null ? s.weight + '×' : ''}${s.reps}`).join('  ·  ') : 'Not done'}</div>
                  </div>
                  {done.length > 0 && <span className="ok"><Icon name="check" size={18} /></span>}
                </div>
              );
            })}
          </div>
          {session.notes && <><h2>Note</h2><div className="card">{session.notes}</div></>}
          <h2>Garmin</h2>
          <div className="card muted">Will match to your watch activity when synced.</div>
        </main>
        <Dock>
          <button className="btn primary" onClick={() => write('sessions', session.id, s => {
            const x = s.sessions.find(z => z.id === session.id)!;
            x.finishedAt = Date.now();
            const slot = s.schedule.find(z => z.idx === x.slotIdx);
            if (slot) slot.done = true;
            s.activeSessionId = null;
          })}>Finish session</button>
        </Dock>
      </div>
    );
  }

  return (
    <>
      <Lifts state={state} session={session} sets={sets} plan={plan} title={name} closeBtn={closeBtn} onFinish={() => setPhase('finish')} />
      {leaveSheet}
    </>
  );
}

type Panel = 'swap' | 'note' | 'pullups' | 'rest' | 'info' | null;

function Lifts({ state, session, sets, plan, title, closeBtn, onFinish }: {
  state: AppState; session: SessionLog; sets: SetLog[]; plan: PlanItem[]; title: string; closeBtn: ReactNode; onFinish: () => void;
}) {
  const bl = useMemo(() => blocks(plan), [plan]);
  const firstOpen = bl.findIndex(b => stepsFor(b, sets).some(s => !s.done));
  const [bi, setBi] = useState(firstOpen < 0 ? bl.length - 1 : firstOpen);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState(session.notes ?? '');
  const touch = useRef<{ x: number; y: number } | null>(null);

  const block = bl[Math.min(bi, bl.length - 1)];
  const steps = stepsFor(block, sets);
  const editing = editId ? steps.find(s => s.done?.id === editId) : undefined;
  const current: Step | undefined = editing ?? steps.find(s => !s.done);
  const item = current?.item ?? block[0];
  const gym = state.profiles.find(p => p.id === session.gymId)!;
  const program = state.program!;
  const last = bi === bl.length - 1;
  const go = (d: number) => { setEditId(null); setPanel(null); setBi(i => Math.max(0, Math.min(bl.length - 1, i + d))); window.scrollTo(0, 0); };
  const patchSession = (fn: (x: SessionLog) => void) => write('sessions', session.id, s => fn(s.sessions.find(z => z.id === session.id)!));
  const blockDone = (b: PlanItem[]) => stepsFor(b, sets).every(s => s.done);
  const extras = sets.filter(s => s.extra).length;
  const swaps = program.swaps.filter(sw => sw.from === item.plannedEx);

  const timerNode = timer && (
    <RestTimer timer={timer}
      onAdd={() => setTimer(t => (t ? { end: Math.max(t.end, Date.now()) + 30000, total: t.total + 30 } : t))}
      onClose={() => setTimer(null)} />
  );

  return (
    <div
      className="screen"
      onTouchStart={e => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={e => {
        if (!touch.current || panel) return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        touch.current = null;
        if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 2) go(dx < 0 ? 1 : -1);
      }}
    >
      <AppBar title={title} sub={<><Icon name="clock" size={13} /> <Elapsed since={session.startedAt} />{session.badDay ? ' · bad day' : ''}</>}
        left={closeBtn} right={<button className="link" onClick={onFinish}>Finish</button>} />
      <div className="segs tap">
        {bl.map((b, i) => <button key={i} aria-label={`Exercise ${i + 1}`} className={(blockDone(b) ? 'full ' : '') + (i === bi ? 'cur' : '')} onClick={() => go(i - bi)} />)}
      </div>

      <main className="page">
        <div className="ex-head">
          <button className="icon-btn" aria-label="Previous exercise" disabled={bi === 0} onClick={() => go(-1)}><Icon name="left" /></button>
          <div className="ex-title">
            <div className="overline">Exercise {bi + 1} of {bl.length}{block.length > 1 ? ' · pair, alternate sets' : ''}</div>
            <h1>{block.length > 1 && current ? <span className="tag">{item.pair}{block.indexOf(item) + 1}</span> : null}{item.title}</h1>
          </div>
          <button className="icon-btn" aria-label="Next exercise" disabled={last} onClick={() => go(1)}><Icon name="right" /></button>
        </div>
        {item.swapLabel && <div className="notice"><Icon name="swap" size={16} /> {item.swapLabel}</div>}

        {item.setup
          ? <SetupCard item={item} gymId={gym.id} gymName={gym.name} dock={timerNode} />
          : current
            ? <SetEditor key={(current.done?.id ?? '') + item.ex + current.round + (current.side ?? '')} state={state} session={session} sets={sets}
                step={current} block={block} gymId={gym.id} timer={timerNode}
                onCancelEdit={() => setEditId(null)}
                onLogged={rest => { setEditId(null); if (rest) setTimer({ end: Date.now() + rest * 1000, total: rest }); }} />
            : (
              <>
                <div className="card done-card"><span className="ok big-ok"><Icon name="check" size={30} /></span><div><b>All sets done. Nice work.</b><div className="muted small">Tap a set below if you need to change it.</div></div></div>
                <Dock>{timerNode}<button className="btn primary" onClick={() => (last ? onFinish() : go(1))}>{last ? 'Review and finish' : 'Next exercise'}</button></Dock>
              </>
            )}

        <h2>Sets</h2>
        <div className="card list">
          {sets.filter(s => s.rampUp && block.some(b => b.ex === s.exId)).map(s => (
            <button className="setrow done" key={s.id} onClick={() => update(st => { st.sets = st.sets.filter(x => x.id !== s.id); })}>
              <span className="circle sm" /><span className="grow">Ramp-up</span><span className="muted">{s.weight} kg × {s.reps}</span><span className="muted"><Icon name="trash" size={16} /></span>
            </button>
          ))}
          {steps.map((s, i) => (
            <button key={i} className={'setrow' + (s === current ? ' cur' : '') + (s.done ? ' done' : '')} disabled={!s.done} onClick={() => { setEditId(s.done!.id); window.scrollTo(0, 0); }}>
              <span className={'circle sm' + (s.done ? ' on' : '')}>{s.done && <Icon name="check" size={14} />}</span>
              <span className="grow">{block.length > 1 ? `${s.item.pair}${block.indexOf(s.item) + 1} · ` : ''}Set {s.round + 1}{s.side ? ` · ${sideName(s.side)}` : ''}</span>
              <span>{s.done ? setText(s.done) : `${s.item.usesWeight ? fmtKg(s.item.targets[s.round].weight) + ' × ' : ''}${s.item.repsLabel[s.round]}`}</span>
            </button>
          ))}
        </div>

        <div className="actions">
          <button onClick={() => setPanel('swap')}><Icon name="swap" /><span>Swap</span></button>
          <button className={session.badDay ? 'on' : ''} aria-pressed={!!session.badDay} onClick={() => patchSession(x => { x.badDay = !x.badDay; })}><Icon name="flag" /><span>{session.badDay ? 'Bad day ✓' : 'Bad day'}</span></button>
          <button className={session.notes ? 'on' : ''} onClick={() => { setNote(session.notes ?? ''); setPanel('note'); }}><Icon name="note" /><span>Note</span></button>
          <button onClick={() => setPanel('rest')}><Icon name="clock" /><span>Rest {clock(item.rest)}</span></button>
        </div>
        {item.info.note && <button className="btn ghost" onClick={() => setPanel('info')}><Icon name="info" size={18} /> How to do it</button>}

        <h2>Today's full plan</h2>
        <div className="card list">
          {bl.map((b, i) => {
            const st = stepsFor(b, sets);
            const n = st.filter(s => s.done).length;
            return (
              <button key={i} className={'setrow planrow' + (i === bi ? ' cur' : '') + (n === st.length ? ' done' : '')} onClick={() => go(i - bi)}>
                <span className={'circle sm' + (n === st.length ? ' on' : '')}>{n === st.length ? <Icon name="check" size={14} /> : null}</span>
                <span className="grow">
                  {b.map(p => (
                    <span className="plan-ex" key={p.ex}>
                      <span>{b.length > 1 ? <span className="tag">{p.pair}{b.indexOf(p) + 1}</span> : null}{p.info.name}</span>
                      <span className="muted small">{schemeText(p)}{p.usesWeight && p.targets[0]?.weight != null ? ` · ${fmtKg(p.targets[0].weight)}` : ''}</span>
                    </span>
                  ))}
                </span>
                <span className="muted small nowrap">{n === st.length ? 'Done' : n ? `${n} of ${st.length}` : i === bi ? 'Now' : ''}</span>
              </button>
            );
          })}
        </div>
        <button className="btn ghost" onClick={() => setPanel('pullups')}>Extra pull-ups{extras ? ` · ${extras} logged` : ''}</button>
      </main>

      {panel === 'swap' && (
        <Sheet title={`Swap ${program.exercises[item.plannedEx].name}`} onClose={() => setPanel(null)}>
          <p className="muted">For this session only.</p>
          {swaps.map(sw => (
            <button className="btn option" key={sw.to + sw.when} onClick={() => { patchSession(x => { x.swaps[item.plannedEx] = sw.to; }); setPanel(null); }}>
              <b>{program.exercises[sw.to].name}</b><span className="small muted">{sw.label}</span>
            </button>
          ))}
          {session.swaps[item.plannedEx] && <button className="btn" onClick={() => { patchSession(x => { delete x.swaps[item.plannedEx]; }); setPanel(null); }}>Back to {program.exercises[item.plannedEx].name}</button>}
          {!swaps.length && <p className="muted">No swaps are set up for this exercise yet.</p>}
          <button className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
        </Sheet>
      )}
      {panel === 'note' && (
        <Sheet title="Session note" onClose={() => setPanel(null)}>
          <textarea rows={4} autoFocus placeholder="Anything worth remembering about today" value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn primary" onClick={() => { patchSession(x => { x.notes = note.trim() || undefined; }); setPanel(null); }}>Save note</button>
        </Sheet>
      )}
      {panel === 'pullups' && (
        <Sheet title="Extra pull-ups" onClose={() => setPanel(null)}>
          <p className="muted">Easy practice sets, never to failure. They don't affect progression.</p>
          <div className="grid2">
            {[2, 3].map(reps => (
              <button className="btn" key={reps} onClick={() => {
                const id = uid();
                write('sets', id, s => { s.sets.push({ id, sessionId: session.id, exId: 'pull_up', plannedExId: 'pull_up', setNo: extras + 1, weight: null, reps, rir: null, extra: true, suggestedWeight: null, suggestedReps: null, ts: Date.now() }); });
                setPanel(null);
              }}>Log {reps} reps</button>
            ))}
          </div>
        </Sheet>
      )}
      {panel === 'rest' && (
        <Sheet title={`Rest time · ${item.info.name}`} onClose={() => setPanel(null)}>
          <Stepper label="Rest between sets" unit="min:sec" value={clock(item.rest)}
            onMinus={() => update(s => { s.restOverrides[item.ex] = Math.max(15, item.rest - 15); })}
            onPlus={() => update(s => { s.restOverrides[item.ex] = item.rest + 15; })} />
          <button className="btn primary" onClick={() => setPanel(null)}>Done</button>
        </Sheet>
      )}
      {panel === 'info' && (
        <Sheet title={item.info.name} onClose={() => setPanel(null)}>
          <p>{item.info.note}</p>
          <button className="btn ghost" onClick={() => setPanel(null)}>Close</button>
        </Sheet>
      )}
    </div>
  );
}

function SetupCard({ item, gymId, gymName, dock }: { item: PlanItem; gymId: string; gymName: string; dock: ReactNode }) {
  const [v, setV] = useState('');
  const q = item.setup === 'machine'
    ? (item.info.plateLoaded ? 'What is the smallest weight jump you can make on this machine?' : 'What is the weight step on this machine?')
    : item.setup === 'plate' ? 'What is the smallest barbell plate here?' : 'Which kettlebell sizes are here?';
  const hint = item.setup === 'machine' && item.info.plateLoaded ? 'In kg, in total. For example 2.5 if the smallest plates are 1.25 kg and you add one each side.' : item.setup === 'machine' ? 'In kg. The gap between one pin position and the next.' : item.setup === 'plate' ? 'In kg, for a single plate.' : 'In kg, separated by commas. For example: 8, 12, 16, 20';
  const quick = item.setup === 'machine' ? ['2.5', '5', '7', '10'] : item.setup === 'plate' ? ['0.5', '1', '1.25', '2.5'] : [];
  const save = (raw: string) => {
    const nums = raw.split(/[ ,]+/).map(Number).filter(n => n > 0);
    if (!nums.length) return;
    update(s => {
      const g = s.profiles.find(p => p.id === gymId)!;
      if (item.setup === 'machine') g.machineSteps[item.ex] = nums[0];
      else if (item.setup === 'plate') g.smallestPlate = nums[0];
      else g.kettlebells = nums.sort((a, b) => a - b);
    });
  };
  return (
    <>
      <div className="card">
        <div className="overline">One quick question · {gymName} gym</div>
        <div className="q">{q}</div>
        <div className="muted small">{hint}</div>
        {quick.length > 0 && <div className="grid4">{quick.map(x => <button className="btn" key={x} onClick={() => save(x)}>{x}</button>)}</div>}
        <input inputMode={item.setup === 'kettlebell' ? 'text' : 'decimal'} value={v} onChange={e => setV(e.target.value)} placeholder={item.setup === 'kettlebell' ? '8, 12, 16, 20' : 'Another number'} />
        <div className="muted small">Asked once per gym. You can change it later in Settings.</div>
      </div>
      <Dock>{dock}<button className="btn primary" disabled={!v.trim()} onClick={() => save(v)}>Save and continue</button></Dock>
    </>
  );
}

function SetEditor({ state, session, sets, step, block, gymId, timer, onLogged, onCancelEdit }: {
  state: AppState; session: SessionLog; sets: SetLog[]; step: Step; block: PlanItem[]; gymId: string; timer: ReactNode;
  onLogged: (restSeconds: number | null) => void; onCancelEdit: () => void;
}) {
  const { item, round, side, done } = step;
  const target = item.targets[round];
  const gym = state.profiles.find(p => p.id === gymId)!;
  const prevThisSession = sets.filter(s => s.exId === item.ex && !s.extra).at(-1);
  const last = lastSet(state, item.ex, round + 1, side, session, item.equip === 'machine');
  const findLoad = item.usesWeight && target.weight === null;

  // With no suggestion yet (week 1), later sets follow what was just lifted; RPT back sets drop 10% each.
  const topToday = sets.find(s => s.exId === item.ex && s.setNo === 1 && !s.rampUp && !s.extra)?.weight ?? null;
  const carried = item.scheme.t === 'rpt' && topToday !== null
    ? roundNearest(topToday * Math.pow(0.9, round), item.equip, gym, item.ex)
    : prevThisSession?.weight ?? null;
  const [weight, setWeight] = useState<number | null>(done ? done.weight : target.weight ?? carried);
  const [reps, setReps] = useState(done ? done.reps : target.reps);
  const [rir, setRir] = useState<number | null>(done ? done.rir : null);
  const [controlled, setControlled] = useState(done ? !!done.controlled : false);
  const [assist, setAssist] = useState<string>(done?.assist ?? item.assist ?? 'band');

  const bump = (dir: number) => {
    if (item.equip === 'kettlebell' && gym.kettlebells.length) {
      const bells = gym.kettlebells;
      if (weight === null) return setWeight(bells[0]);
      const i = bells.findIndex(b => b >= weight);
      const at = i < 0 ? bells.length - 1 : i;
      return setWeight(bells[Math.max(0, Math.min(bells.length - 1, bells[at] === weight ? at + dir : dir > 0 ? at : at - 1))]);
    }
    const s = gridStep(item.equip, gym, item.ex) ?? 2.5;
    setWeight(w => Math.max(0, Math.round(((w ?? 0) + dir * s) * 100) / 100));
  };

  const save = (rampUp: boolean) => {
    if (item.usesWeight && weight === null) return;
    navigator.vibrate?.(25);
    const id = rampUp ? uid() : done?.id ?? uid();
    const row: SetLog = {
      id, sessionId: session.id, exId: item.ex, plannedExId: item.plannedEx,
      setNo: rampUp ? 0 : round + 1, side: rampUp ? undefined : side,
      weight: item.usesWeight ? weight : null, reps, rir: rampUp ? null : rir,
      rampUp: rampUp || undefined,
      controlled: item.scheme.t === 'legraise' ? controlled : undefined,
      assist: item.scheme.t === 'nordic' ? assist : undefined,
      level: item.level,
      suggestedWeight: target.weight, suggestedReps: target.reps, ts: done?.ts ?? Date.now(),
    };
    write('sets', id, s => {
      const i = s.sets.findIndex(x => x.id === id);
      if (i >= 0) s.sets[i] = row; else s.sets.push(row);
    });
    if (rampUp || done) return onLogged(null);
    // Rest starts once the round is finished: after A2 in a pair, after the right side on each-leg lifts.
    const next = stepsFor(block, [...sets, row]).find(s => !s.done);
    onLogged(!next || next.round !== round ? item.rest : null);
  };

  const remove = () => {
    update(s => { s.sets = s.sets.filter(x => x.id !== done!.id); });
    onCancelEdit();
  };

  const canRamp = !done && round === 0 && side !== 'R' && item.usesWeight && !sets.some(s => s.exId === item.ex && !s.rampUp && !s.extra);
  const unit = item.scheme.t === 'fixed' && item.scheme.unit ? item.scheme.unit : 'reps';

  return (
    <>
      <div className={'card target-card' + (done ? ' editing' : '')}>
        <div className="row">
          <div className="overline">{done ? 'Editing · ' : ''}Set {round + 1} of {item.targets.length}{side ? ` · ${sideName(side)} side` : ''}</div>
          <div className="overline">RIR target {state.program!.rirByWeek[session.week]}</div>
        </div>
        <div className="targ">
          {item.usesWeight ? (findLoad ? 'Find your load' : fmtKg(target.weight)) : 'Bodyweight'}
          <span className="times"> × {item.repsLabel[round]}</span>
        </div>
        <div className="row meta">
          <span><span className="muted">Last time </span>{last ? setText(last) : '—'}</span>
          {item.reason && !findLoad && <span className="muted right">{item.reason}</span>}
        </div>
        {item.before && round === 0 && !done && <div className="notice inline"><Icon name="info" size={16} /> {item.before}</div>}
      </div>

      {item.usesWeight && (
        <Stepper label="Weight" unit={item.equip === 'added' ? 'kg added' : item.equip === 'dumbbell' ? 'kg each' : 'kg'} value={weight} onMinus={() => bump(-1)} onPlus={() => bump(1)} onType={setWeight} />
      )}
      <Stepper label={unit === 'reps' ? 'Reps' : 'Distance'} unit={unit} value={reps} onMinus={() => setReps(r => Math.max(0, r - 1))} onPlus={() => setReps(r => r + 1)} />

      <div className="field">
        <div className="field-label">Reps left in the tank (RIR)</div>
        <Segmented options={RIRS.map((label, value) => ({ value, label }))} value={rir} onChange={setRir} />
      </div>

      {item.scheme.t === 'legraise' && (
        <button className={'check' + (controlled ? ' on' : '')} aria-pressed={controlled} onClick={() => setControlled(c => !c)}>
          <span className="circle">{controlled && <Icon name="check" size={18} />}</span>
          <span className="check-body"><b>Controlled, no swing</b><span className="small muted">Needed on all 3 sets to move up a level.</span></span>
        </button>
      )}
      {item.scheme.t === 'nordic' && (
        <div className="field">
          <div className="field-label">Assistance</div>
          <Segmented options={NORDIC_LEVELS.map(l => ({ value: l as string, label: l[0].toUpperCase() + l.slice(1) }))} value={assist} onChange={v => v && setAssist(v)} />
        </div>
      )}

      <Dock>
        {timer}
        {canRamp && <button className="btn slim" disabled={weight === null} onClick={() => save(true)}>Log as ramp-up set</button>}
        {done && (
          <div className="grid2">
            <button className="btn danger" onClick={remove}>Delete set</button>
            <button className="btn" onClick={onCancelEdit}>Cancel</button>
          </div>
        )}
        <button className="btn primary" disabled={item.usesWeight && weight === null} onClick={() => save(false)}>
          {done ? 'Save change' : item.usesWeight && weight === null ? 'Enter a weight' : 'Done'}
        </button>
      </Dock>
    </>
  );
}
