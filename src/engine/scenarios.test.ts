// Spec section 14 test scenarios that are pure rules (no screens, no network).
import { describe, expect, it } from 'vitest';
import { GymProfile, nudge, oneStepUp, roundDown, roundNearest } from './weights';
import { backExtensionGoWeighted, lateralBendStageUp } from './progression';
import { rampSets } from './progression';
import { deloadSetCount, LiftCtx, nextBlockStart, pullupsGoWeighted, PULLUP_WEIGHTED, reduceTenPercent, suggestRpt, suggestStraight } from './progression';
import { applyDoubleUp, buildSchedule, heavyBeforeIntervals, shiftFrom, travelOptions } from './schedule';
import { matchActivity, matchLaps, matchRepLaps } from './garmin';
import { easyPaceAdvice, hrBetween, isComfortableEasy, isHardEasy, steadyHr } from './coach';
import { easyCeiling, easyPaceSuggestion } from './running';
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

  it('a top set on target with 4+ in reserve goes up a step; anything harder adds a rep', () => {
    const easy = { gymId: 'adelaide', weight: 80, reps: [6, 8, 10], topRir: 4 };
    const s = suggestRpt([6, 8, 10], [easy], incline);
    expect(weights(s)).toEqual([82.5, 75, 67.5]);
    expect(s.sets[0].reps).toBe(6);
    for (const topRir of [3, null, undefined]) {
      const t = suggestRpt([6, 8, 10], [{ ...easy, topRir }], incline);
      expect([t.sets[0].weight, t.sets[0].reps]).toEqual([80, 7]);
    }
    // short of the target is still a miss, however it was rated
    expect(suggestRpt([6, 8, 10], [{ ...easy, reps: [5] }], incline).sets[0].weight).toBe(80);
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

  it('back extension goes weighted only when 3 x 12 felt easy (RIR 3 or 4+ on every set)', () => {
    const set = (reps: number, rir: number | null) => ({ reps, rir });
    expect(backExtensionGoWeighted([set(12, 3), set(12, 4), set(12, 3)], 3, 12)).toBe(true);
    expect(backExtensionGoWeighted([set(12, 3), set(12, 2), set(12, 3)], 3, 12)).toBe(false);
    expect(backExtensionGoWeighted([set(12, 3), set(11, 4), set(12, 3)], 3, 12)).toBe(false);
    expect(backExtensionGoWeighted([set(12, null), set(12, 4), set(12, 3)], 3, 12)).toBe(false);
  });

  it('lateral bend moves up a stage only at 12 on every set, both sides, all controlled', () => {
    const rows = (fn: (n: number, side: 'L' | 'R') => { reps?: number; controlled?: boolean }) =>
      [1, 2, 3].flatMap(n => (['L', 'R'] as const).map(side => ({ setNo: n, side, reps: 12, controlled: true, ...fn(n, side) })));
    expect(lateralBendStageUp(rows(() => ({})), 3, 12)).toBe(true);
    expect(lateralBendStageUp(rows((n, s) => (n === 2 && s === 'L' ? { reps: 11 } : {})), 3, 12)).toBe(false);
    expect(lateralBendStageUp(rows((n, s) => (n === 3 && s === 'R' ? { controlled: false } : {})), 3, 12)).toBe(false);
    expect(lateralBendStageUp(rows(() => ({})).slice(0, 5), 3, 12)).toBe(false); // a side missing
  });

  it('straight sets: all at top -> one step, otherwise same', () => {
    const ctx: LiftCtx = { exId: 'curl', equip: 'dumbbell', gym: adelaide, week: 3 };
    expect(suggestStraight(4, [8, 10], [{ gymId: 'adelaide', weight: 10, reps: [10, 10, 10, 10] }], ctx).sets[0].weight).toBe(12.5);
    // changed 13 Oct 2026: the first set at the top is enough, as long as the later sets stay in the range
    const next = (reps: number[], strict = false) => suggestStraight(4, [8, 10], [{ gymId: 'adelaide', weight: 10, reps }], ctx, strict).sets[0].weight;
    expect(next([10, 10, 10, 9])).toBe(12.5);
    expect(next([10, 9, 8, 8])).toBe(12.5);
    expect(next([10, 9, 8, 7])).toBe(10);     // a later set fell out of the range
    expect(next([9, 10, 10, 10])).toBe(10);   // the first set didn't reach the top
    expect(next([10, 9, 8])).toBe(10);        // a set was skipped
    expect(next([12, 11, 10, 9])).toBe(12.5); // going over the top on set one is fine
    // where every set must reach the top (45° back extension)
    expect(next([10, 10, 10, 9], true)).toBe(10);
    expect(next([10, 10, 10, 10], true)).toBe(12.5);
    // fixed reps (deadlift weeks 1-2, 3 x 8): unchanged, every set must be completed
    const fixed = (reps: number[]) => suggestStraight(3, [8, 8], [{ gymId: 'adelaide', weight: 70, reps }], { exId: 'deadlift', equip: 'barbell_heavy', gym: adelaide, week: 2 }).sets[0].weight;
    expect([fixed([8, 8, 8]), fixed([8, 8, 7])]).toEqual([75, 70]);
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

describe('garmin matching', () => {
  const lap = (sec: number, avgHr = 150) => ({ sec, km: 0, avgHr });
  const reps = Array(5).fill({ km: 0.8, speed: 13.8 }); // 3:29 each

  it('laps match reps in order, ignoring warm-up, recoveries and cool-down', () => {
    const laps = [lap(520, 120), lap(209, 160), lap(120), lap(210, 164), lap(120), lap(208, 166), lap(120), lap(209, 168), lap(120), lap(211, 170), lap(300, 130)];
    expect(matchLaps(laps, reps)?.map(l => l.avgHr)).toEqual([160, 164, 166, 168, 170]);
  });

  it('14 Oct intervals: a warm-up lap the length of a rep is left out, and the cut-short fifth rep is flagged', () => {
    const real = [[387, 120], [211, 145], [211, 156], [129, 143], [214, 158], [136, 148], [209, 161], [123, 156], [209, 165], [128, 159], [93, 156], [349, 126]].map(([sec, avgHr]) => lap(sec, avgHr));
    const m = matchRepLaps(real, reps)!;
    expect(m.reps.map(l => l.avgHr)).toEqual([156, 158, 161, 165, 156]);
    expect(m.stoppedEarly).toBe(true);
    expect(m.recoveries.map(l => l.avgHr)).toEqual([143, 148, 156, 159]);
    // the old way took the last five rep-length laps, which pulled in the warm-up
    expect(matchLaps(real, reps)?.map(l => l.avgHr)).toEqual([145, 156, 158, 161, 165]);
  });

  it('rep / recovery pattern: a full session, fewer reps than planned, and no recovery laps at all', () => {
    const full = [lap(520, 120), lap(209, 160), lap(120), lap(210, 164), lap(120), lap(208, 166), lap(120), lap(209, 168), lap(120), lap(211, 170), lap(300, 130)];
    expect(matchRepLaps(full, reps)).toMatchObject({ stoppedEarly: false });
    expect(matchRepLaps(full, reps)!.reps.map(l => l.avgHr)).toEqual([160, 164, 166, 168, 170]);
    // stopped after two reps and went straight to a long cool-down: two reps, nothing flagged as cut short
    const two = matchRepLaps([lap(520), lap(209, 160), lap(120), lap(210, 164), lap(120), lap(400, 130)], reps)!;
    expect([two.reps.map(l => l.avgHr), two.stoppedEarly]).toEqual([[160, 164], false]);
    // lap pressed only at the end of each rep (no separate recovery laps): the last rep-length laps
    expect(matchRepLaps([lap(600), lap(209, 160), lap(210, 164)], [reps[0], reps[1]])!.reps.map(l => l.avgHr)).toEqual([160, 164]);
    expect(matchRepLaps([lap(1900)], reps)).toBeNull();
  });

  it('too few rep-length laps -> could not match', () => {
    expect(matchLaps([lap(520), lap(209), lap(120), lap(210)], reps)).toBeNull();
    expect(matchLaps([lap(1900)], reps)).toBeNull();
  });

  it('a warm-up as long as a threshold rep is not mistaken for one', () => {
    const laps = [lap(480, 125), lap(40), lap(478, 158), lap(120), lap(481, 162), lap(300)];
    expect(matchLaps(laps, [{ km: 1.68, speed: 12.6 }, { km: 1.68, speed: 12.6 }])?.map(l => l.avgHr)).toEqual([158, 162]);
  });

  it('activity: same date and kind, closest start time', () => {
    const act = (id: number, type: 'run' | 'strength', startLocal: string) => ({ id, type, startLocal, date: startLocal.slice(0, 10), durationSec: 0, avgHr: null, maxHr: null, laps: [] });
    const acts = [act(1, 'run', '2026-10-01 06:10:00'), act(2, 'strength', '2026-10-01 15:31:00'), act(3, 'run', '2026-10-01 15:59:00')];
    const at = (h: number, m: number) => new Date(2026, 9, 1, h, m).getTime();
    expect(matchActivity(acts, '2026-10-01', 'run', at(16, 5))?.id).toBe(3);
    expect(matchActivity(acts, '2026-10-01', 'strength', at(9, 0))?.id).toBe(2);
    expect(matchActivity(acts, '2026-10-02', 'run', at(9, 0))).toBeUndefined();
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

  it('easy pace after a time trial: ceiling, and moves by heart rate', () => {
    expect(easyCeiling(21 * 60)).toBe(11.0);
    expect(easyPaceSuggestion(10.2, 11.0, [144, 141, 145])).toEqual({ speed: 10.4, why: 'up' });
    expect(easyPaceSuggestion(10.2, 11.0, [144, 146, 145])).toBeNull();
    expect(easyPaceSuggestion(10.2, 11.0, [140, 141])).toBeNull();
    expect(easyPaceSuggestion(10.2, 11.0, [140, 153, 141])).toEqual({ speed: 10.0, why: 'down' });
    expect(easyPaceSuggestion(10.9, 11.0, [140, 140, 140])).toEqual({ speed: 11.0, why: 'up' });
    expect(easyPaceSuggestion(11.0, 11.0, [140, 140, 140])).toBeNull();
    // only the three most recent count
    expect(easyPaceSuggestion(10.2, 11.0, [155, 140, 141, 142])).toEqual({ speed: 10.4, why: 'up' });
  });

  it('1 km at 13.8 takes 4:21', () => {
    expect(mmss(repSeconds(1, 13.8))).toBe('4:21');
  });
});

describe('ramp-up sets before a main lift', () => {
  const sets = (top: number, first: boolean, ctx: LiftCtx) => rampSets(top, first, ctx).map(s => `${s.weight}x${s.reps}`).join(' ');
  const deadlift: LiftCtx = { exId: 'deadlift', equip: 'barbell_heavy', gym: adelaide, week: 1 };
  const press: LiftCtx = { exId: 'db_shoulder_press', equip: 'dumbbell', gym: adelaide, week: 3 };

  it('first main lift of the session: three sets building to the working weight', () => {
    expect(sets(70, true, deadlift)).toBe('35x5 50x3 60x1');
    expect(sets(100, true, incline)).toBe('50x5 70x3 85x1');
  });

  it('later main lifts are already warm: two sets', () => {
    expect(sets(80, false, incline)).toBe('47.5x5 65x2');
    expect(sets(25, false, press)).toBe('15x5 20x2');
  });

  it('a barbell never goes below the empty bar, and repeats or the working weight itself are dropped', () => {
    expect(sets(30, true, incline)).toBe('20x5 25x1');
    expect(sets(20, true, incline)).toBe('');
    expect(sets(7.5, true, press)).toBe('2.5x5 5x3');
  });
});

describe('machines whose step changes part-way up the stack', () => {
  // 5 kg steps up to 60 kg, then 10 kg steps
  const gym: GymProfile = { ...adelaide, machineSteps: { lat_pulldown: 5 }, machineChange: { lat_pulldown: { from: 60, step: 10 } } };
  const at = (w: number) => roundNearest(w, 'machine', gym, 'lat_pulldown');
  const up = (w: number) => oneStepUp(w, 'machine', gym, 'lat_pulldown');

  it('rounds to a pin that exists on either side of the change', () => {
    expect([42, 58, 63, 65, 66, 74, 76].map(at)).toEqual([40, 60, 60, 60, 70, 70, 80]);
    expect(roundDown(69, 'machine', gym, 'lat_pulldown')).toBe(60);
    expect(roundDown(57, 'machine', gym, 'lat_pulldown')).toBe(55);
  });

  it('one step up is 5 below the change and 10 above it', () => {
    expect([50, 55, 60, 70].map(up)).toEqual([55, 60, 70, 80]);
  });

  it('plus and minus on the set screen follow the stack', () => {
    const tap = (w: number, d: 1 | -1) => nudge(w, d, 'machine', gym, 'lat_pulldown');
    expect([tap(55, 1), tap(60, 1), tap(70, -1), tap(60, -1), tap(5, -1), tap(0, -1)]).toEqual([60, 70, 60, 55, 0, 0]);
    // an even stack and free weights are unchanged
    expect(nudge(40, 1, 'machine', adelaide, 'leg_curl')).toBe(45);
    expect(nudge(20, -1, 'dumbbell', adelaide, 'db_bench')).toBe(17.5);
  });

  it('a suggestion crossing the change uses the bigger step, and back-off sets land on real pins', () => {
    const ctx: LiftCtx = { exId: 'lat_pulldown', equip: 'machine', gym, week: 3 };
    const s = suggestRpt([8, 10, 12], [{ gymId: 'adelaide', weight: 60, reps: [10, 12, 12] }], ctx);
    expect(weights(s)).toEqual([70, 60, 55]);
  });
});

describe('coach: reading an easy run from its laps', () => {
  // Brad's real runs: 12 Oct (35 min at 10 km/h, 1 km laps) and the 8 Oct baseline (30 min, 9 laps).
  const oct12 = [[386, 121], [361, 139], [363, 143], [363, 146], [363, 150], [267, 154]].map(([sec, avgHr]) => ({ sec, avgHr }));
  const oct8 = [124, 136, 140, 142, 145, 148, 153, 157, 157].map(avgHr => ({ sec: 200, avgHr }));

  it('time-weighted heart rate across part of a run', () => {
    expect(hrBetween(oct12, 386, 386 + 361)).toBeCloseTo(139);
    expect(hrBetween(oct12, 0, 99999)).toBeNull();
  });

  it('12 Oct: settles after the first lap, then rises about 6% and finishes around 151', () => {
    const s = steadyHr(oct12)!;
    expect([s.early, s.late, s.lateThird, s.minutes]).toEqual([142, 150, 151, 35]);
    expect(s.driftPct).toBeCloseTo(5.9, 0);
  });

  it('8 Oct baseline rose more, and strides tacked on the end are cut off', () => {
    expect(steadyHr(oct8)!.driftPct).toBeGreaterThan(7);
    const withStrides = [...oct12, { sec: 360, avgHr: 165 }];
    expect(steadyHr(withStrides, 2103)!.lateThird).toBe(151);
    expect(steadyHr(withStrides)!.lateThird).toBeGreaterThan(155);
  });

  it('too few laps or minutes says nothing', () => {
    expect(steadyHr([{ sec: 2100, avgHr: 141 }])).toBeNull();
    expect(steadyHr(oct12.slice(0, 3))).toBeNull();
  });

  it('easy pace: two runs that did not stay easy ease it back, before any time trial', () => {
    const a = { avgHr: 145, driftPct: 8, lateHr: 156 }, b = { avgHr: 141, driftPct: 5.9, lateHr: 151 };
    expect(isHardEasy(a) && isHardEasy(b)).toBe(true);
    expect(easyPaceAdvice(10, 10, [a, b])).toEqual({ speed: 9.8, why: 'down', used: 2 });
    expect(easyPaceAdvice(10, 10, [b])).toBeNull();
    // one steady run in between resets it
    expect(easyPaceAdvice(10, 10, [a, { avgHr: 140, driftPct: 3, lateHr: 144 }])).toBeNull();
  });

  it('easy pace: slowing down counts as not easy; three steady runs go up, never past the ceiling', () => {
    const steady = { avgHr: 140, driftPct: 3, lateHr: 144 };
    expect(isComfortableEasy(steady)).toBe(true);
    expect(isHardEasy({ ...steady, slowed: true })).toBe(true);
    expect(easyPaceAdvice(10, 10.7, [steady, steady, steady])).toEqual({ speed: 10.2, why: 'up', used: 3 });
    expect(easyPaceAdvice(10.6, 10.7, [steady, steady, steady])!.speed).toBe(10.7);
    expect(easyPaceAdvice(10, 10, [steady, steady, steady])).toBeNull();
    // averages only (no lap detail) behave as the original rule did
    expect(easyPaceAdvice(10.4, 11, [{ avgHr: 146 }, { avgHr: 153 }, { avgHr: 147 }])).toEqual({ speed: 10.2, why: 'down', used: 3 });
  });

  it('the longest activity of the day is the easy run when strides were recorded separately', () => {
    const act = (id: number, startLocal: string, durationSec: number) => ({ id, type: 'run' as const, startLocal, date: startLocal.slice(0, 10), durationSec, avgHr: null, maxHr: null, laps: [] });
    const acts = [act(1, '2026-10-12 06:50:07', 2103), act(2, '2026-10-12 07:25:49', 361)];
    const loggedLate = new Date(2026, 9, 12, 7, 30).getTime();
    expect(matchActivity(acts, '2026-10-12', 'run', loggedLate)?.id).toBe(2);
    expect(matchActivity(acts, '2026-10-12', 'run', loggedLate, 'longest')?.id).toBe(1);
  });
});
