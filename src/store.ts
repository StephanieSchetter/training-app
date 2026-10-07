// Everything is saved on the phone first (IndexedDB); the outbox lists what still has to upload.
import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import type { Equip, GymProfile } from './engine/weights';
import { applyDoubleUp, buildSchedule, Slot } from './engine/schedule';

export type Scheme =
  | { t: 'rpt'; reps: number[] }
  | { t: 'straight'; sets: number; range: [number, number] }
  | { t: 'fixed'; sets: number; reps: number; unit?: string }
  | { t: 'log'; sets: number; reps: number }
  | { t: 'pullup' }
  | { t: 'legraise' }
  | { t: 'dips'; sets: number; range: [number, number] }
  | { t: 'nordic'; sets: number; range: [number, number] };

export interface Exercise {
  name: string; equip: Equip; eachSide?: boolean; plateLoaded?: boolean;
  tags?: string[]; main?: string[]; helper?: string[]; note?: string;
}
export interface ProgramItem { ex: string; scheme: Scheme; pair?: string; before?: string }
export interface Program {
  block: number; start: string; weeks: number;
  rirByWeek: Record<string, string>; weekNotes: Record<string, string>;
  warmup: { name: string; dose: string; how: string }[];
  stretches: { name: string; why: string }[];
  exercises: Record<string, Exercise>;
  sessions: Record<string, { name: string; note?: string; items: ProgramItem[] }>;
  swaps: { when: string; from: string; to: string; label: string }[];
  legRaiseLevels: { level: number; name: string; sets: number; range: [number, number] }[];
  stints: Stint[]; days: Record<string, string>; doubleUps: string[];
  running?: RunningPlan;
}
export interface RunWeek {
  easy: { min: number; speed: number; strides?: boolean };
  intervals: { reps: number; km: number; recMin: number; note?: string } | { timeTrial: true };
  threshold: { reps: number; min: number; recMin?: number } | { easyKm: number; speed: number; strides?: boolean };
}
export interface RunningPlan {
  incline: string;
  speeds: { intervals: number; threshold: number; recovery: number; thresholdRecovery: number; strides: number; strideRecovery: number; cooldown: number };
  weeks: Record<string, RunWeek>;
}
export interface Stint { location: string; start: string; end: string; gym: string }

export interface SessionLog {
  id: string; slotIdx: number | null; type: string; date: string; gymId: string; week: number;
  /** Before the block starts: a trial run that never feeds suggestions or charts. */
  practice?: boolean;
  swaps: Record<string, string>;
  warmup: number[];
  badDay?: boolean; readinessAccepted?: boolean; notes?: string;
  startedAt: number; finishedAt?: number;
}
export interface SetLog {
  id: string; sessionId: string; exId: string; plannedExId: string;
  setNo: number; side?: 'L' | 'R';
  weight: number | null; reps: number; rir: number | null;
  rampUp?: boolean; extra?: boolean; controlled?: boolean; assist?: string; level?: number;
  suggestedWeight: number | null; suggestedReps: number | null;
  ts: number;
}
export type RunType = 'easy' | 'intervals' | 'threshold';
export interface RunSegLog { section: string; text: string; detail?: string; work: boolean; prescribed?: number; actual?: number; done: boolean }
export interface RunLog {
  id: string; slotIdx: number; type: RunType; date: string; week: number; title: string;
  segs: RunSegLog[];
  /** "Could you have done 2 more reps at this speed?" */
  answer?: 'yes' | 'no' | 'dnf';
  timeTrial?: boolean; timeTrialSec?: number;
  speedBefore?: number; speedAfter?: number;
  startedAt: number; finishedAt?: number;
}
export interface Speeds { intervals: number; threshold: number; strides: number }
export interface Alert { id: string; kind: 'intervals-slipping'; date: string; status: 'open' | 'accepted' | 'ignored' }

/** Current run speeds: the block's starting speeds until a run answer or time trial changes them. */
export function currentSpeeds(s: AppState): Speeds {
  const p = s.program!.running!.speeds;
  return s.speeds ?? { intervals: p.intervals, threshold: p.threshold, strides: p.strides };
}

export interface AppState {
  runs: RunLog[];
  speeds: Speeds | null;
  alerts: Alert[];
  activeRunId: string | null;
  program: Program | null;
  profiles: GymProfile[];
  stints: Stint[];
  days: Record<string, string>;
  schedule: Slot[];
  sessions: SessionLog[];
  sets: SetLog[];
  restOverrides: Record<string, number>;
  activeSessionId: string | null;
}

const KEY = 'training-app-state-v1';
let state: AppState;
const listeners = new Set<() => void>();

function fresh(): AppState {
  return {
    program: null,
    profiles: [
      { id: 'adelaide', name: 'Adelaide', dumbbellStep: 2.5, smallestPlate: null, kettlebells: [], machineSteps: {} },
      { id: 'fifo', name: 'FIFO', dumbbellStep: 2, smallestPlate: null, kettlebells: [], machineSteps: {} },
    ],
    stints: [], days: {}, schedule: [], sessions: [], sets: [], restOverrides: {}, activeSessionId: null,
    runs: [], speeds: null, alerts: [], activeRunId: null,
  };
}

/** "Seated dumbbell shoulder press" -> "Seated Dumbbell Shoulder Press". */
export function titleCase(text: string): string {
  return text.replace(/(^|[\s\-(/])([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Exercise names are always shown with capital first letters. */
export function tidyProgram(p: Program): Program {
  for (const ex of Object.values(p.exercises)) ex.name = titleCase(ex.name);
  return p;
}

/** Swap in a new or corrected program file. The schedule is only built the first time. */
export function setProgram(s: AppState, p: Program) {
  if (s.schedule.length && s.program?.block === p.block) s.program = tidyProgram(p);
  else loadProgram(s, p);
}

export function loadProgram(s: AppState, p: Program) {
  s.program = tidyProgram(p);
  s.stints = p.stints;
  s.days = { ...p.days };
  let sched = buildSchedule(p.start, p.weeks);
  for (const d of p.doubleUps) sched = applyDoubleUp(sched, d);
  s.schedule = sched;
}

export async function initStore() {
  // Spread over a fresh state so data saved by an older version of the app gains any new fields.
  state = { ...fresh(), ...((await get(KEY)) ?? {}) };
  if (state.program) tidyProgram(state.program);
  if (!state.program && import.meta.env.DEV && new URLSearchParams(location.search).has('local')) {
    // Development only: the program file is not shipped with the app's code.
    const local = Object.values(import.meta.glob('../seed/*.json', { eager: true }))[0] as { default: Program } | undefined;
    if (local) update(s => loadProgram(s, local.default));
  }
  navigator.storage?.persist?.();
}

export const getState = () => state;

export function update(fn: (s: AppState) => void) {
  const next = structuredClone(state);
  fn(next);
  state = next;
  set(KEY, state);
  listeners.forEach(l => l());
}

/** Change a saved record. Uploading is worked out separately by comparing with what the database has. */
export function write(_table: string, _id: string, fn: (s: AppState) => void) {
  update(fn);
}

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useStore(): AppState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, getState);
}

export const uid = () => crypto.randomUUID();

export function today(): string {
  // Development only: ?local&today=2026-10-14 pretends it is another day, for testing date-driven screens.
  const fake = import.meta.env.DEV ? new URLSearchParams(location.search).get('today') : null;
  if (fake) return fake;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function gymForDate(s: AppState, date: string): GymProfile {
  const stint = s.stints.find(t => date >= t.start && date <= t.end);
  return s.profiles.find(p => p.id === (stint ? stint.gym : 'adelaide'))!;
}
