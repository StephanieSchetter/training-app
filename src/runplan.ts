// Builds the full prescription for one run (spec 5.3) from the block's running plan.
import { MAX_RUN_KM, mmss, repSeconds } from './engine/running';
import { readinessSuggestion } from './engine/running';
import type { SessionType } from './engine/schedule';
import type { Program, RunAdjust, RunType, Speeds } from './store';

/** What an accepted readiness suggestion does to today's run. Empty when nothing changes. */
export function runAdjustFor(score: number, type: RunType): RunAdjust {
  const s = readinessSuggestion(score, type as SessionType);
  return { speedDelta: s.speedDelta, fewerReps: s.fewerThresholdReps, easy30: s.replaceWith === 'easy-30' || undefined };
}

export interface RunLine { text: string; detail?: string; km: number; /** A rep or main run whose speed is logged. */ work?: boolean; speed?: number }
export interface RunSection { title: string; lines: RunLine[] }
export interface RunPlan { title: string; summary: string; sections: RunSection[]; km: number; over8: boolean; /** The distance the warning is measured against. */ capKm: number; timeTrial?: boolean; /** Asks "2 more reps?" at the end. */ asks: boolean }

const kmFor = (minutes: number, speed: number) => (minutes * speed) / 60;
const mins = (m: number) => (m < 1 ? `${Math.round(m * 60)} sec` : Number.isInteger(m) ? `${m} min` : `${Math.floor(m)} min ${Math.round((m % 1) * 60)} sec`);
const dist = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`);

/** speeds: the current interval / threshold / stride speeds (they move with the weekly answers and time trials). */
export function buildRun(program: Program, week: number, type: RunType, speeds?: Speeds, adjust?: RunAdjust): RunPlan | null {
  const plan = program.running;
  const base = plan?.weeks[String(week)];
  if (!plan || !base) return null;
  const sp = { ...plan.speeds, ...(speeds ?? {}) };
  // An accepted readiness suggestion (8.1) changes today only; the stored speeds are untouched.
  const d = adjust?.speedDelta ?? 0;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  sp.intervals = r1(sp.intervals + d);
  sp.threshold = r1(sp.threshold + d);
  const w = structuredClone(base);
  // An accepted easy-pace change replaces the plan's easy speed (the deload week never goes above the plan).
  if (speeds?.easy !== undefined) {
    const easy = week === 8 ? Math.min(base.easy.speed, speeds.easy) : speeds.easy;
    w.easy.speed = easy;
    if ('easyKm' in w.threshold) w.threshold.speed = easy;
  }
  w.easy.speed = r1(w.easy.speed + d);
  if ('easyKm' in w.threshold) w.threshold.speed = r1(w.threshold.speed + d);
  else if (adjust?.fewerReps) w.threshold.reps = Math.max(1, w.threshold.reps - adjust.fewerReps);

  const warm: RunSection = { title: 'Warm-up', lines: [
    { text: '8 min, building from 9 to 10.5 km/h', km: kmFor(8, 9.75) },
    { text: '2 × 20 sec at 14 km/h', detail: 'Short pick-ups to wake the legs', km: kmFor(40 / 60, 14) },
  ] };
  const cool: RunSection = { title: 'Cool-down', lines: [{ text: `5 min at ${sp.cooldown} km/h`, km: kmFor(5, sp.cooldown) }] };
  const strides: RunSection = { title: 'Strides', lines: [
    { text: `6 × 20 sec at ${sp.strides} km/h`, detail: `40 sec at ${sp.strideRecovery} km/h between each`, km: kmFor(2, sp.strides) + kmFor(200 / 60, sp.strideRecovery) },
  ] };

  // Extra aerobic volume (agreed 10 Oct 2026): easy running after the hard part, inside the same session.
  const easyAfter = (m?: number): RunSection[] => (m ? [{ title: 'Easy running', lines: [
    { text: `${m} min at ${w.easy.speed} km/h`, detail: 'Steady and relaxed. This is the extra aerobic work.', km: kmFor(m, w.easy.speed) },
  ] }] : []);

  let title = '';
  let summary = '';
  let sections: RunSection[] = [];
  let timeTrial = false;
  let asks = false;

  const easyRun = (label: string, km: number, speed: number, withStrides?: boolean, minutes?: number) => {
    title = 'Easy Run';
    summary = `${label} at ${speed} km/h${withStrides ? ' + strides' : ''}`;
    sections = [{ title: 'Main run', lines: [{ text: `${label} at ${speed} km/h`, detail: minutes ? `About ${km.toFixed(1)} km` : `About ${mmss(repSeconds(km, speed))}`, km, work: true, speed }] }];
    if (withStrides) sections.push(strides);
  };

  if (adjust?.easy30) {
    const easy = speeds?.easy ?? base.easy.speed;
    easyRun('30 min', kmFor(30, easy), easy, false, 30);
  } else if (type === 'easy') {
    easyRun(`${w.easy.min} min`, kmFor(w.easy.min, w.easy.speed), w.easy.speed, w.easy.strides, w.easy.min);
  } else if (type === 'intervals') {
    const iv = w.intervals;
    if ('timeTrial' in iv) {
      title = '5 km Time Trial';
      summary = 'Outdoors, flat. Log your time afterwards.';
      timeTrial = true;
      sections = [{ title: 'Main run', lines: [{ text: '5 km as fast as you can sustain', detail: 'Sub-20 pace is 15.0 km/h (4:00 per km)', km: 5 }] }];
    } else {
      title = 'Intervals';
      asks = true;
      summary = `${iv.reps} × ${dist(iv.km)} at ${sp.intervals} km/h, ${mins(iv.recMin)} recovery${iv.note ? ` · ${iv.note}` : ''}`;
      const lines: RunLine[] = [];
      for (let i = 1; i <= iv.reps; i++) {
        lines.push({ text: `Rep ${i} of ${iv.reps}: ${dist(iv.km)} at ${sp.intervals} km/h`, detail: `Takes ${mmss(repSeconds(iv.km, sp.intervals))}`, km: iv.km, work: true, speed: sp.intervals });
        if (i < iv.reps) lines.push({ text: `Recovery: ${mins(iv.recMin)} at ${sp.recovery} km/h`, km: kmFor(iv.recMin, sp.recovery) });
      }
      sections = [warm, { title: 'Main set', lines }, ...easyAfter(iv.easyAfterMin), cool];
    }
  } else {
    const th = w.threshold;
    if ('easyKm' in th) {
      easyRun(`${th.easyKm} km`, th.easyKm, th.speed, th.strides);
    } else {
      title = 'Threshold Run';
      asks = true;
      summary = th.reps === 1 ? `${th.min} min continuous at ${sp.threshold} km/h` : `${th.reps} × ${th.min} min at ${sp.threshold} km/h, ${mins(th.recMin ?? 2)} between`;
      const lines: RunLine[] = [];
      for (let i = 1; i <= th.reps; i++) {
        lines.push({ text: `${th.reps === 1 ? 'Continuous' : `Rep ${i} of ${th.reps}`}: ${th.min} min at ${sp.threshold} km/h`, detail: `About ${kmFor(th.min, sp.threshold).toFixed(1)} km`, km: kmFor(th.min, sp.threshold), work: true, speed: sp.threshold });
        if (i < th.reps) lines.push({ text: `Recovery: ${mins(th.recMin ?? 2)} at ${sp.thresholdRecovery} km/h`, km: kmFor(th.recMin ?? 2, sp.thresholdRecovery) });
      }
      sections = [warm, { title: 'Main set', lines }, ...easyAfter(th.easyAfterMin), cool];
    }
  }

  const km = sections.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.km, 0), 0);
  const capKm = plan.maxKm ?? MAX_RUN_KM;
  return { title, summary, sections, km, over8: km > capKm + 1e-6, capKm, timeTrial, asks };
}
