// Builds the full prescription for one run (spec 5.3) from the block's running plan.
import { MAX_RUN_KM, mmss, repSeconds } from './engine/running';
import type { Program } from './store';

export interface RunLine { text: string; detail?: string; km: number }
export interface RunSection { title: string; lines: RunLine[] }
export interface RunPlan { title: string; summary: string; sections: RunSection[]; km: number; over8: boolean; outdoors?: boolean }

const kmFor = (minutes: number, speed: number) => (minutes * speed) / 60;
const mins = (m: number) => (m < 1 ? `${Math.round(m * 60)} sec` : Number.isInteger(m) ? `${m} min` : `${Math.floor(m)} min ${Math.round((m % 1) * 60)} sec`);
const dist = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km} km`);

export function buildRun(program: Program, week: number, type: 'easy' | 'intervals' | 'threshold'): RunPlan | null {
  const plan = program.running;
  const w = plan?.weeks[String(week)];
  if (!plan || !w) return null;
  const sp = plan.speeds;

  const warm: RunSection = { title: 'Warm-up', lines: [
    { text: '8 min, building from 9 to 10.5 km/h', km: kmFor(8, 9.75) },
    { text: '2 × 20 sec at 14 km/h', detail: 'Short pick-ups to wake the legs', km: kmFor(40 / 60, 14) },
  ] };
  const cool: RunSection = { title: 'Cool-down', lines: [{ text: `5 min at ${sp.cooldown} km/h`, km: kmFor(5, sp.cooldown) }] };
  const strides: RunSection = { title: 'Strides', lines: [
    { text: `6 × 20 sec at ${sp.strides} km/h`, detail: `40 sec at ${sp.strideRecovery} km/h between each`, km: kmFor(2, sp.strides) + kmFor(200 / 60, sp.strideRecovery) },
  ] };

  let title = '';
  let summary = '';
  let sections: RunSection[] = [];
  let outdoors = false;

  const easyRun = (label: string, km: number, speed: number, withStrides?: boolean, minutes?: number) => {
    title = 'Easy run';
    summary = `${label} at ${speed} km/h${withStrides ? ' + strides' : ''}`;
    sections = [{ title: 'Main run', lines: [{ text: `${label} at ${speed} km/h`, detail: minutes ? `About ${km.toFixed(1)} km` : `About ${mmss(repSeconds(km, speed))}`, km }] }];
    if (withStrides) sections.push(strides);
  };

  if (type === 'easy') {
    easyRun(`${w.easy.min} min`, kmFor(w.easy.min, w.easy.speed), w.easy.speed, w.easy.strides, w.easy.min);
  } else if (type === 'intervals') {
    const iv = w.intervals;
    if ('timeTrial' in iv) {
      title = '5 km time trial';
      summary = 'Outdoors, flat. Log your time afterwards.';
      outdoors = true;
      sections = [{ title: 'Main run', lines: [{ text: '5 km as fast as you can sustain', detail: 'Sub-20 pace is 15.0 km/h (4:00 per km)', km: 5 }] }];
    } else {
      title = 'Intervals';
      summary = `${iv.reps} × ${dist(iv.km)} at ${sp.intervals} km/h, ${mins(iv.recMin)} recovery${iv.note ? ` · ${iv.note}` : ''}`;
      const lines: RunLine[] = [];
      for (let i = 1; i <= iv.reps; i++) {
        lines.push({ text: `Rep ${i}: ${dist(iv.km)} at ${sp.intervals} km/h`, detail: `Takes ${mmss(repSeconds(iv.km, sp.intervals))}`, km: iv.km });
        if (i < iv.reps) lines.push({ text: `Recovery: ${mins(iv.recMin)} at ${sp.recovery} km/h`, km: kmFor(iv.recMin, sp.recovery) });
      }
      sections = [warm, { title: 'Main set', lines }, cool];
    }
  } else {
    const th = w.threshold;
    if ('easyKm' in th) {
      easyRun(`${th.easyKm} km`, th.easyKm, th.speed, th.strides);
    } else {
      title = 'Threshold run';
      summary = th.reps === 1 ? `${th.min} min continuous at ${sp.threshold} km/h` : `${th.reps} × ${th.min} min at ${sp.threshold} km/h, ${mins(th.recMin ?? 2)} between`;
      const lines: RunLine[] = [];
      for (let i = 1; i <= th.reps; i++) {
        lines.push({ text: `${th.reps === 1 ? 'Continuous' : `Rep ${i}`}: ${th.min} min at ${sp.threshold} km/h`, detail: `About ${kmFor(th.min, sp.threshold).toFixed(1)} km`, km: kmFor(th.min, sp.threshold) });
        if (i < th.reps) lines.push({ text: `Recovery: ${mins(th.recMin ?? 2)} at ${sp.thresholdRecovery} km/h`, km: kmFor(th.recMin ?? 2, sp.thresholdRecovery) });
      }
      sections = [warm, { title: 'Main set', lines }, cool];
    }
  }

  const km = sections.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.km, 0), 0);
  return { title, summary, sections, km, over8: km > MAX_RUN_KM + 1e-6, outdoors };
}
