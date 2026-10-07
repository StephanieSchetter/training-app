// Schedule engine (spec section 4). A "week" is 7 sessions in fixed order, not calendar days.

export type SessionType = 'easy' | 'gymB' | 'intervals' | 'gymC' | 'gymA' | 'threshold' | 'gymD';

export const WEEK_ORDER: SessionType[] = ['easy', 'gymB', 'intervals', 'gymC', 'gymA', 'threshold', 'gymD'];

export interface Slot {
  idx: number;
  week: number;
  type: SessionType;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Order within the day when two sessions share a date (1 = first). */
  order: number;
  done?: boolean;
  skipped?: boolean;
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildSchedule(start: string, weeks = 8): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    slots.push({ idx: i, week: Math.floor(i / 7) + 1, type: WEEK_ORDER[i % 7], date: addDays(start, i), order: 1 });
  }
  return slots;
}

const open = (s: Slot) => !s.done && !s.skipped;

/** Missed day (4.2): every remaining session from that date moves `days` later. */
export function shiftFrom(slots: Slot[], date: string, days = 1): Slot[] {
  return slots.map(s => (open(s) && s.date >= date ? { ...s, date: addDays(s.date, days) } : s));
}

export const isGym = (t: SessionType) => t.startsWith('gym');

/** Double-up is only ever easy run + Gym A, B or D (4.3). */
export function canDoubleUp(a: SessionType, b: SessionType): boolean {
  const light = (t: SessionType) => t === 'gymA' || t === 'gymB' || t === 'gymD';
  return (a === 'easy' && light(b)) || (b === 'easy' && light(a));
}

export type TravelChoice = 'double-up' | 'shift' | 'skip';

/** Choices for a "Travel - no training" day. */
export function travelOptions(slots: Slot[], date: string): { choices: TravelChoice[]; doubleUpOrder?: SessionType[] } {
  const today = slots.find(s => open(s) && s.date === date);
  if (!today) return { choices: [] };
  const next = slots.find(s => open(s) && s.date === addDays(date, 1));
  if (next && canDoubleUp(today.type, next.type)) {
    const gym = isGym(today.type) ? today.type : next.type;
    return { choices: ['double-up', 'shift', 'skip'], doubleUpOrder: [gym, 'easy'] };
  }
  return { choices: ['shift', 'skip'] };
}

/** Move the travel day's session onto the next day: gym first, easy run after. */
export function applyDoubleUp(slots: Slot[], date: string): Slot[] {
  const next = addDays(date, 1);
  return slots.map(s => {
    if (!open(s)) return s;
    if (s.date === date) return { ...s, date: next, order: isGym(s.type) ? 1 : 2 };
    if (s.date === next) return { ...s, order: isGym(s.type) ? 1 : 2 };
    return s;
  });
}

/** Guard (4.4): heavy sessions that now sit the day before intervals. */
export function heavyBeforeIntervals(slots: Slot[], isHeavy: (s: Slot) => boolean = s => s.type === 'gymC'): Slot[] {
  const live = slots.filter(open);
  return live.filter(s => isHeavy(s) && live.some(i => i.type === 'intervals' && i.date === addDays(s.date, 1)));
}
