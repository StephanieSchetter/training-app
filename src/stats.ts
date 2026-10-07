// Turns what has been logged into the numbers behind the charts (spec section 11).
import { matchActivity } from './engine/garmin';
import { easyPaceSuggestion } from './engine/running';
import { addDays } from './engine/schedule';
import { AppState, currentSpeeds, RunLog } from './store';

export interface Point { x: string; y: number; note?: string; /** Start a new line segment here. */ gap?: boolean }
export interface Series { name: string; points: Point[] }

const DELOAD_WEEK = 8;
/** Estimated max from one set: weight x (1 + reps / 30). */
export const estMax = (kg: number, reps: number) => kg * (1 + reps / 30);
const round1 = (n: number) => Math.round(n * 10) / 10;

interface TopSet { date: string; gymId: string; weight: number | null; reps: number; total: number; level?: number; assist?: string }

/** One row per real session that included the lift: its top set, plus total reps. Ramp-ups, deloads and practice excluded. */
function topSets(state: AppState, exId: string): TopSet[] {
  return state.sessions
    .filter(s => !s.practice && s.week !== DELOAD_WEEK)
    .sort((a, b) => a.startedAt - b.startedAt)
    .flatMap(s => {
      const sets = state.sets.filter(x => x.sessionId === s.id && x.exId === exId && !x.rampUp && !x.extra);
      const top = sets.filter(x => x.setNo === 1);
      if (!top.length) return [];
      // each-leg lifts are logged left and right; count a set once, at the lower side
      const perSet = new Map<number, number>();
      for (const x of sets) perSet.set(x.setNo, Math.min(perSet.get(x.setNo) ?? Infinity, x.reps));
      return [{
        date: s.date, gymId: s.gymId, weight: top[0].weight, reps: Math.min(...top.map(x => x.reps)),
        total: [...perSet.values()].reduce((a, b) => a + b, 0), level: top[0].level, assist: top[0].assist,
      }];
    });
}

export type LiftChart =
  | { kind: 'max'; unit: 'kg'; series: Series[] }
  | { kind: 'percent'; unit: '%'; series: Series[] }
  | { kind: 'reps'; unit: 'reps'; series: Series[]; added?: Series[] }
  | { kind: 'level'; unit: 'level'; series: Series[]; levels: string[] };

const GYM_NAMES: Record<string, string> = { adelaide: 'Adelaide', fifo: 'FIFO' };
const ASSIST = ['band', 'partial', 'full'];

export function liftChart(state: AppState, exId: string): LiftChart {
  const ex = state.program!.exercises[exId];
  const rows = topSets(state, exId);
  const scheme = Object.values(state.program!.sessions).flatMap(s => s.items).find(i => i.ex === exId)?.scheme.t;

  if (scheme === 'legraise') {
    return { kind: 'level', unit: 'level', levels: state.program!.legRaiseLevels.map(l => `Level ${l.level}`), series: [{ name: 'Level', points: rows.map(r => ({ x: r.date, y: r.level ?? 1 })) }] };
  }
  if (scheme === 'nordic') {
    return { kind: 'level', unit: 'level', levels: ['Band', 'Partial', 'Full'], series: [{ name: 'Level', points: rows.map(r => ({ x: r.date, y: Math.max(1, ASSIST.indexOf(r.assist ?? 'band') + 1) })) }] };
  }
  if (ex.equip === 'bodyweight') {
    // Total reps per session while bodyweight; added weight once weighted (pull-ups, dips).
    const body = rows.filter(r => !r.weight);
    const weighted = rows.filter(r => r.weight);
    return {
      kind: 'reps', unit: 'reps',
      series: [{ name: 'Total reps', points: body.map(r => ({ x: r.date, y: r.total })) }],
      added: weighted.length ? [{ name: 'Added weight', points: weighted.map(r => ({ x: r.date, y: r.weight!, note: `× ${r.reps}` })) }] : undefined,
    };
  }
  const withMax = rows.filter(r => r.weight !== null).map(r => ({ ...r, max: estMax(r.weight!, r.reps) }));
  if (ex.equip === 'machine') {
    // Different machines at each gym, so show % change from the first session at that gym: one line per gym.
    const gyms = [...new Set(withMax.map(r => r.gymId))];
    return {
      kind: 'percent', unit: '%',
      series: gyms.map(g => {
        const mine = withMax.filter(r => r.gymId === g);
        return { name: GYM_NAMES[g] ?? g, points: mine.map(r => ({ x: r.date, y: round1((r.max / mine[0].max - 1) * 100), note: `${r.weight} kg × ${r.reps}` })) };
      }),
    };
  }
  return { kind: 'max', unit: 'kg', series: [{ name: 'Estimated max', points: withMax.map(r => ({ x: r.date, y: round1(r.max), note: `${r.weight} kg × ${r.reps}` })) }] };
}

