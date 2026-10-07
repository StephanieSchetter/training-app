// Spec section 14 test scenarios that are pure rules (no screens, no network).
import { describe, expect, it } from 'vitest';
import { GymProfile } from './weights';
import { deloadSetCount, LiftCtx, nextBlockStart, pullupsGoWeighted, PULLUP_WEIGHTED, reduceTenPercent, suggestRpt, suggestStraight } from './progression';
import { applyDoubleUp, buildSchedule, heavyBeforeIntervals, shiftFrom, travelOptions } from './schedule';
import { adjustSpeed, mmss, readinessSuggestion, repSeconds, restingHrAlert, timeTrialReset } from './running';

const adelaide: GymProfile = { id: 'adelaide', name: 'Adelaide', dumbbellStep: 2.5, smallestPlate: 1.25, kettlebells: [8, 12, 16, 20, 24], machineSteps: { leg_curl: 5 } };
const fifo: GymProfile = { id: 'fifo', name: 'FIFO', dumbbellStep: 2, smallestPlate: 1.25, kettlebells: [8, 12, 16], machineSteps: {} };

const incline: LiftCtx = { exId: 'incline_press', equip: 'barbell', gym: adelaide, week: 3 };
const weights = (s: { sets: { weight: number | null }[] }) => s.sets.map(x => x.weight);

describe('gym progression', () => {
  it('1: 80 x 8 -> 82.5 / 75 / 67.5', () => {
    const s = suggestRpt([6, 8, 10], [{ gymId: 'adelaide', weight: 80, reps: [8, 10, 12] }], incline);
    expect(weights(s)).toEqual([82.5, 75, 67.5]);
  });

  it('2: 80 x 5 -> same; again 80 x 5 -> 72.5', () => {
    const miss = { gymId: 'adelaide', weight: 80, reps: [5] };
    expect(weights(suggestRpt([6, 8, 10], [miss], incline))[0]).toBe(80);
    expect(weights(suggestRpt([6, 8, 10], [miss, miss], incline))[0]).toBe(72.5);
  });

  it('3: 80 x 5 on a bad day is not a miss', () => {
    const miss = { gymId: 'adelaide', weight: 80, reps: [5] };
    const s = suggestRpt([6, 8, 10], [miss, { ...miss, excused: true }], incline);
    expect(s.sets[0].weight).toBe(80);
    // and an excused miss before a real one doesn't make it the second
    expect(suggestRpt([6, 8, 10], [{ ...miss, excused: true }, miss], incline).sets[0].weight).toBe(80);
  });

  it('4: dumbbell press from Adelaide rounds to 2 kg steps in FIFO', () => {
    const ctx: LiftCtx = { exId: 'db_shoulder_press', equip: 'dumbbell', gym: fifo, week: 2 };
    expect(suggestRpt([6, 8, 10], [{ gymId: 'adelaide', weight: 22.5, reps: [7] }], ctx).sets[0].weight).toBe(22);
    expect(suggestRpt([6, 8, 10], [{ gymId: 'adelaide', weight: 22.5, reps: [8] }], ctx).sets[0].weight).toBe(24);
  });

  it('5: leg curl 35 in Adelaide, first time in PH -> no suggestion, asks for step', () => {
    const ctx: LiftCtx = { exId: 'leg_curl', equip: 'machine', gym: fifo, week: 2 };
    const s = suggestStraight(4, [10, 12], [{ gymId: 'adelaide', weight: 35, reps: [12, 12, 12, 12] }], ctx);
    expect(s.kind).toBe('find-load');
    expect(s.sets[0].weight).toBeNull();
    expect(s.askMachineStep).toBe(true);
  });

  it('14: back worse -> 10% off, rounded', () => {
    expect(reduceTenPercent(100, { exId: 'deadlift', equip: 'barbell_heavy', gym: adelaide, week: 3 })).toBe(90);
  });

  it('15: pull-ups 3 x 8 -> weighted +2.5 kg, RPT 6/8/10', () => {
    expect(pullupsGoWeighted([[5, 5, 4], [8, 8, 8]])).toBe(true);
    expect(pullupsGoWeighted([[8, 8, 7]])).toBe(false);
    expect(PULLUP_WEIGHTED).toEqual({ startAddedKg: 2.5, scheme: [6, 8, 10] });
  });

  it('17: deload halves sets, never drives progression; next block is week 7 minus 5%', () => {
    expect([3, 4, 2].map(deloadSetCount)).toEqual([2, 2, 1]);
    const h = [{ gymId: 'adelaide', weight: 80, reps: [7] }, { gymId: 'adelaide', weight: 80, reps: [10], deload: true }];
    expect(suggestRpt([6, 8, 10], h, incline).sets[0].weight).toBe(80);
    expect(nextBlockStart(82.5, incline)).toBe(77.5);
  });

  it('straight sets: all at top -> one step, otherwise same', () => {
    const ctx: LiftCtx = { exId: 'curl', equip: 'dumbbell', gym: adelaide, week: 3 };
    expect(suggestStraight(4, [8, 10], [{ gymId: 'adelaide', weight: 10, reps: [10, 10, 10, 10] }], ctx).sets[0].weight).toBe(12.5);
    expect(suggestStraight(4, [8, 10], [{ gymId: 'adelaide', weight: 10, reps: [10, 10, 10, 9] }], ctx).sets[0].weight).toBe(10);
  });
});

