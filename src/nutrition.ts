// Calories and weight from what has been logged: daily weigh-ins in the app, food from MyFitnessPal (via
// Garmin), and Garmin's own burn estimate. The rules are in engine/energy.ts.
import { EnergyDay, estimateMaintenance, Maintenance, Targets, targets, trendWeights } from './engine/energy';
import { addDays } from './engine/schedule';
import type { Series } from './stats';
import { AppState } from './store';

const HISTORY_DAYS = 120;

/** One row per calendar day up to yesterday (today isn't finished), as far back as there is anything. */
export function energyDays(state: AppState, today: string): EnergyDay[] {
  const from = addDays(today, -HISTORY_DAYS);
  const kg = new Map(state.weights.map(w => [w.date, w.kg]));
  const dates = [...Object.keys(state.garminDays).filter(d => state.garminDays[d].kcalIn != null || state.garminDays[d].kcalOut != null), ...kg.keys()]
    .filter(d => d >= from && d < today).sort();
  if (!dates.length) return [];
  const out: EnergyDay[] = [];
  for (let d = dates[0]; d < today; d = addDays(d, 1)) {
    const g = state.garminDays[d];
    out.push({ date: d, weight: kg.get(d) ?? null, kcalIn: g?.kcalIn ?? null, kcalOut: g?.kcalOut ?? null });
  }
  return out;
}

export interface EnergyView {
  maintenance: Maintenance | null;
  /** The weight the targets are worked out from: the trend if there are weigh-ins, else the last entry. */
  weight: number | null;
  targets: Targets | null;
  last7: { intake: number | null; days: number; protein: number | null; proteinDays: number };
}

export function energyView(state: AppState, today: string): EnergyView {
  const days = energyDays(state, today);
  const maintenance = estimateMaintenance(days);
  const trend = trendWeights(days).at(-1)?.trend;
  const lastEntry = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.kg;
  const weight = trend ?? lastEntry ?? null;
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -1 - i));
  const eaten = week.map(d => state.garminDays[d]?.kcalIn).filter((k): k is number => k != null && k >= 1200);
  const protein = week.map(d => state.nutrition.protein[d]).filter((g): g is number => g != null);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    maintenance, weight,
    targets: maintenance && weight ? targets(maintenance.kcal, weight) : null,
    last7: { intake: avg(eaten), days: eaten.length, protein: avg(protein), proteinDays: protein.length },
  };
}

/** Daily weigh-ins and the smoothed trend through them. */
export function weightTrendSeries(state: AppState, today: string): Series[] {
  const days = energyDays(state, addDays(today, 1));
  return [
    { name: 'Scale', points: days.filter(d => d.weight != null).map(d => ({ x: d.date, y: d.weight! })) },
    { name: 'Trend', points: trendWeights(days).map(t => ({ x: t.date, y: Math.round(t.trend * 10) / 10 })) },
  ];
}

/** Calories eaten (MyFitnessPal, through Garmin) against Garmin's burn estimate, completed days only. */
export function calorieSeries(state: AppState, today: string): Series[] {
  const days = energyDays(state, today);
  return [
    { name: 'Eaten', points: days.filter(d => d.kcalIn != null && d.kcalIn >= 1200).map(d => ({ x: d.date, y: d.kcalIn! })) },
    { name: 'Burned (Garmin)', points: days.filter(d => d.kcalOut != null && d.kcalOut >= 1500).map(d => ({ x: d.date, y: d.kcalOut! })) },
  ];
}
