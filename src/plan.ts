// Turns the program + logged history into what the gym screens show for one session.
import type { Equip, GymProfile } from './engine/weights';
import { gridStep, roundNearest } from './engine/weights';
import {
  deloadSetCount, dipsGoWeighted, legRaiseLevelUp, LiftCtx, NORDIC_LEVELS, nordicLevelUp, PastResult,
  PULLUP_WEEKS, PULLUP_WEIGHTED, pullupsGoWeighted, reduceTenPercent, rptSets, SetTarget, suggestRpt, suggestStraight, usableHistory,
} from './engine/progression';
import type { AppState, Exercise, Scheme, SessionLog, SetLog } from './store';

export interface PlanItem {
  plannedEx: string;
  ex: string;
  info: Exercise;
  /** Name shown on screen (leg raises show the current level's name). */
  title: string;
  scheme: Scheme;
  pair?: string;
  before?: string;
  swapLabel?: string;
  equip: Equip;
  usesWeight: boolean;
  targets: SetTarget[];
  repsLabel: string[];
  reason: string;
  rest: number;
  isMain: boolean;
  /** A one-off question to ask before the first set on this equipment at this gym. */
  setup?: 'machine' | 'plate' | 'kettlebell';
  level?: number;
  assist?: string;
  /** Extra reps in reserve on top sets today, from an accepted readiness suggestion. */
  rirExtra: number;
}

/** Swaps that apply without Brad choosing them: FIFO equipment, a back flare this week, block pulls after a sore knee. */
export function autoSwaps(state: AppState, gymId: string, week: number): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (when: string) => { for (const sw of state.program!.swaps) if (sw.when === when) out[sw.from] = sw.to; };
  if (gymId === 'fifo') add('fifo');
  const deadliftSince = (t: number) => state.sessions.some(s => !s.practice && s.startedAt > t && state.sets.some(x => x.sessionId === s.id && (x.plannedExId === 'deadlift')));
  for (const t of state.tempSwaps) {
    if (t.kind === 'block-pull' && !deadliftSince(t.createdAt)) add('knee-after-deadlift');
  }
  // A back flare outranks the block pull: no deadlift variation at all that week.
  for (const t of state.tempSwaps) if (t.kind === 'back-flare' && t.week === week) add('back-flare');
  return out;
}

const DELOAD_WEEK = 8;

/** Working sets of one exercise in one session, grouped by set number. */
function sessionResult(sets: SetLog[], session: SessionLog, worseBefore: boolean): PastResult | null {
  const work = sets.filter(s => !s.rampUp && !s.extra).sort((a, b) => a.setNo - b.setNo);
  if (!work.length) return null;
  const bySet = new Map<number, SetLog[]>();
  for (const s of work) bySet.set(s.setNo, [...(bySet.get(s.setNo) ?? []), s]);
  return {
    gymId: session.gymId,
    weight: work[0].weight ?? 0,
    // each-leg lifts: both legs have to get there, so the lower side counts
    reps: [...bySet.values()].map(g => Math.min(...g.map(x => x.reps))),
    excused: !!(session.badDay || session.readinessAccepted || session.readiness?.accepted || worseBefore),
    deload: session.week === DELOAD_WEEK,
  };
}

interface Past { session: SessionLog; sets: SetLog[]; result: PastResult }

export function pastFor(state: AppState, exId: string, before: SessionLog): Past[] {
  const real = state.sessions.filter(s => !s.practice).sort((a, b) => a.startedAt - b.startedAt);
  // A miss is excused when the check-in the morning after the previous gym session was "worse" (6.6).
  const worseBefore = (s: SessionLog) => {
    const prev = real.filter(p => p.startedAt < s.startedAt).at(-1);
    const c = prev && state.checkins.find(x => x.sessionId === prev.id);
    return !!c && (c.knee === 'worse' || c.back === 'worse');
  };
  return real
    .filter(s => s.id !== before.id && s.startedAt < before.startedAt)
    .map(session => {
      const sets = state.sets.filter(x => x.sessionId === session.id && x.exId === exId);
      const result = sessionResult(sets, session, worseBefore(session));
      return result ? { session, sets, result } : null;
    })
    .filter((x): x is Past => x !== null);
}

/** Most recent logged set for "last time" under the target. */
export function lastSet(state: AppState, exId: string, setNo: number, side: string | undefined, session: SessionLog, perGym: boolean): SetLog | undefined {
  const past = pastFor(state, exId, session).filter(p => !perGym || p.session.gymId === session.gymId);
  return past.at(-1)?.sets.find(s => s.setNo === setNo && s.side === side && !s.rampUp && !s.extra);
}

const range = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

