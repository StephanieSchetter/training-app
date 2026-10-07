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

/** Round to the nearest available weight; an exact tie goes to the lighter one. */
export function roundNearest(w: number, equip: Equip, gym: GymProfile, exId: string): number {
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
  const s = gridStep(equip, gym, exId);
  if (!s) return w;
  if (equip === 'barbell_heavy') return roundNearest(w + HEAVY_STEP, equip, gym, exId);
  if (equip === 'barbell') return roundNearest(w + s, equip, gym, exId);
  // dumbbells and machines: next weight that exists above the last one
  return tidy((Math.floor(w / s + EPS) + 1) * s);
}

function tidy(n: number): number {
  return Math.round(n * 1000) / 1000;
}
