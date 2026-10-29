import { describe, expect, it } from 'vitest';
import { kettlebellOnly, nudge, oneStepUp, roundNearest } from './weights';

const adelaide = { id: 'adelaide', name: 'Adelaide', dumbbellStep: 2.5, smallestPlate: null, kettlebells: [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], machineSteps: {} };

describe('kettlebells between dumbbells (30 Oct 2026)', () => {
  it('step-up: 12.5 -> 14 -> 15 -> 16', () => {
    expect(oneStepUp(12.5, 'dumbbell', adelaide, 'step_up')).toBe(14);
    expect(oneStepUp(14, 'dumbbell', adelaide, 'step_up')).toBe(15);
    expect(nudge(15, 1, 'dumbbell', adelaide, 'step_up')).toBe(16);
    expect(nudge(14, -1, 'dumbbell', adelaide, 'step_up')).toBe(12.5);
    expect(roundNearest(13.8, 'dumbbell', adelaide, 'step_up')).toBe(14);
    expect(kettlebellOnly(14, 'dumbbell', adelaide, 'step_up')).toBe(true);
    expect(kettlebellOnly(15, 'dumbbell', adelaide, 'step_up')).toBe(false);
  });
  it('curls and pressing stay on dumbbells', () => {
    expect(oneStepUp(12.5, 'dumbbell', adelaide, 'hammer_curl')).toBe(15);
    expect(oneStepUp(25, 'dumbbell', adelaide, 'db_shoulder_press')).toBe(27.5);
    expect(kettlebellOnly(14, 'dumbbell', adelaide, 'hammer_curl')).toBe(false);
  });
  it('light dumbbells still go in 1 kg steps', () => {
    expect(oneStepUp(8, 'dumbbell', adelaide, 'lateral_raise')).toBe(9);
    expect(oneStepUp(10, 'dumbbell', adelaide, 'lateral_raise')).toBe(12);
  });
});
