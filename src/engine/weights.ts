// Weight rounding and "one step" rules (spec 6.2, 6.3).

/** 'added' = weight hung on a bodyweight lift (weighted pull-ups and dips), 2.5 kg steps. */
export type Equip = 'dumbbell' | 'barbell' | 'barbell_heavy' | 'machine' | 'kettlebell' | 'bodyweight' | 'added';

export interface GymProfile {
  id: string;
  name: string;
  dumbbellStep: number;
  /** Smallest single barbell plate in kg; null until Brad enters it. */
  smallestPlate: number | null;
  kettlebells: number[];
  /** Stack step per machine exercise id, asked on first use. */
  machineSteps: Record<string, number>;
  /** Machines whose step changes part-way up the stack: machineSteps up to `from` kg, then `step` above it. */
  machineChange?: Record<string, { from: number; step: number }>;
}

const EPS = 1e-9;
const DEFAULT_PLATE = 1.25;
const HEAVY_STEP = 5;

/** Spacing of available weights, or null when it isn't known yet (machine never used here). */
export function gridStep(equip: Equip, gym: GymProfile, exId: string): number | null {
  switch (equip) {
    case 'dumbbell': return gym.dumbbellStep;
    case 'barbell':
    case 'barbell_heavy': return 2 * (gym.smallestPlate ?? DEFAULT_PLATE);
    case 'machine': return gym.machineSteps[exId] ?? null;
    case 'added': return 2.5;
    default: return null;
  }
}

/** A machine stack with two step sizes, e.g. 5 kg steps up to 60 kg and 10 kg steps above. Null for an even stack. */
/** Both gyms have light dumbbells in 1 kg steps up to 10 kg; above that the gym's usual step (16 Oct 2026). */
export const LIGHT_DUMBBELLS = { upTo: 10, step: 1 };

function stack(equip: Equip, gym: GymProfile, exId: string): { step: number; from: number; then: number } | null {
  if (equip === 'dumbbell' && gym.dumbbellStep > LIGHT_DUMBBELLS.step) return { step: LIGHT_DUMBBELLS.step, from: LIGHT_DUMBBELLS.upTo, then: gym.dumbbellStep };
  const step = gym.machineSteps[exId];
  const c = gym.machineChange?.[exId];
  return equip === 'machine' && step && c && c.from > 0 && c.step > 0 ? { step, from: c.from, then: c.step } : null;
}

/** Round to the nearest available weight; an exact tie goes to the lighter one. */
export function roundNearest(w: number, equip: Equip, gym: GymProfile, exId: string): number {
  const k = stack(equip, gym, exId);
  if (k) {
    return w <= k.from
      ? Math.min(k.from, tidy(Math.ceil(w / k.step - 0.5 - EPS) * k.step))
      : tidy(k.from + Math.ceil((w - k.from) / k.then - 0.5 - EPS) * k.then);
  }
  if (equip === 'kettlebell') {
    const bells = [...gym.kettlebells].sort((a, b) => a - b);
    if (!bells.length) return w;
    return bells.reduce((best, b) => (Math.abs(b - w) < Math.abs(best - w) - EPS ? b : best), bells[0]);
  }
  const s = gridStep(equip, gym, exId);
  if (!s) return w;
  return tidy(Math.ceil(w / s - 0.5 - EPS) * s);
}

export function roundDown(w: number, equip: Equip, gym: GymProfile, exId: string): number {
  if (equip === 'kettlebell') {
    const below = gym.kettlebells.filter(b => b <= w + EPS);
    return below.length ? Math.max(...below) : w;
  }
  const k = stack(equip, gym, exId);
  if (k) return w < k.from ? tidy(Math.floor(w / k.step + EPS) * k.step) : tidy(k.from + Math.floor((w - k.from) / k.then + EPS) * k.then);
  const s = gridStep(equip, gym, exId);
  if (!s) return w;
  return tidy(Math.floor(w / s + EPS) * s);
}

/** The smallest increase allowed for this lift at this gym. */
export function oneStepUp(w: number, equip: Equip, gym: GymProfile, exId: string): number {
  if (equip === 'kettlebell') {
    const above = gym.kettlebells.filter(b => b > w + EPS);
    return above.length ? Math.min(...above) : w;
  }
  const k = stack(equip, gym, exId);
  if (k) {
    return w < k.from - EPS
      ? Math.min(k.from, tidy((Math.floor(w / k.step + EPS) + 1) * k.step))
      : tidy(k.from + (Math.floor((w - k.from) / k.then + EPS) + 1) * k.then);
  }
  const s = gridStep(equip, gym, exId);
  if (!s) return w;
  if (equip === 'barbell_heavy') return roundNearest(w + HEAVY_STEP, equip, gym, exId);
  if (equip === 'barbell') return roundNearest(w + s, equip, gym, exId);
  // dumbbells and machines: next weight that exists above the last one
  return tidy((Math.floor(w / s + EPS) + 1) * s);
}

/** The weight one tap of plus or minus moves to on the set screen. Uneven machine stacks follow their own positions. */
export function nudge(w: number, dir: 1 | -1, equip: Equip, gym: GymProfile, exId: string): number {
  const k = stack(equip, gym, exId);
  if (k && dir > 0) return oneStepUp(w, equip, gym, exId);
  if (k) {
    return w > k.from + EPS
      ? Math.max(k.from, tidy(k.from + (Math.ceil((w - k.from) / k.then - EPS) - 1) * k.then))
      : Math.max(0, tidy((Math.ceil(w / k.step - EPS) - 1) * k.step));
  }
  const s = gridStep(equip, gym, exId) ?? 2.5;
  return Math.max(0, Math.round((w + dir * s) * 100) / 100);
}

function tidy(n: number): number {
  return Math.round(n * 1000) / 1000;
}
