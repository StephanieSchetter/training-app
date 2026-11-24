import { describe, expect, it } from 'vitest';
import { buildRun, MAX_RUN_MIN } from './runplan';
import type { Program } from './store';

// Running part of the program, as in block 1 weeks 5-7 (18 Nov 2026).
const program = { running: {
  speeds: { intervals: 13.5, threshold: 12.2, recovery: 7, thresholdRecovery: 7, strides: 15.5, strideRecovery: 9, cooldown: 8.5 },
  maxKm: 10,
  weeks: {
    '5': { easy: { min: 45, speed: 9.8, strides: true }, intervals: { reps: 5, km: 1, recMin: 2.5 }, threshold: { reps: 3, min: 8, recMin: 2 } },
    '6': { easy: { min: 45, speed: 9.8, strides: true }, intervals: { reps: 5, km: 1, recMin: 2.5 }, threshold: { reps: 3, min: 8, recMin: 2 } },
    '7': { easy: { min: 45, speed: 9.8, strides: true }, intervals: { reps: 5, km: 1, recMin: 2.5 }, threshold: { reps: 3, min: 8, recMin: 2 } },
  },
} } as unknown as Program;
const minutes = (p: ReturnType<typeof buildRun>) => p!.sections.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.min, 0), 0);

describe('run length and cool-down (Brad, 18 Nov 2026)', () => {
  it('no run day goes past 45 minutes', () => {
    for (const w of [5, 6, 7]) for (const t of ['easy', 'intervals', 'threshold'] as const) {
      expect(minutes(buildRun(program, w, t))).toBeLessThanOrEqual(MAX_RUN_MIN + 1e-9);
    }
  });
  it('easy 45 min with strides becomes 39 min + strides', () => {
    const p = buildRun(program, 5, 'easy')!;
    expect(p.summary).toBe('39 min at 9.8 km/h + strides');
  });
  it('intervals end with the walk-off recovery, no jog', () => {
    const p = buildRun(program, 5, 'intervals')!;
    expect(p.sections.at(-1)!.lines.map(l => l.text)).toEqual(['Recovery: 2 min 30 sec at 7 km/h, then stop']);
    expect(p.sections.flatMap(s => s.lines).some(l => l.text.includes('8.5 km/h'))).toBe(false);
  });
  it("threshold follows Brad's routine and lands on 45 minutes", () => {
    const p = buildRun(program, 6, 'threshold')!;
    expect(minutes(p)).toBeCloseTo(45);
    expect(p.summary).toBe('3 × 8 min at 12.2 km/h, 2 min between');
    expect(p.sections[0].lines.map(l => l.text)).toEqual(['10 min, building from 8 km/h']);
    expect(p.sections.at(-1)!.lines.map(l => l.text)).toEqual(['2 min walk at 7 km/h', '5 min, building from 8 km/h']);
    expect(p.sections.at(-1)!.lines[1].detail).toContain('9.4');
  });
  it('a slower interval day still fits inside 45 minutes', () => {
    expect(minutes(buildRun(program, 6, 'intervals', { intervals: 13.0 } as never))).toBeLessThanOrEqual(MAX_RUN_MIN);
  });
});
