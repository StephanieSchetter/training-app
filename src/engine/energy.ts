// Daily calorie needs from Brad's own data (agreed 14 Oct 2026). Garmin's burn figure is only an estimate;
// the measured figure comes from energy balance: what was eaten, against what the scale trend did.
// Pure rules, no screens.

/** Energy in a kilogram of body-weight change, the usual working figure for mixed tissue. */
export const KCAL_PER_KG = 7700;
/** A day with less than this logged is treated as not fully logged and left out. */
export const MIN_LOGGED_KCAL = 1200;
/** Garmin's burn figure for a day this low means the day isn't complete (watch off, or today). */
const MIN_GARMIN_KCAL = 1500;
/** What is needed before the measured figure replaces Garmin's estimate. */
export const NEED = { intakeDays: 10, weighIns: 8, spanDays: 14 };
const WINDOW = 28;

/** scale: which scale the weigh-in was on (home, or the gym at FIFO). Each scale keeps its own baseline. */
export interface EnergyDay { date: string; weight?: number | null; kcalIn?: number | null; kcalOut?: number | null; scale?: string }

export interface Maintenance {
  source: 'measured' | 'garmin';
  kcal: number; low: number; high: number;
  /** Over the days used: food logged, weigh-ins, and the weight trend in kg per week. */
  intakeDays: number; weighIns: number; avgIntake: number | null; kgPerWeek: number | null;
  /** Garmin's average burn over the same days, to show how far off it is. */
  garminAvg: number | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r10 = (n: number) => Math.round(n / 10) * 10;
const dayNo = (d: string) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);

/** Smoothed weight (each day moves a tenth of the way to the scale reading), so daily water swings don't show as change. */
export function trendWeights(days: EnergyDay[]): { date: string; trend: number }[] {
  const out: { date: string; trend: number }[] = [];
  let t: number | null = null;
  for (const d of days) {
    if (d.weight != null) t = t === null ? d.weight : t + 0.1 * (d.weight - t);
    if (t !== null) out.push({ date: d.date, trend: Math.round(t * 100) / 100 });
  }
  return out;
}

/**
 * Maintenance calories from the last four weeks of completed days (oldest first, today left out).
 * Measured: average intake on fully logged days, corrected by the weight trend (a straight line through
 * the weigh-ins) at 7,700 kcal per kg. The range is a 95% band from how scattered the weigh-ins and
 * intakes were. Until there is enough data, Garmin's average burn is shown with a +/-15% band.
 */
export function estimateMaintenance(days: EnergyDay[]): Maintenance | null {
  const recent = days.slice(-WINDOW);
  const intake = recent.map(d => d.kcalIn).filter((k): k is number => k != null && k >= MIN_LOGGED_KCAL);
  const burns = recent.map(d => d.kcalOut).filter((k): k is number => k != null && k >= MIN_GARMIN_KCAL);
  const w = recent.filter(d => d.weight != null).map(d => ({ x: dayNo(d.date), y: d.weight!, g: d.scale ?? '' }));
  const garminAvg = burns.length ? r10(mean(burns)) : null;
  const span = w.length ? w.at(-1)!.x - w[0].x : 0;
  const base = { intakeDays: intake.length, weighIns: w.length, avgIntake: intake.length ? r10(mean(intake)) : null, garminAvg };

  if (intake.length >= NEED.intakeDays && w.length >= NEED.weighIns && span >= NEED.spanDays) {
    // One trend line, but each scale gets its own level (a gym scale after breakfast reads differently from
    // the bathroom scale at home), so switching scales at the start or end of a stint isn't read as weight change.
    const groups = [...new Set(w.map(p => p.g))];
    const centre = new Map(groups.map(g => { const ps = w.filter(p => p.g === g); return [g, { x: mean(ps.map(p => p.x)), y: mean(ps.map(p => p.y)) }]; }));
    const dx = (p: typeof w[number]) => p.x - centre.get(p.g)!.x, dy = (p: typeof w[number]) => p.y - centre.get(p.g)!.y;
    const sxx = w.reduce((a, p) => a + dx(p) ** 2, 0);
    if (sxx > 0) {
    const slope = w.reduce((a, p) => a + dx(p) * dy(p), 0) / sxx;
    const resid = w.reduce((a, p) => a + (dy(p) - slope * dx(p)) ** 2, 0);
    const seSlope = Math.sqrt(resid / Math.max(1, w.length - groups.length - 1) / sxx);
    const m = mean(intake);
    const sdIntake = Math.sqrt(intake.reduce((a, k) => a + (k - m) ** 2, 0) / Math.max(1, intake.length - 1));
    const kcal = m - slope * KCAL_PER_KG;
    const half = 1.96 * Math.sqrt((seSlope * KCAL_PER_KG) ** 2 + (sdIntake / Math.sqrt(intake.length)) ** 2);
    return { source: 'measured', kcal: r10(kcal), low: r10(kcal - half), high: r10(kcal + half), ...base, kgPerWeek: Math.round(slope * 7 * 100) / 100 };
    }
  }
  if (garminAvg === null) return null;
  return { source: 'garmin', kcal: garminAvg, low: r10(garminAvg * 0.85), high: r10(garminAvg * 1.15), ...base, kgPerWeek: null };
}

export interface Targets { lose: number; maintain: number; gain: number; proteinG: number }

/**
 * Daily targets from maintenance and current weight. Lose fat: about 0.5% of body weight a week.
 * Build muscle: a small surplus, about 0.25% a week. Protein: 2 g per kg (the useful range is 1.6-2.2).
 */
export function targets(maintenance: number, weightKg: number): Targets {
  const perDay = (share: number) => (share * weightKg * KCAL_PER_KG) / 7;
  return {
    lose: r10(maintenance - perDay(0.005)),
    maintain: r10(maintenance),
    gain: r10(maintenance + perDay(0.0025)),
    proteinG: Math.round((2 * weightKg) / 5) * 5,
  };
}
