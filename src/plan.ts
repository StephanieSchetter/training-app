// Turns the program + logged history into what the gym screens show for one session.
import type { Equip, GymProfile } from './engine/weights';
import { gridStep, oneStepUp, roundNearest } from './engine/weights';
import {
  backExtensionGoWeighted, deloadSetCount, dipsGoWeighted, lateralBendStageUp, legRaiseLevelUp, LiftCtx, NORDIC_LEVELS, nordicLevelUp, PastResult,
  PULLUP_WEEKS, PULLUP_WEIGHTED, pullupsGoWeighted, reduceTenPercent, rptSets, SetTarget, suggestRpt, suggestStraight, usableHistory,
} from './engine/progression';
import { DROP } from './store';
import type { AppState, Exercise, ProgramItem, Scheme, SessionLog, SetLog } from './store';

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
  /** RIR target for this exercise this week (the week's default unless the program overrides it). */
  rir: string;
  /** A warm-up exercise: never counted in sets or progression. */
  warmup: boolean;
  /** Short label for an uncounted exercise: "Warm-up", "Practice" or "Power". */
  tag?: string;
}

export const LATERAL_BEND_STAGES = ['Hands by sides', 'Hands crossed over chest', 'Hands above head'];

/** The scheme an exercise uses in a given week (the graded deadlift return changes by week). */
function schemeIn(item: ProgramItem, week: number): Scheme {
  return item.byWeek?.find(b => b.weeks.includes(week))?.scheme ?? item.scheme;
}

/** True when Brad accepted the back-flare changes for this training week. */
export function flareWeek(state: AppState, week: number): boolean {
  return state.tempSwaps.some(t => t.kind === 'back-flare' && t.week === week);
}

/** True for a session done under the back-flare changes: in a flare week, after the flare was accepted. */
function easedOff(state: AppState, s: SessionLog): boolean {
  return state.tempSwaps.some(t => t.kind === 'back-flare' && t.week === s.week && s.startedAt >= t.createdAt);
}

/** The morning check after a session: 'worse' if knee or back was worse, 'none' if it wasn't answered. */
export function checkAfter(state: AppState, sessionId: string): { any: 'ok' | 'worse' | 'none'; backWorse: boolean } {
  const c = state.checkins.find(x => x.sessionId === sessionId);
  if (!c) return { any: 'none', backWorse: false };
  return { any: c.knee === 'worse' || c.back === 'worse' ? 'worse' : 'ok', backWorse: c.back === 'worse' };
}

