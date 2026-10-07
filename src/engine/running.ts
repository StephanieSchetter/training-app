// Running rules (spec section 7) and readiness / pull-back rules (section 8).
import type { SessionType } from './schedule';

export type RunAnswer = 'yes' | 'no' | 'dnf';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Weekly adjustment for intervals and threshold (7.1). answers: oldest first, newest last. */
export function adjustSpeed(current: number, answers: RunAnswer[]): { speed: number; slippingAlert: boolean } {
  const last = answers.at(-1);
  if (last === 'yes') return { speed: round1(current + 0.3), slippingAlert: false };
  if (last === 'dnf' && answers.at(-2) === 'dnf') return { speed: round1(current - 0.3), slippingAlert: true };
  return { speed: current, slippingAlert: false };
}

export const SUB20_SPEED = 15.0;

/** Time-trial reset (7.2). */
export function timeTrialReset(timeSec: number, pre: { intervals: number; strides: number }) {
  const tt = 5 / (timeSec / 3600);
  const intervals = round1(tt + 0.5);
  return {
    ttSpeed: Math.round(tt * 100) / 100,
    intervals,
    threshold: round1(tt - 0.8),
    easy: round1(tt - 3.25),
    strides: round1(pre.strides + (intervals - pre.intervals)),
  };
}

// ---- Easy pace after a time trial (agreed with Brad, 8 Oct 2026; replaces the spec's fixed TT - 3.25) ----

export const EASY_HR_OK = 145;
export const EASY_HR_HIGH = 152;
export const EASY_STEP = 0.2;

/** The most easy speed is ever allowed to be: time-trial speed minus 3.25. */
export function easyCeiling(timeTrialSec: number): number {
  return round1(5 / (timeTrialSec / 3600) - 3.25);
}

/**
 * Looks at the last three easy runs done at the current speed (average heart rate from the watch).
 * All three at 145 or under -> suggest +0.2, never past the ceiling. Any at 152 or over -> suggest -0.2.
 * Otherwise, or with fewer than three runs to go on, no change.
 */
export function easyPaceSuggestion(current: number, ceiling: number, hrAtCurrentSpeed: number[]): { speed: number; why: 'up' | 'down' } | null {
  const last = hrAtCurrentSpeed.slice(-3);
  if (last.length < 3) return null;
  if (last.some(hr => hr >= EASY_HR_HIGH)) return { speed: round1(current - EASY_STEP), why: 'down' };
  if (last.every(hr => hr <= EASY_HR_OK) && current < ceiling) return { speed: Math.min(ceiling, round1(current + EASY_STEP)), why: 'up' };
  return null;
}

/** Seconds a distance rep takes on the treadmill at a given speed. */
export function repSeconds(km: number, speed: number): number {
  return Math.round((km / speed) * 3600);
}

export function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export interface Segment { label: string; speed: number; minutes?: number; km?: number }

export function totalKm(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.km ?? (s.speed * (s.minutes ?? 0)) / 60), 0);
}

export const MAX_RUN_KM = 8;

// ---- Readiness (8.1) ----

export interface ReadinessSuggestion {
  band: '75+' | '50-74' | '25-49' | '<25';
  text: string;
  extraRir?: number;
  fewerMainSets?: number;
  speedDelta?: number;
  fewerThresholdReps?: number;
  replaceWith?: 'warmup-and-stretch' | 'easy-30';
}

export function readinessSuggestion(score: number, type: SessionType): ReadinessSuggestion {
  const gym = type.startsWith('gym');
  if (score >= 75) return { band: '75+', text: 'As planned' };
  if (score >= 50) return gym ? { band: '50-74', text: 'As planned, +1 RIR on top sets', extraRir: 1 } : { band: '50-74', text: 'As planned' };
  if (score >= 25) {
    if (gym) return { band: '25-49', text: 'One fewer set on main lifts, +1 RIR', extraRir: 1, fewerMainSets: 1 };
    return type === 'threshold'
      ? { band: '25-49', text: '-0.3 km/h, one fewer rep', speedDelta: -0.3, fewerThresholdReps: 1 }
      : { band: '25-49', text: '-0.3 km/h', speedDelta: -0.3 };
  }
  if (gym) return { band: '<25', text: 'Warm-up and stretching only', replaceWith: 'warmup-and-stretch' };
  // Intervals are never replaced.
  if (type === 'intervals') return { band: '<25', text: 'Intervals at -0.3 km/h', speedDelta: -0.3 };
  return { band: '<25', text: '30 min easy', replaceWith: 'easy-30' };
}

// ---- Resting HR pull-back (8.2) ----

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** restingHr: one value per day, oldest first. True when the last 3 days are each 5+ over the 30-day median before them. */
export function restingHrAlert(restingHr: number[]): boolean {
  if (restingHr.length < 10) return false;
  const last3 = restingHr.slice(-3);
  const base = median(restingHr.slice(-33, -3));
  return last3.every(v => v >= base + 5);
}