export function buildPlan(state: AppState, session: SessionLog): PlanItem[] {
  const program = state.program!;
  const gym: GymProfile = state.profiles.find(p => p.id === session.gymId)!;
  const week = session.week;
  const deload = week === DELOAD_WEEK;

  return program.sessions[session.type].items.map(item => {
    const ex = session.swaps[item.ex] ?? item.ex;
    const swapped = ex !== item.ex;
    const info = program.exercises[ex];
    const past = pastFor(state, ex, session);
    const history = past.map(p => p.result);
    let equip = info.equip;
    let scheme = item.scheme;
    let title = info.name;
    let level: number | undefined;
    let assist: string | undefined;
    // A swapped-in bodyweight move keeps the set count but has no weight rules.
    if (swapped && info.equip === 'bodyweight') scheme = { t: 'log', sets: setCount(item.scheme), reps: 10 };

    let targets: SetTarget[] = [];
    let repsLabel: string[] = [];
    let reason = '';
    const ctx = (): LiftCtx => ({ exId: ex, equip, gym, week });

    switch (scheme.t) {
      case 'rpt': {
        const s = suggestRpt(scheme.reps, history, ctx());
        targets = s.sets; reason = s.reason; repsLabel = scheme.reps.map(String);
        break;
      }
      case 'straight': case 'fixed': case 'log': {
        const r: [number, number] = scheme.t === 'straight' ? scheme.range : [scheme.reps, scheme.reps];
        if (scheme.t === 'log' || equip === 'bodyweight') {
          targets = Array.from({ length: scheme.sets }, () => ({ weight: null, reps: r[0] }));
          reason = '';
        } else {
          const s = suggestStraight(scheme.sets, r, history, ctx());
          targets = s.sets; reason = s.reason;
        }
        const unit = scheme.t === 'fixed' && scheme.unit ? ` ${scheme.unit}` : '';
        repsLabel = targets.map(() => range(r) + unit);
        break;
      }
      case 'pullup': {
        const bw = past.filter(p => p.sets.every(s => !s.weight));
        if (pullupsGoWeighted(bw.map(p => p.result.reps))) {
          equip = 'added';
          const weighted = history.filter(h => h.weight > 0);
          const sc = PULLUP_WEIGHTED.scheme;
          if (!weighted.length) {
            targets = sc.map(reps => ({ weight: PULLUP_WEIGHTED.startAddedKg, reps }));
            reason = '3 × 8 strict done: now weighted';
          } else {
            const s = suggestRpt(sc, weighted, { ...ctx(), week: Math.max(week, 2) });
            targets = s.sets; reason = s.reason;
          }
          repsLabel = sc.map(String);
          title = 'Pull-up (weighted)';
        } else {
          const row = PULLUP_WEEKS[week];
          targets = Array.from({ length: row.sets }, () => ({ weight: null, reps: row.reps[0] }));
          repsLabel = targets.map(() => range(row.reps) + (row.note ? ` ${row.note}` : ''));
        }
        break;
      }
      case 'legraise': {
        const levels = program.legRaiseLevels;
        level = 1;
        for (const p of past) {
          const cur = levels[level - 1];
          const lv: number = p.sets[0]?.level ?? level;
          if (lv === level && level < levels.length && legRaiseLevelUp(p.sets.map(s => ({ reps: s.reps, controlled: !!s.controlled })), cur.range[1])) level++;
        }
        const cur = levels[level - 1];
        title = `Level ${level}: ${cur.name}`;
        targets = Array.from({ length: cur.sets }, () => ({ weight: null, reps: cur.range[0] }));
        repsLabel = targets.map(() => range(cur.range));
        break;
      }
      case 'dips': {
        const bw = past.filter(p => p.sets.every(s => !s.weight));
        if (bw.some(p => dipsGoWeighted(p.result.reps))) {
          equip = 'added';
          const weighted = history.filter(h => h.weight > 0);
          const s = suggestStraight(scheme.sets, scheme.range, weighted, { ...ctx(), week: Math.max(week, 2) });
          targets = weighted.length ? s.sets : s.sets.map(t => ({ ...t, weight: 2.5 }));
          reason = weighted.length ? s.reason : '4 × 10 done: now weighted';
          title = 'Dips (weighted)';
        } else {
          targets = Array.from({ length: scheme.sets }, () => ({ weight: null, reps: (scheme as { range: [number, number] }).range[0] }));
        }
        repsLabel = targets.map(() => range((scheme as { range: [number, number] }).range));
        break;
      }
      case 'nordic': {
        let li = 0;
        for (const p of past) {
          const at = p.sets.every(s => s.assist === NORDIC_LEVELS[li]);
          if (at && li < NORDIC_LEVELS.length - 1 && nordicLevelUp(p.result.reps)) li++;
        }
        assist = NORDIC_LEVELS[li];
        targets = Array.from({ length: scheme.sets }, () => ({ weight: null, reps: (scheme as { range: [number, number] }).range[0] }));
        repsLabel = targets.map(() => range((scheme as { range: [number, number] }).range));
        break;
      }
    }

    // Week 8: half the sets at week 7's weights; nothing here feeds progression.
    if (deload && scheme.t !== 'pullup') {
      const last = usableHistory(history, ctx()).at(-1);
      const lastSets = past.filter(p => !p.result.deload && (equip !== 'machine' || p.session.gymId === gym.id)).at(-1)?.sets ?? [];
      const n = deloadSetCount(targets.length);
      targets = targets.slice(0, n).map((t, i) => {
        const prev = lastSets.find(s => s.setNo === i + 1 && !s.rampUp && !s.extra)?.weight ?? last?.weight ?? null;
        return { reps: t.reps, weight: prev === null || equip === 'bodyweight' ? t.weight : roundNearest(prev, equip, gym, ex) };
      });
      repsLabel = repsLabel.slice(0, n);
      reason = 'Deload: week 7 weights, half the sets';
    }

    // Next-morning rule (6.7): a confirmed "10% lighter next time" applies until this lift is next logged.
    const reduction = deload ? undefined : state.reductions.find(r => r.exId === ex && !past.some(p => p.session.startedAt > r.createdAt));
    if (reduction && targets[0]?.weight != null) {
      const c = ctx();
      const top = reduceTenPercent(targets[0].weight, c);
      targets = scheme.t === 'rpt' || equip === 'added' && item.scheme.t === 'pullup'
        ? rptSets(top, targets.map(t => t.reps), targets[0].reps, c)
        : targets.map(t => ({ ...t, weight: t.weight === null ? null : reduceTenPercent(t.weight, c) }));
      reason = `10% lighter after your ${reduction.because} check-in`;
    }

    // Accepted readiness adjustment (8.1): 25–49 drops one set from main lifts; 50–74 and 25–49 add 1 RIR.
    const isMainLift = item.scheme.t === 'rpt';
    const ready = session.readiness?.accepted ? session.readiness.score : null;
    if (ready !== null && ready < 50 && isMainLift && targets.length > 1) {
      targets = targets.slice(0, -1);
      repsLabel = repsLabel.slice(0, -1);
    }
    const rirExtra = ready !== null && ready < 75 ? 1 : 0;

    const usesWeight = equip !== 'bodyweight';
    let setup: PlanItem['setup'];
    if (equip === 'machine' && gridStep(equip, gym, ex) === null) setup = 'machine';
    else if ((equip === 'barbell' || equip === 'barbell_heavy') && gym.smallestPlate === null) setup = 'plate';
    else if (equip === 'kettlebell' && !gym.kettlebells.length) setup = 'kettlebell';

    const isMain = item.scheme.t === 'rpt';
    return {
      plannedEx: item.ex, ex, info, title, scheme, pair: item.pair, before: item.before,
      swapLabel: swapped ? `Swapped from ${program.exercises[item.ex].name}` : undefined,
      equip, usesWeight, targets, repsLabel, reason,
      rest: state.restOverrides[ex] ?? (isMain ? 180 : 90),
      isMain, setup, level, assist, rirExtra,
    };
  });
}