/** Exercises left out of this session by a swap rule (e.g. kettlebell swings in a back-flare week). */
export function leftOut(state: AppState, session: SessionLog): string[] {
  return state.program!.sessions[session.type].items.filter(i => session.swaps[i.ex] === DROP).map(i => state.program!.exercises[i.ex].name);
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
  const flare = flareWeek(state, week);
  const everyItem = Object.values(program.sessions).flatMap(s => s.items);

  return program.sessions[session.type].items.filter(item => session.swaps[item.ex] !== DROP).map(item => {
    const ex = session.swaps[item.ex] ?? item.ex;
    const swapped = ex !== item.ex;
    const info = program.exercises[ex];
    const past = pastFor(state, ex, session);
    const history = past.map(p => p.result);
    const byWeek = item.byWeek?.find(b => b.weeks.includes(week));
    let equip = info.equip;
    let scheme = schemeIn(item, week);
    let title = info.name;
    let level: number | undefined;
    let assist: string | undefined;
    if (swapped) {
      // A swapped-in exercise that has its own place in the program brings its own scheme (back extension);
      // any other bodyweight move keeps the set count and has no weight rules.
      const home = everyItem.find(i => i.ex === ex && !i.warmup);
      if (home) scheme = schemeIn(home, week);
      else if (info.equip === 'bodyweight') scheme = { t: 'log', sets: setCount(scheme), reps: 10 };
    }

    let targets: SetTarget[] = [];
    let repsLabel: string[] = [];
    let reason = '';
    const ctx = (): LiftCtx => ({ exId: ex, equip, gym, week });

    switch (scheme.t) {
      case 'rpt': {
        const s = suggestRpt(scheme.reps, history, ctx());
        targets = s.sets; reason = s.reason; repsLabel = scheme.reps.map(String);
        // First reverse-pyramid week after straight-set weeks (deadlift, week 3): one step up only if
        // every straight set was completed; either way the top set starts at the bottom of the range.
        const prev = past.filter(p => !p.result.deload).at(-1);
        const before = prev && !swapped ? schemeIn(item, prev.session.week) : undefined;
        if (prev && before && (before.t === 'fixed' || before.t === 'straight') && week > 1) {
          const need = before.t === 'fixed' ? before.reps : before.range[1];
          const earned = prev.result.reps.length >= before.sets && prev.result.reps.every(r => r >= need);
          const top = earned ? oneStepUp(prev.result.weight, equip, gym, ex) : roundNearest(prev.result.weight, equip, gym, ex);
          targets = rptSets(top, scheme.reps, scheme.reps[0], ctx());
          reason = earned ? 'All straight sets done: one step up, now reverse pyramid' : 'Same weight, now reverse pyramid';
        }
        break;
      }
      case 'bwload': {
        const sets = scheme.sets;
        const top = scheme.range[1];
        const steady = past.filter(p => !easedOff(state, p.session));
        const loaded = steady.filter(p => p.sets.some(s => s.weight));
        const ready = loaded.length > 0 || steady.some(p => backExtensionGoWeighted(p.sets.filter(s => !s.rampUp && !s.extra).map(s => ({ reps: s.reps, rir: s.rir })), sets, top));
        let weight: number | null = null;
        if (flare) {
          // Back-flare week: bodyweight, or the last load that wasn't followed by a "back worse" morning.
          const calm = [...past].reverse().find(p => !checkAfter(state, p.session.id).backWorse);
          weight = calm?.sets.find(s => s.setNo === 1 && !s.rampUp && !s.extra)?.weight || null;
          reason = 'Back-flare week: no increase';
        } else if (ready) {
          const s = suggestStraight(sets, scheme.range, loaded.map(p => p.result), { exId: ex, equip: 'added', gym, week: Math.max(week, 2) });
          weight = loaded.length ? s.sets[0].weight : 2.5;
          reason = loaded.length ? s.reason : '3 × 12 felt easy: now holding a plate';
        }
        if (weight) { equip = 'added'; title = `${info.name} (weighted)`; }
        targets = Array.from({ length: sets }, () => ({ weight, reps: scheme.range[0] }));
        repsLabel = targets.map(() => range((scheme as { range: [number, number] }).range));
        break;
      }
      case 'stage': {
        const names = program.lateralBendStages ?? LATERAL_BEND_STAGES;
        const sc = scheme;
        let stage = 1;
        for (const p of past) {
          if (easedOff(state, p.session)) continue; // an eased-off session never counts towards moving up
          const at: number = p.sets[0]?.level ?? stage;
          const rows = p.sets.filter(s => !s.rampUp && !s.extra).map(s => ({ setNo: s.setNo, side: s.side, reps: s.reps, controlled: !!s.controlled }));
          if (at === stage && stage < names.length && lateralBendStageUp(rows, sc.sets, sc.range[1])) stage++;
        }
        level = flare ? Math.max(1, stage - 1) : stage;
        title = `${info.name} · Stage ${level}: ${names[level - 1]}`;
        targets = Array.from({ length: sc.sets }, () => ({ weight: null, reps: sc.range[0] }));
        repsLabel = targets.map(() => range(sc.range));
        reason = flare && stage > 1 ? 'Back-flare week: one stage easier' : '';
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

    // A starting weight set in the program replaces "find your load" the first time the lift is done.
    // It is only a pre-fill: whatever is actually logged is what progression works from.
    if (item.startWeight != null && !swapped && !past.length && equip !== 'bodyweight' && targets.length && targets.every(t => t.weight === null)) {
      const w = roundNearest(item.startWeight, equip, gym, ex);
      targets = scheme.t === 'rpt' ? rptSets(w, targets.map(t => t.reps), targets[0].reps, ctx()) : targets.map(t => ({ ...t, weight: w }));
      reason = 'Starting weight from your program';
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

    // Morning check (physio, Oct 2026): "worse" after the last session with this main lift holds its weight
    // next time. Deadlift is stricter: no answered check-in also holds.
    const lastTime = past.at(-1);
    const isDeadlift = ex === 'deadlift' || ex === 'block_pull';
    if (!deload && item.scheme.t === 'rpt' && lastTime && targets[0]?.weight != null) {
      const check = checkAfter(state, lastTime.session.id).any;
      const held = roundNearest(lastTime.result.weight, equip, gym, ex);
      if ((check === 'worse' || (isDeadlift && check === 'none')) && targets[0].weight > held) {
        targets = scheme.t === 'rpt' ? rptSets(held, targets.map(t => t.reps), targets[0].reps, ctx()) : targets.map(t => ({ ...t, weight: held }));
        reason = check === 'worse' ? 'Held: knee or back was worse the next morning' : 'Held: no morning check-in after the last deadlift session';
      }
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
      rir: byWeek?.rir ?? program.rirByWeek[week], warmup: !!item.warmup, tag: item.warmup ? item.tag ?? 'Warm-up' : undefined,
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
