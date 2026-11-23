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
  it('changes nothing when the latest session was at this gym, or for free weights', () => {
    const p = [row('10-01', 'adelaide', [[50, 9]]), row('10-10', 'fifo', [[40, 7]])];
    expect(carryAcrossGyms(p, gym('fifo'), 'x', 'machine')).toBe(p);
    expect(carryAcrossGyms(p, gym('adelaide'), 'x', 'dumbbell')).toBe(p);
  });
});