/** Lifts in program order, grouped by session, for the Progress list. */
export function liftList(state: AppState): { session: string; items: { exId: string; name: string }[] }[] {
  const p = state.program!;
  return ['gymB', 'gymC', 'gymA', 'gymD'].filter(k => p.sessions[k]).map(k => ({
    session: p.sessions[k].name,
    items: p.sessions[k].items.filter(i => i.scheme.t !== 'log').map(i => ({ exId: i.ex, name: p.exercises[i.ex].name })),
  }));
}

const realRuns = (state: AppState) => state.runs.filter(r => !r.practice && r.finishedAt).sort((a, b) => a.startedAt - b.startedAt);
const isEasy = (r: RunLog) => r.title.startsWith('Easy') && !r.timeTrial;

/** Prescribed and achieved speed for each interval or threshold session. */
export function speedSeries(state: AppState, type: 'intervals' | 'threshold'): Series[] {
  const runs = realRuns(state).filter(r => r.type === type && !r.timeTrial && !isEasy(r));
  const rows = runs.map(r => {
    const work = r.segs.filter(s => s.work && s.prescribed !== undefined);
    const done = work.filter(s => s.done);
    return { r, prescribed: work[0]?.prescribed, achieved: done.length ? done.reduce((a, s) => a + (s.actual ?? s.prescribed!), 0) / done.length : undefined, done: done.length, of: work.length };
  });
  return [
    { name: 'Prescribed', points: rows.filter(x => x.prescribed !== undefined).map(x => ({ x: x.r.date, y: x.prescribed! })) },
    { name: 'Achieved', points: rows.filter(x => x.achieved !== undefined).map(x => ({ x: x.r.date, y: round1(x.achieved!), note: `${x.done} of ${x.of} reps` })) },
  ];
}

/** Easy runs: average heart rate at the speed run. A new segment starts whenever the speed changes. Falling = fitter. */
export function easyHrSeries(state: AppState): Series[] {
  let lastSpeed: number | undefined;
  const points: Point[] = [];
  for (const r of realRuns(state).filter(isEasy)) {
    const seg = r.segs.find(s => s.work && s.done);
    const act = matchActivity(state.garminActs, r.date, 'run', r.startedAt);
    if (!seg || !act?.avgHr) continue;
    const speed = seg.actual ?? seg.prescribed!;
    points.push({ x: r.date, y: Math.round(act.avgHr), note: `at ${speed} km/h`, gap: lastSpeed !== undefined && speed !== lastSpeed });
    lastSpeed = speed;
  }
  return [{ name: 'Average HR', points }];
}

export interface EasyPace { current: number; ceiling: number; heartRates: number[]; speed: number; why: 'up' | 'down'; evidenceId: string }

/**
 * The easy-pace suggestion, if there is one to make: only after a time trial has set a ceiling, and
 * only from easy runs logged at the current easy speed with a matching watch activity.
 */
export function easyPace(state: AppState, today: string): EasyPace | null {
  const ceiling = state.speeds?.easyCeiling;
  const plan = state.program!.running;
  if (ceiling === undefined || !plan) return null;
  const next = state.schedule.find(s => s.type === 'easy' && !s.done && !s.skipped && s.date >= today);
  const current = state.speeds?.easy ?? plan.weeks[String(next?.week ?? 0)]?.easy.speed;
  if (current === undefined) return null;
  const rows = realRuns(state).filter(isEasy).flatMap(r => {
    const seg = r.segs.find(s => s.work && s.done);
    const act = matchActivity(state.garminActs, r.date, 'run', r.startedAt);
    return seg && act?.avgHr && (seg.actual ?? seg.prescribed) === current ? [{ id: r.id, hr: Math.round(act.avgHr) }] : [];
  });
  const s = easyPaceSuggestion(current, ceiling, rows.map(r => r.hr));
  if (!s) return null;
  const evidenceId = `easy-${rows.at(-1)!.id}`;
  // Already answered for this set of runs: wait for the next easy run before suggesting again.
  if (state.alerts.some(a => a.id === evidenceId)) return null;
  return { current, ceiling, heartRates: rows.slice(-3).map(r => r.hr), ...s, evidenceId };
}

export function timeTrialSeries(state: AppState): Series[] {
  return [{ name: '5 km time', points: realRuns(state).filter(r => r.timeTrialSec).map(r => ({ x: r.date, y: r.timeTrialSec! })) }];
}

export type RecoveryKey = 'readiness' | 'restingHr' | 'hrv' | 'sleepHours' | 'sleepScore';