describe('schedule', () => {
  const block = buildSchedule('2026-10-12');
  const on = (slots: typeof block, date: string) => slots.filter(s => s.date === date).sort((a, b) => a.order - b.order).map(s => s.type);

  it('7: missed Thursday pushes Gym C to Friday and everything after', () => {
    const s = shiftFrom(block, '2026-10-15');
    expect(on(s, '2026-10-15')).toEqual([]);
    expect(on(s, '2026-10-16')).toEqual(['gymC']);
    expect(on(s, '2026-10-17')).toEqual(['gymA']);
    expect(on(s, '2026-10-21')).toEqual(['gymB']);
    expect(heavyBeforeIntervals(s)).toEqual([]);
    // if Gym C ends up the day before intervals, it is flagged
    const clash = block.map(x => (x.idx === 3 ? { ...x, date: '2026-10-20' } : x.idx === 8 ? { ...x, date: '2026-10-15' } : x));
    expect(heavyBeforeIntervals(clash).map(x => x.idx)).toEqual([3]);
  });

  it('8: Mon 26 Oct travel -> double-up offered, Gym B first on Tue 27', () => {
    const o = travelOptions(block, '2026-10-26');
    expect(o.choices).toContain('double-up');
    expect(o.doubleUpOrder).toEqual(['gymB', 'easy']);
    const s = applyDoubleUp(block, '2026-10-26');
    expect(on(s, '2026-10-26')).toEqual([]);
    expect(on(s, '2026-10-27')).toEqual(['gymB', 'easy']);
    expect(on(s, '2026-10-28')).toEqual(['intervals']);
  });

  it('9: Gym A day travel (threshold next) -> only shift or skip', () => {
    expect(on(block, '2026-10-16')).toEqual(['gymA']);
    expect(travelOptions(block, '2026-10-16').choices).toEqual(['shift', 'skip']);
  });

  it('13: accepting two days off shifts the schedule two days', () => {
    const s = shiftFrom(block, '2026-10-20', 2);
    expect(on(s, '2026-10-22')).toEqual(['gymB']);
    expect(restingHrAlert([...Array(30).fill(50), 55, 56, 55])).toBe(true);
    expect(restingHrAlert([...Array(30).fill(50), 55, 54, 55])).toBe(false);
  });
});

describe('running', () => {
  it('10: yes -> +0.3; could not finish twice -> -0.3 and alert', () => {
    expect(adjustSpeed(13.8, ['yes'])).toEqual({ speed: 14.1, slippingAlert: false });
    expect(adjustSpeed(13.8, ['dnf'])).toEqual({ speed: 13.8, slippingAlert: false });
    expect(adjustSpeed(13.8, ['dnf', 'dnf'])).toEqual({ speed: 13.5, slippingAlert: true });
  });

  it('11: time trial 21:00', () => {
    expect(timeTrialReset(21 * 60, { intervals: 14.1, strides: 15.5 })).toEqual({ ttSpeed: 14.29, intervals: 14.8, threshold: 13.5, easy: 11.0, strides: 16.2 });
  });

  it('12: readiness 20 on intervals day -> intervals at -0.3', () => {
    const r = readinessSuggestion(20, 'intervals');
    expect(r.speedDelta).toBe(-0.3);
    expect(r.replaceWith).toBeUndefined();
    expect(readinessSuggestion(20, 'easy').replaceWith).toBe('easy-30');
  });

  it('1 km at 13.8 takes 4:21', () => {
    expect(mmss(repSeconds(1, 13.8))).toBe('4:21');
  });
});