function setCount(s: Scheme): number {
  return 'sets' in s ? s.sets : 3;
}

export interface Step { item: PlanItem; round: number; side?: 'L' | 'R'; done?: SetLog }

/** Groups pairs (A1/A2) into one block; everything else is a block of one. */
export function blocks(plan: PlanItem[]): PlanItem[][] {
  const out: PlanItem[][] = [];
  for (const p of plan) {
    const prev = out.at(-1);
    if (p.pair && prev && prev[0].pair === p.pair) prev.push(p);
    else out.push([p]);
  }
  return out;
}

/** Order of sets in a block: A1 set 1, A2 set 1, A1 set 2 ... and left then right for each-leg lifts. */
export function stepsFor(block: PlanItem[], sets: SetLog[]): Step[] {
  const out: Step[] = [];
  const rounds = Math.max(...block.map(i => i.targets.length));
  for (let r = 0; r < rounds; r++) {
    for (const item of block) {
      if (r >= item.targets.length) continue;
      for (const side of item.info.eachSide ? (['L', 'R'] as const) : [undefined]) {
        const done = sets.find(s => s.exId === item.ex && s.setNo === r + 1 && s.side === side && !s.rampUp && !s.extra);
        out.push({ item, round: r, side, done });
      }
    }
  }
  return out;
}
