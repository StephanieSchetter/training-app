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

/** Straight sets (6.5). range = [x, y]; fixed reps use [n, n]. */
export function suggestStraight(sets: number, range: [number, number], history: PastResult[], ctx: LiftCtx): Suggestion {
  const targets = Array(sets).fill(range[0]);
  const h = usableHistory(history, ctx);
  const last = h.at(-1);
  if (ctx.week === 1 || !last) return findLoad(history, ctx, targets);
  const allTop = last.reps.length >= sets && last.reps.every(x => x >= range[1]);
  const weight = allTop
    ? oneStepUp(last.weight, ctx.equip, ctx.gym, ctx.exId)
    : roundNearest(last.weight, ctx.equip, ctx.gym, ctx.exId);
  return {
    kind: 'weights',
    sets: targets.map(reps => ({ weight, reps })),
    reason: allTop ? 'All sets hit the top: one step up' : 'Same weight',
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

/** Dips: bodyweight until 4 x 10. */
export function dipsGoWeighted(reps: number[]): boolean {
  return reps.filter(r => r >= 10).length >= 4;
}

export const NORDIC_LEVELS = ['band', 'partial', 'full'] as const;

/** Nordics: up a level at 3 x 8 at the current level. */
export function nordicLevelUp(reps: number[]): boolean {
  return reps.filter(r => r >= 8).length >= 3;
}
