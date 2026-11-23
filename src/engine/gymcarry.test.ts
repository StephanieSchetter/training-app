import { describe, expect, it } from 'vitest';
import { carryAcrossGyms, Past } from '../plan';
const gym = (id: string) => ({ id, name: id, dumbbellStep: 2.5, smallestPlate: 1.25, kettlebells: [], machineSteps: { x: 2.5 } }) as never;
const row = (date: string, gymId: string, sets: [number, number][]): Past => ({
  session: { id: date, date, gymId, week: 2 } as never,
  sets: sets.map(([weight, reps], i) => ({ setNo: i + 1, weight, reps, rir: 2 })) as never,
  result: { gymId, weight: sets[0][0], weights: sets.map(s => s[0]), reps: sets.map(s => s[1]), excused: false, deload: false, topRir: 2 } as never,
});
describe('machine lifts across gyms', () => {
  it('adds the percentage gained at the other gym to this gym\'s last weight', () => {
    const out = carryAcrossGyms([row('10-01', 'fifo', [[40, 10]]), row('10-10', 'adelaide', [[50, 10]]), row('10-20', 'adelaide', [[60, 10]])], gym('fifo'), 'x', 'machine');
    expect(out).toHaveLength(4);
    expect(out[3].result.gymId).toBe('fifo');
    expect(out[3].result.weight).toBeGreaterThanOrEqual(47.5);
    expect(out[3].result.weight).toBeLessThanOrEqual(50);
  });
  it('never lowers this gym\'s weight when the other gym went down', () => {
    const out = carryAcrossGyms([row('10-01', 'fifo', [[50, 9]]), row('10-10', 'adelaide', [[40, 7]]), row('10-20', 'adelaide', [[35, 8]])], gym('fifo'), 'x', 'machine');
    expect(out[3].result.weight).toBe(50);
  });
  it('never estimates above the weight just lifted, and a lighter first set counts as the next one', () => {
    const leg = carryAcrossGyms([row('10-01', 'fifo', [[65, 10], [60, 12]]), row('10-10', 'adelaide', [[60, 12]]), row('10-20', 'adelaide', [[72.5, 12]])], gym('fifo'), 'x', 'machine');
    expect(leg[3].result.weight).toBe(72.5);
    const calf = carryAcrossGyms([row('10-01', 'fifo', [[100, 12], [110, 12]]), row('10-10', 'adelaide', [[120, 15]]), row('10-20', 'adelaide', [[145, 15]])], gym('fifo'), 'x', 'machine');
    expect(calf[3].result.weights).toEqual([132.5, 132.5]);
  });
  it('changes nothing when the latest session was at this gym, or for free weights', () => {
    const p = [row('10-01', 'adelaide', [[50, 9]]), row('10-10', 'fifo', [[40, 7]])];
    expect(carryAcrossGyms(p, gym('fifo'), 'x', 'machine')).toBe(p);
    expect(carryAcrossGyms(p, gym('adelaide'), 'x', 'dumbbell')).toBe(p);
  });
});

describe('missed sessions around a travel day', () => {
  it('uses up the gap instead of moving it', async () => {
    const { catchUp } = await import('./schedule');
    const slot = (idx: number, date: string) => ({ idx, week: 5, type: 'gymA', date, order: 1 }) as never;
    const out = catchUp([slot(1, '2026-11-20'), slot(2, '2026-11-21'), slot(3, '2026-11-23'), slot(4, '2026-11-24'), slot(5, '2026-11-25')], '2026-11-20', '2026-11-22', new Set(['2026-11-22']));
    expect((out as { date: string }[]).map(s => s.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  });
});
