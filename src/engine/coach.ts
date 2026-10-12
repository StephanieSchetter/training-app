// Reading a run from the watch's laps (agreed 12 Oct 2026): how heart rate behaved at a fixed speed,
// and what that says about easy pace. Pure rules, no screens.
import { EASY_HR_HIGH, EASY_HR_OK, EASY_STEP } from './running';

export interface HrLap { sec: number; avgHr: number | null }

/** Heart rate is still climbing for the first few minutes, so they are left out of any comparison. */
export const SETTLE_SEC = 300;
/** A rise of more than this, first half to second half at a fixed speed, means the effort crept above easy. */
export const DRIFT_MAX_PCT = 5;
/** Heart rate over the last third of an easy run at or above this is no longer easy. */
export const EASY_LATE_HR = 150;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Time-weighted average heart rate between two moments of an activity. Null when the laps don't cover it. */
export function hrBetween(laps: HrLap[], from: number, to: number): number | null {
  let t = 0, sum = 0, dur = 0;
  for (const l of laps) {
    const a = Math.max(from, t), b = Math.min(to, t + l.sec);
    if (b > a && l.avgHr != null) { sum += l.avgHr * (b - a); dur += b - a; }
    t += l.sec;
  }
  return to > from && dur >= (to - from) * 0.8 ? sum / dur : null;
}

export interface Steady { early: number; late: number; driftPct: number; lateThird: number; minutes: number }

/**
 * How heart rate moved across a steady run: first half against second half (after the settling-in laps),
 * and the last third on its own. uptoSec cuts the activity short, for when strides were recorded in the
 * same activity as the run. Null when there aren't enough laps or minutes to say anything.
 */
export function steadyHr(laps: HrLap[], uptoSec?: number): Steady | null {
  const all = laps.reduce((a, l) => a + l.sec, 0);
  const total = uptoSec !== undefined ? Math.min(all, uptoSec) : all;
  let start = 0;
  for (const l of laps) { if (start >= SETTLE_SEC) break; start += l.sec; }
  const span = total - start;
  if (laps.length < 3 || span < 900) return null;
  const mid = start + span / 2;
  const early = hrBetween(laps, start, mid);
  const late = hrBetween(laps, mid, total);
  const lateThird = hrBetween(laps, total - total / 3, total);
  if (early === null || late === null || lateThird === null) return null;
  return { early: Math.round(early), late: Math.round(late), driftPct: round1((late / early - 1) * 100), lateThird: Math.round(lateThird), minutes: Math.round(total / 60) };
}

/** One easy run at a given speed, as the pace rule sees it. Lap detail is optional. */
export interface EasyRun { avgHr: number; driftPct?: number | null; lateHr?: number | null; slowed?: boolean }

/** Not easy: had to slow down, a high average, a high finish, or heart rate that kept climbing. */
export const isHardEasy = (r: EasyRun) =>
  !!r.slowed || r.avgHr >= EASY_HR_HIGH || (r.lateHr ?? 0) >= EASY_LATE_HR || (r.driftPct ?? 0) > DRIFT_MAX_PCT;
export const isComfortableEasy = (r: EasyRun) => !isHardEasy(r) && r.avgHr <= EASY_HR_OK;

/**
 * Easy pace from the runs done at the current speed, oldest first.
 * Down 0.2: the last two were both not easy, or any of the last three averaged 152 or over.
 * Up 0.2 (never past the ceiling): the last three were all comfortable.
 */
export function easyPaceAdvice(current: number, ceiling: number, runs: EasyRun[]): { speed: number; why: 'up' | 'down'; used: number } | null {
  const last2 = runs.slice(-2), last3 = runs.slice(-3);
  if (last2.length === 2 && last2.every(isHardEasy)) return { speed: round1(current - EASY_STEP), why: 'down', used: 2 };
  if (last3.length === 3 && last3.some(r => r.avgHr >= EASY_HR_HIGH)) return { speed: round1(current - EASY_STEP), why: 'down', used: 3 };
  if (last3.length === 3 && last3.every(isComfortableEasy) && current < ceiling) return { speed: Math.min(ceiling, round1(current + EASY_STEP)), why: 'up', used: 3 };
  return null;
}
