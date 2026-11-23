// Schedule engine (spec section 4). A "week" is 7 sessions in fixed order, not calendar days.

export type SessionType = 'easy' | 'gymB' | 'intervals' | 'gymC' | 'gymA' | 'threshold' | 'gymD';

// 14 Nov 2026 (Brad): the easy run moved from before Gym B to between C and A, so each back-heavy day
// (C deadlift, A hip thrust and swings, D single-leg RDL) has a day without heavy lifting after it.
export const WEEK_ORDER: SessionType[] = ['gymB', 'intervals', 'gymC', 'easy', 'gymA', 'threshold', 'gymD'];
/** Block 1 was built in the original order; its saved schedule was re-ordered from week 5 by hand. */
export const BLOCK1_ORDER: SessionType[] = ['easy', 'gymB', 'intervals', 'gymC', 'gymA', 'threshold', 'gymD'];

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

export function buildSchedule(start: string, weeks = 8, order: SessionType[] = WEEK_ORDER): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    slots.push({ idx: i, week: Math.floor(i / 7) + 1, type: order[i % 7], date: addDays(start, i), order: 1 });
  }
  return slots;
}

const open = (s: Slot) => !s.done && !s.skipped;

/** Missed day (4.2): every remaining session from that date moves `days` later. */
export function shiftFrom(slots: Slot[], date: string, days = 1): Slot[] {
  return slots.map(s => (open(s) && s.date >= date ? { ...s, date: addDays(s.date, days) } : s));
}

/** Missed sessions (24 Nov 2026): the first lands on the next day that allows training, and each later session moves
 *  only as far as it has to. Existing gaps are used up rather than carried along, and no-training days stay empty. */
export function catchUp(slots: Slot[], from: string, today: string, noTraining: Set<string>): Slot[] {
  const free = (d: string) => { while (noTraining.has(d)) d = addDays(d, 1); return d; };
  const moved = new Map<number, string>();
  let oldDate: string | null = null, newDate: string | null = null;
  for (const s of slots.filter(x => open(x) && x.date >= from).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)) {
    if (s.date !== oldDate) {
      const earliest: string = newDate ? addDays(newDate, 1) : today;
      newDate = free(s.date > earliest ? s.date : earliest);
      oldDate = s.date;
    }
    moved.set(s.idx, newDate!);
  }
  return slots.map(s => (moved.has(s.idx) ? { ...s, date: moved.get(s.idx)! } : s));
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
