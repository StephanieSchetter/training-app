// Gym progression rules (spec section 6). Suggestions go purely by reps.
import { Equip, GymProfile, gridStep, oneStepUp, roundDown, roundNearest } from './weights';

export interface LiftCtx {
  exId: string;
  equip: Equip;
  /** Gym where the NEXT session will happen. */
  gym: GymProfile;
  /** Week of the block for the next session (1-8). */
  week: number;
}

/** One past session's result for a lift. For RPT lifts only the top set matters. */
export interface PastResult {
  gymId: string;
  weight: number;
  /** Reps per set. For each-leg lifts, the lower of left/right. */
  reps: number[];
  /** Bad-day flag, accepted readiness adjustment, or "worse" check-in after the previous session. */
  excused?: boolean;
  deload?: boolean;
  /** Reps in reserve logged on the top set (4 = "4+"); for each-leg lifts the lower side. Unset when not logged. */
  topRir?: number | null;
}

export interface SetTarget { weight: number | null; reps: number }

export interface Suggestion {
  kind: 'find-load' | 'weights';
  sets: SetTarget[];
  reason: string;
  /** True when the machine's weight step at this gym still has to be asked. */
  askMachineStep?: boolean;
}

/** Deloads never count; machines only look at results from the same gym (6.9, 6.10). */
export function usableHistory(history: PastResult[], ctx: LiftCtx): PastResult[] {
  return history.filter(h => !h.deload && (ctx.equip !== 'machine' || h.gymId === ctx.gym.id));
}

function findLoad(history: PastResult[], ctx: LiftCtx, reps: number[]): Suggestion {
  const last = usableHistory(history, ctx).at(-1);
  return {
    kind: 'find-load',
    sets: reps.map(r => ({ weight: last ? last.weight : null, reps: r })),
    reason: 'Find your load',
    askMachineStep: ctx.equip === 'machine' && gridStep(ctx.equip, ctx.gym, ctx.exId) === null,
  };
}

/** Back sets always come from the top set: set 2 = top x 0.9, set 3 = top x 0.81, each rounded. */
export function rptSets(top: number, scheme: number[], topReps: number, ctx: LiftCtx): SetTarget[] {
  return scheme.map((r, i) => ({
    weight: i === 0 ? top : roundNearest(top * Math.pow(0.9, i), ctx.equip, ctx.gym, ctx.exId),
    reps: i === 0 ? topReps : r,
  }));
}

const BAR_KG = 20;

/**
 * Ramp-up sets before a lift's first working set (agreed 12 Oct 2026). The first main lift of a
 * session gets three (about 50% x 5, 70% x 3, 85% x 1); later main lifts are already warm and get two
 * (60% x 5, 80% x 2); other weighted lifts get one lighter set to groove the movement (60% x 6,
 * added 14 Oct 2026). Each is rounded to a weight that exists; a barbell never goes below the empty bar;
 * anything that rounds to the working weight, or repeats the set before it, is dropped.
 */
export function rampSets(top: number, kind: 'first' | 'main' | 'other', ctx: LiftCtx): SetTarget[] {
  const plan = kind === 'first' ? [[0.5, 5], [0.7, 3], [0.85, 1]] : kind === 'main' ? [[0.6, 5], [0.8, 2]] : [[0.6, 6]];
  const floor = ctx.equip === 'barbell' || ctx.equip === 'barbell_heavy' ? BAR_KG : 0;
  const out: SetTarget[] = [];
  for (const [share, reps] of plan) {
    const w = Math.max(floor, roundNearest(top * share, ctx.equip, ctx.gym, ctx.exId));
    if (w <= 0 || w >= top || out.at(-1)?.weight === w) continue;
    out.push({ weight: w, reps });
  }
  return out;
}

/** Main lifts (6.4) with the miss rules (6.6). scheme e.g. [6, 8, 10]. */
export function suggestRpt(scheme: number[], history: PastResult[], ctx: LiftCtx): Suggestion {
  const [a, b] = scheme;
  const h = usableHistory(history, ctx);
  const last = h.at(-1);
  if (ctx.week === 1 || !last) return findLoad(history, ctx, scheme);

  const reps = last.reps[0];
  const r = (w: number) => roundNearest(w, ctx.equip, ctx.gym, ctx.exId);
  const out = (top: number, topReps: number, reason: string): Suggestion =>
    ({ kind: 'weights', sets: rptSets(top, scheme, topReps, ctx), reason });

  if (reps >= b) return out(oneStepUp(last.weight, ctx.equip, ctx.gym, ctx.exId), a, 'Hit the top of the range: one step up');
  // Agreed 10 Oct 2026: a top set that reached its target with 4+ in reserve was far too light, so go up now
  // rather than adding a rep a week. The deadlift never gets here: its history carries no topRir.
  if (reps >= a && (last.topRir ?? 0) >= 4) return out(oneStepUp(last.weight, ctx.equip, ctx.gym, ctx.exId), a, 'Felt very easy last time (4+ in reserve): one step up');
  if (reps >= a) return out(r(last.weight), Math.min(reps + 1, b), 'Same weight, aim for one more rep');
  if (last.excused) return out(r(last.weight), a, 'Excused miss: same weight');

  // Counted miss. Look back past excused misses for another counted miss at this weight.
  for (let i = h.length - 2; i >= 0; i--) {
    const p = h[i];
    const missed = p.reps[0] < a;
    if (missed && p.excused) continue;
    if (missed && p.weight === last.weight) return out(r(last.weight * 0.9), a, 'Second miss in a row: drop 10% and rebuild');
    break;
  }
  return out(r(last.weight), a, 'Miss: repeat the same weight');
}