/** Daily recovery numbers from Garmin. HRV is shown as a 7-day average. */
export function recoverySeries(state: AppState, key: RecoveryKey, from: string): Series[] {
  const dates = Object.keys(state.garminDays).sort();
  const val = (d: string) => state.garminDays[d]?.[key] ?? null;
  const points: Point[] = [];
  for (const d of dates) {
    if (d < from) continue;
    if (key === 'hrv') {
      const week = Array.from({ length: 7 }, (_, i) => val(addDays(d, -i))).filter((v): v is number => v !== null);
      if (week.length >= 4) points.push({ x: d, y: round1(week.reduce((a, b) => a + b, 0) / week.length) });
    } else {
      const v = val(d);
      if (v !== null) points.push({ x: d, y: v });
    }
  }
  return [{ name: key, points }];
}

const mondayOf = (d: string) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));

/** Body weight as a weekly average (weeks start on Monday). */
export function weightSeries(state: AppState): Series[] {
  const byWeek = new Map<string, number[]>();
  for (const w of state.weights) byWeek.set(mondayOf(w.date), [...(byWeek.get(mondayOf(w.date)) ?? []), w.kg]);
  const points = [...byWeek.entries()].sort().map(([x, v]) => ({ x, y: round1(v.reduce((a, b) => a + b, 0) / v.length), note: v.length > 1 ? `average of ${v.length}` : undefined }));
  return [{ name: 'Weekly average', points }];
}

export interface Tile { label: string; value: string; change?: string; good?: boolean }

/** Improvement tiles for the home screen (5.1): trends only, no targets. */
export function trendTiles(state: AppState, today: string): Tile[] {
  const tiles: Tile[] = [];
  const signed = (n: number, unit: string, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}${unit}`;

  // Main lifts: average change in estimated max, first session to latest.
  const mainLifts = Object.values(state.program!.sessions).flatMap(s => s.items).filter(i => i.scheme.t === 'rpt').map(i => i.ex);
  const changes: number[] = [];
  for (const exId of mainLifts) {
    const c = liftChart(state, exId);
    for (const s of c.series) {
      if (s.points.length < 2) continue;
      if (c.kind === 'max') changes.push((s.points.at(-1)!.y / s.points[0].y - 1) * 100);
      else if (c.kind === 'percent') changes.push(s.points.at(-1)!.y); // already % from the first session at that gym
    }
  }
  const lifts = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;
  tiles.push({ label: 'Main lifts', value: lifts === null ? '—' : signed(lifts, '%'), change: lifts === null ? 'Needs two sessions' : 'est. max since first session', good: lifts !== null && lifts > 0 });

  if (state.program!.running) {
    const base = state.program!.running.speeds;
    const now = currentSpeeds(state);
    for (const k of ['intervals', 'threshold'] as const) {
      const d = round1(now[k] - base[k]);
      tiles.push({ label: k === 'intervals' ? 'Interval speed' : 'Threshold speed', value: `${now[k]} km/h`, change: d === 0 ? 'block starting speed' : `${signed(d, '')} since block start`, good: d > 0 });
    }
  }

  const easy = easyHrSeries(state)[0].points;
  const lastEasy = easy.at(-1);
  const sameSpeed = lastEasy ? easy.filter(p => p.note === lastEasy.note) : [];
  tiles.push({
    label: 'Easy-run HR', value: lastEasy ? `${lastEasy.y} bpm` : '—',
    change: !lastEasy ? 'Needs a logged easy run' : sameSpeed.length >= 2 ? `${signed(lastEasy.y - sameSpeed[0].y, '', 0)} bpm ${lastEasy.note}` : lastEasy.note,
    good: sameSpeed.length >= 2 && lastEasy!.y < sameSpeed[0].y,
  });

  const w = weightSeries(state)[0].points;
  const prevW = w.length >= 2 ? [...w].reverse().find(p => p.x <= addDays(w.at(-1)!.x, -28)) ?? w[0] : undefined;
  tiles.push({ label: 'Body weight', value: w.length ? `${w.at(-1)!.y} kg` : '—', change: !w.length ? 'Nothing entered yet' : prevW ? `${signed(w.at(-1)!.y - prevW.y, ' kg')} vs ${prevW === w[0] && w.length < 5 ? 'first entry' : '4 weeks ago'}` : 'weekly average' });

  const hrv = recoverySeries(state, 'hrv', addDays(today, -60))[0].points;
  const lastH = hrv.at(-1);
  const prevH = lastH ? [...hrv].reverse().find(p => p.x <= addDays(lastH.x, -28)) : undefined;
  tiles.push({ label: 'HRV, 7-day', value: lastH ? `${Math.round(lastH.y)}` : '—', change: !lastH ? 'No Garmin data yet' : prevH ? `${signed(lastH.y - prevH.y, '', 0)} vs 4 weeks ago` : '7-day average', good: !!prevH && lastH!.y > prevH.y });
  return tiles;
}