/**
 * Straight sets (6.5). range = [x, y]; fixed reps use [n, n].
 * One step up when the first set reached the top of the range and every later set stayed in the range
 * (changed 13 Oct 2026: reps fall across sets, so asking for the top on every set only worked when the
 * first set was far from failure). everySetAtTop keeps the stricter original rule where it was agreed
 * with the physio (45° back extension).
 */
export function suggestStraight(sets: number, range: [number, number], history: PastResult[], ctx: LiftCtx, everySetAtTop = false): Suggestion {
  const targets = Array(sets).fill(range[0]);
  const h = usableHistory(history, ctx);
  const last = h.at(-1);
  if (ctx.week === 1 || !last) return findLoad(history, ctx, targets);
  const allTop = last.reps.length >= sets && last.reps[0] >= range[1] && last.reps.every(x => x >= (everySetAtTop ? range[1] : range[0]));
  const weight = allTop
    ? oneStepUp(last.weight, ctx.equip, ctx.gym, ctx.exId)
    : roundNearest(last.weight, ctx.equip, ctx.gym, ctx.exId);
  return {
    kind: 'weights',
    sets: targets.map(reps => ({ weight, reps })),
    reason: !allTop ? 'Same weight' : everySetAtTop || range[0] === range[1] ? 'All sets hit the top: one step up' : 'First set hit the top and the rest stayed in range: one step up',
  };
}

/** Next-morning rule (6.7): 10% off, rounded. Applied only after Brad confirms. */
export function reduceTenPercent(weight: number, ctx: LiftCtx): number {
  return roundNearest(weight * 0.9, ctx.equip, ctx.gym, ctx.exId);
}

/** Week 8 (6.9): half the sets, rounded up. */
export function deloadSetCount(sets: number): number {
  return Math.ceil(sets / 2);
}

/** New block (6.9): week 7 top set minus 5%, rounded down. */
export function nextBlockStart(week7Top: number, ctx: LiftCtx): number {
  return roundDown(week7Top * 0.95, ctx.equip, ctx.gym, ctx.exId);
}

// ---- Bodyweight progressions (6.8) ----

export const PULLUP_WEEKS: Record<number, { sets: number; reps: [number, number]; note?: string }> = {
  1: { sets: 3, reps: [3, 3] }, 2: { sets: 3, reps: [3, 3] },
  3: { sets: 3, reps: [4, 4] }, 4: { sets: 3, reps: [4, 4] },
  5: { sets: 3, reps: [5, 6] }, 6: { sets: 3, reps: [5, 6] },
  7: { sets: 3, reps: [6, 8] },
  8: { sets: 2, reps: [4, 4], note: 'easy' },
};

/** True once any bodyweight session shows 3 sets of 8 strict. */
export function pullupsGoWeighted(bodyweightSessions: number[][]): boolean {
  return bodyweightSessions.some(reps => reps.filter(r => r >= 8).length >= 3);
}

export const PULLUP_WEIGHTED = { startAddedKg: 2.5, scheme: [6, 8, 10] };

/** Leg raises: up a level when 3 sets reach target reps, all ticked "controlled, no swing". */
export function legRaiseLevelUp(sets: { reps: number; controlled: boolean }[], targetReps: number): boolean {
  return sets.filter(s => s.reps >= targetReps && s.controlled).length >= 3;
}

/**
 * 45° back extension (physio, Oct 2026): ready for load once every set hit the top of the range AND
 * felt easy, meaning RIR 3 or 4+ was logged on each. rir: 0-3 as tapped, 4 for "4+", null if not tapped.
 */
export function backExtensionGoWeighted(sets: { reps: number; rir: number | null }[], setCount: number, topReps: number): boolean {
  return sets.filter(s => s.reps >= topReps && s.rir !== null && s.rir >= 3).length >= setCount;
}

/**
 * 45° lateral bend: up a stage only at the top of the range on every set, both sides, each ticked
 * "controlled". A stage is a bigger jump than a weight step, so the bar is the top of the range.
 */
export function lateralBendStageUp(sets: { setNo: number; side?: 'L' | 'R'; reps: number; controlled: boolean }[], setCount: number, topReps: number): boolean {
  for (let n = 1; n <= setCount; n++) {
    for (const side of ['L', 'R'] as const) {
      const s = sets.find(x => x.setNo === n && x.side === side);
      if (!s || s.reps < topReps || !s.controlled) return false;
    }
  }
  return true;
}

/** Dips: bodyweight until 4 x 10. */
export function dipsGoWeighted(reps: number[]): boolean {
  return reps.filter(r => r >= 10).length >= 4;
}

export const NORDIC_LEVELS = ['band', 'partial', 'full'] as const;

/** Nordics: up a level at 3 x 8 at the current level. */
export function nordicLevelUp(reps: number[]): boolean {
  return reps.filter(r => r >= 8).length >= 3;
}
