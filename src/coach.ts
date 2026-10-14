// The coach's read (agreed 12 Oct 2026): a debrief for each run and a review of each week, written from
// what was logged and what the watch recorded. Everything here is a fixed rule applied to Brad's own numbers.
import { DRIFT_MAX_PCT, EASY_LATE_HR, EasyRun, isComfortableEasy, isHardEasy, Steady, steadyHr } from './engine/coach';
import { matchActivity, matchRepLaps } from './engine/garmin';
import { EASY_HR_HIGH } from './engine/running';
import { addDays } from './engine/schedule';
import { mobilityTargetText, mobilityThisWeek } from './Stretch';
import { AppState, currentSpeeds, GarminActivity, RunLog } from './store';

export interface Note { tone: 'good' | 'watch' | 'info'; text: string }
export interface Debrief { verdict: string; tone: Note['tone']; notes: Note[]; next?: string }

const isEasyRun = (r: RunLog) => r.title.startsWith('Easy') && !r.timeTrial;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

/** The watch activity for a logged run. Easy runs take the longest of the day, so strides recorded separately never stand in for the run. */
export function runActivity(state: AppState, r: RunLog): GarminActivity | undefined {
  return matchActivity(state.garminActs, r.date, 'run', r.startedAt, isEasyRun(r) ? 'longest' : undefined);
}

export interface EasyRow extends EasyRun { id: string; date: string; speed: number; steady: Steady | null }

/** Every finished easy run that has a watch activity, oldest first, read the way the pace rule needs it. */
export function easyRows(state: AppState): EasyRow[] {
  return state.runs.filter(r => !r.practice && r.finishedAt && isEasyRun(r)).sort((a, b) => a.startedAt - b.startedAt).flatMap(r => {
    const seg = r.segs.find(s => s.work && s.done);
    const act = runActivity(state, r);
    if (!seg || !act?.avgHr) return [];
    const speed = seg.actual ?? seg.prescribed!;
    // Strides recorded in the same activity would look like a late surge, so stop at the planned length.
    const planned = seg.km && speed ? (seg.km / speed) * 3600 : undefined;
    const steady = steadyHr(act.laps, planned !== undefined && act.durationSec > planned + 120 ? planned : undefined);
    return [{ id: r.id, date: r.date, speed, avgHr: Math.round(act.avgHr), driftPct: steady?.driftPct, lateHr: steady?.lateThird, slowed: r.slowedTo !== undefined, steady }];
  });
}

interface Baseline { restingHr: number | null; hrv: number | null; sleepHours: number | null }

/** Averages over the 28 days before a date: what "normal" means for this person right now. */
function baselineBefore(state: AppState, date: string): Baseline {
  const days = Array.from({ length: 28 }, (_, i) => state.garminDays[addDays(date, -1 - i)]).filter(Boolean);
  const of = (k: 'restingHr' | 'hrv' | 'sleepHours') => { const v = days.map(d => d[k]).filter((x): x is number => x != null); return v.length >= 7 ? avg(v) : null; };
  return { restingHr: of('restingHr'), hrv: of('hrv'), sleepHours: of('sleepHours') };
}

/** That morning's recovery numbers against normal. "Low" means they would push heart rate up on their own. */
function morningNote(state: AppState, date: string): { note: Note; low: boolean } | null {
  const d = state.garminDays[date];
  if (!d || (d.restingHr == null && d.hrv == null && d.sleepHours == null)) return null;
  const b = baselineBefore(state, date);
  const low = (d.restingHr != null && b.restingHr != null && d.restingHr >= b.restingHr + 5)
    || (d.hrv != null && b.hrv != null && d.hrv <= b.hrv * 0.8)
    || (d.sleepHours != null && d.sleepHours < 6);
  const parts = [
    d.restingHr != null ? `resting heart rate ${d.restingHr}${b.restingHr != null ? ` (your normal is ${Math.round(b.restingHr)})` : ''}` : null,
    d.hrv != null ? `HRV ${Math.round(d.hrv)}${b.hrv != null ? ` (normal ${Math.round(b.hrv)})` : ''}` : null,
    d.sleepHours != null ? `${d.sleepHours.toFixed(1)} h sleep` : null,
  ].filter(Boolean).join(', ');
  return {
    low,
    note: { tone: low ? 'watch' : 'info', text: `That morning: ${parts}. ${low ? 'You came in under-recovered, which pushes heart rate up at any speed.' : 'You were recovered, so tiredness doesn\'t explain the heart rate.'}` },
  };
}

function conditionsNote(r: RunLog, hard: boolean): Note | null {
  if (!r.conditions) return null;
  const fan = r.fan === true ? ', with a fan or breeze' : r.fan === false ? ', with no fan or breeze' : '';
  const heat = r.conditions === 'hot' || (r.conditions === 'warm' && r.fan === false);
  return { tone: 'info', text: `Conditions: ${r.conditions}${fan}.${heat && hard ? ' Heat raises heart rate at any speed. The answer is the same either way: slow down until it is easy.' : ''}` };
}

/** The coach's read of one finished run. Null for time trials and practice. */
export function runDebrief(state: AppState, r: RunLog): Debrief | null {
  if (r.timeTrial || r.practice || !r.finishedAt) return null;
  const act = runActivity(state, r);
  if (!act) return { verdict: 'Waiting for your watch', tone: 'info', notes: [{ tone: 'info', text: 'The read of this run appears after the next Garmin sync.' }] };
  const morning = morningNote(state, r.date);
  const notes: Note[] = [];

  if (isEasyRun(r)) {
    const rows = easyRows(state);
    const row = rows.find(x => x.id === r.id);
    if (!row) return null;
    const hard = isHardEasy(row);
    const st = row.steady;
    notes.push(st
      ? { tone: st.driftPct > DRIFT_MAX_PCT || st.lateThird >= EASY_LATE_HR ? 'watch' : 'good',
          text: `Average ${row.avgHr} bpm at ${row.speed} km/h. Heart rate went from about ${st.early} in the first half to ${st.late} in the second (${st.driftPct > 0 ? 'up' : 'down'} ${Math.abs(st.driftPct)}%), finishing around ${st.lateThird}.${st.driftPct > DRIFT_MAX_PCT ? ` A rise of more than ${DRIFT_MAX_PCT}% at a fixed speed means the effort crept above easy.` : ''}` }
      : { tone: 'info', text: `Average ${row.avgHr} bpm at ${row.speed} km/h. There was no lap detail from the watch, so only the average can be judged.` });
    if (r.slowedTo !== undefined) notes.push({ tone: 'watch', text: `You slowed to ${r.slowedTo} km/h part-way to keep it easy. That was the right call, and it tells the app ${row.speed} km/h is a little quick for now.` });
    const prev = rows.filter(x => x.speed === row.speed && x.date < row.date).at(-1);
    if (prev) {
      const d = row.avgHr - prev.avgHr;
      notes.push({ tone: d <= -2 ? 'good' : d >= 3 ? 'watch' : 'info',
        text: `Last time at this speed (${shortDate(prev.date)}): average ${prev.avgHr}${prev.steady ? `, rise ${prev.steady.driftPct}%` : ''}. ${d <= -2 ? `${-d} beats lower today for the same speed, which is what getting fitter looks like.` : d >= 3 ? `${d} beats higher today.` : 'About the same today.'}` });
    }
    if (morning) notes.push(morning.note);
    const cond = conditionsNote(r, hard);
    if (cond) notes.push(cond);
    const [verdict, tone]: [string, Note['tone']] = r.slowedTo !== undefined ? ['Slowed down to keep it easy', 'watch']
      : row.avgHr >= EASY_HR_HIGH ? ['Too hard for an easy day', 'watch']
      : hard ? ['Started easy, didn\'t stay easy', 'watch']
      : isComfortableEasy(row) ? ['Properly easy', 'good'] : ['Easy enough', 'good'];
    const next = hard
      ? `Next easy run: keep your heart rate under ${EASY_LATE_HR}. When it crosses, drop 0.3–0.5 km/h, and answer Yes to "Did you slow down" when you finish.`
      : isComfortableEasy(row) ? 'Next easy run: the same again. Three like this and the app suggests going 0.2 km/h quicker.' : 'Next easy run: the same speed.';
    return { verdict, tone, notes, next };
  }

  // Intervals and threshold
  const work = r.segs.filter(s => s.work && s.prescribed !== undefined);
  const done = work.filter(s => s.done);
  const speed = done[0] ? done[0].actual ?? done[0].prescribed! : undefined;
  const repLaps = (run: RunLog, a: GarminActivity) => {
    const reps = run.segs.filter(s => s.work && s.done && s.km && s.prescribed).map(s => ({ km: s.km!, speed: s.actual ?? s.prescribed! }));
    return matchRepLaps(a.laps, reps);
  };
  const nums = (laps: { avgHr: number | null }[]) => laps.map(l => l.avgHr).filter((x): x is number => x != null);
  const repHr = (run: RunLog, a: GarminActivity) => { const m = repLaps(run, a); return m ? nums(m.stoppedEarly ? m.reps.slice(0, -1) : m.reps) : null; };
  const matched = repLaps(r, act);
  const hrs = repHr(r, act);
  const stopped = !!matched?.stoppedEarly;
  const full = hrs?.length ?? 0;
  if (matched && full < done.length) notes.push({ tone: 'watch', text: `The watch shows ${full} full rep${full === 1 ? '' : 's'}${stopped ? ' and one cut short' : ''}, against ${done.length} ticked. Next time leave an unfinished rep unticked and choose "Couldn't finish all reps", so the speed rule knows.` });
  notes.push({ tone: done.length < work.length ? 'watch' : 'info', text: `${done.length} of ${work.length} reps done${speed !== undefined ? ` at ${speed} km/h` : ''}.${r.speedAfter !== undefined && r.speedBefore !== undefined ? ` Speed for next time: ${r.speedAfter} km/h${r.speedAfter === r.speedBefore ? ' (unchanged)' : ''}.` : ''}` });
  if (hrs && hrs.length >= 2) {
    const rise = Math.round(hrs.at(-1)! - hrs[0]);
    const list = hrs.map(h => Math.round(h)).join(', ');
    notes.push(r.type === 'threshold'
      ? { tone: rise > 8 ? 'watch' : 'good', text: `Heart rate by rep: ${list}. ${rise > 8 ? `It climbed ${rise} beats from the first rep to the last. Threshold work should settle, so this speed is still a stretch.` : 'Steady across the reps, which is what threshold work should look like.'}` }
      : { tone: 'info', text: `Heart rate by rep: ${list}${act.maxHr != null ? `, peaking at ${Math.round(act.maxHr)}` : ''}. A climb across interval reps is expected.` });
    const rec = matched ? nums(matched.recoveries) : [];
    if (r.type === 'intervals' && rec.length >= 2) {
      const stuck = rec.at(-1)! >= hrs[0] - 5;
      notes.push({ tone: stuck ? 'watch' : 'info', text: `Between reps your heart rate averaged ${rec.map(h => Math.round(h)).join(', ')}. ${stuck ? 'By the end it was barely coming down, so each rep started from a higher point. That means the speed is too high or the recoveries too short for now.' : 'It was coming down between reps, which is what the recoveries are for.'}` });
    }
  } else if (done.length) {
    notes.push({ tone: 'info', text: 'The watch laps couldn\'t be matched to the reps, so there is no heart rate per rep. Press lap at the start and end of each rep.' });
  }
  const prev = state.runs.filter(x => x.type === r.type && !x.practice && x.finishedAt && !x.timeTrial && !isEasyRun(x) && x.startedAt < r.startedAt).sort((a, b) => a.startedAt - b.startedAt).at(-1);
  const prevAct = prev && runActivity(state, prev);
  const prevHrs = prev && prevAct ? repHr(prev, prevAct) : null;
  const prevSpeed = prev?.segs.find(s => s.work && s.done);
  if (hrs?.length && prevHrs?.length && prevSpeed && (prevSpeed.actual ?? prevSpeed.prescribed) === speed) {
    const a = Math.round(avg(hrs)!), b = Math.round(avg(prevHrs)!);
    notes.push({ tone: a <= b - 2 ? 'good' : 'info', text: `Same speed last time (${shortDate(prev!.date)}): average rep heart rate ${b}, today ${a}.${a <= b - 2 ? ' Lower for the same speed is progress.' : ''}` });
  }
  if (morning) notes.push(morning.note);
  const cond = conditionsNote(r, r.answer === 'dnf');
  if (cond) notes.push(cond);
  const [verdict, tone, next]: [string, Note['tone'], string] = r.answer === 'yes' && !stopped ? ['Strong, with room to spare', 'good', 'Next time: 0.3 km/h quicker.']
    : r.answer === 'no' && !stopped ? ['On the limit, as intended', 'good', 'Next time: the same speed. Aim to finish the last rep with one more in you.']
    : r.answer === 'dnf' || stopped ? [morning?.low ? 'Too much today, and you came in under-recovered' : 'Too much today', 'watch', 'Next time: the same speed. If it happens again the app takes 0.3 km/h off.']
    : ['Logged', 'info', ''];
  // A speed reset after this run (from a review) overrides what the weekly rule said at the time.
  const latest = !state.runs.some(x => x.type === r.type && !x.practice && x.finishedAt && !x.timeTrial && x.startedAt > r.startedAt);
  const now = currentSpeeds(state)[r.type as 'intervals' | 'threshold'];
  if (latest && r.speedAfter !== undefined && now !== r.speedAfter) {
    return { verdict, tone, notes, next: `Next time: ${now} km/h. The speed was reset after this session.` };
  }
  return { verdict, tone, notes, next: next || undefined };
}

/** The most recent finished run from today or yesterday, for the home screen. */
export function latestRunForDebrief(state: AppState, today: string): RunLog | undefined {
  return state.runs.filter(r => !r.practice && r.finishedAt && !r.timeTrial && r.slotIdx !== null && r.date >= addDays(today, -1) && r.date <= today)
    .sort((a, b) => a.startedAt - b.startedAt).at(-1);
}

export interface WeekReview { week: number; from: string; to: string; complete: boolean; notes: Note[]; focus: string }

/** Review of one training week (Monday to Sunday). Null before the week has anything in it. */
export function weeklyReview(state: AppState, week: number, today: string): WeekReview | null {
  const p = state.program!;
  if (week < 1 || week > p.weeks) return null;
  const from = addDays(p.start, (week - 1) * 7);
  const to = addDays(from, 6);
  if (today < from) return null;
  const inWeek = (d: string) => d >= from && d <= to;
  const before = (d: string) => d >= addDays(from, -7) && d < from;
  const complete = today >= to;
  const notes: Note[] = [];

  const slots = state.schedule.filter(s => s.week === week);
  const planned = slots.filter(s => !s.skipped).length;
  const doneSlots = slots.filter(s => s.done && !s.skipped).length;
  const due = slots.filter(s => !s.skipped && s.date <= today).length;
  const missed = complete ? planned - doneSlots : 0;
  notes.push({ tone: doneSlots >= (complete ? planned : due) ? 'good' : missed >= 2 ? 'watch' : 'info', text: `Sessions: ${doneSlots} of ${planned} done${complete ? '' : ` (${due} due so far)`}.` });

  const runs = state.runs.filter(r => !r.practice && r.finishedAt);
  const kmOf = (ok: (d: string) => boolean) => round1(runs.filter(r => ok(r.date)).reduce((a, r) => a + (r.timeTrial ? 5 : r.segs.filter(s => s.done).reduce((b, s) => b + (s.km ?? 0), 0)), 0));
  // Week 1 has no earlier week of logged running to compare with.
  const km = kmOf(inWeek), prevKm = week > 1 ? kmOf(before) : 0;
  const kmJump = complete && prevKm > 0 && km > prevKm * 1.2;
  notes.push({ tone: kmJump ? 'watch' : 'info', text: `Running: ${km} km${prevKm > 0 ? `, against ${prevKm} km the week before` : ''}.${kmJump ? ' That is a jump of more than 20%.' : ''}` });

  const loadOf = (ok: (d: string) => boolean) => Math.round(state.garminActs.filter(a => ok(a.date)).reduce((a, x) => a + (x.trainingLoad ?? 0), 0));
  const load = loadOf(inWeek);
  const usual = Math.round(loadOf(d => d >= addDays(from, -28) && d < from) / 4);
  const loadSpike = complete && usual > 0 && load > usual * 1.5;
  if (load > 0) notes.push({ tone: loadSpike ? 'watch' : 'info', text: `Training load from your watch: ${load}${usual > 0 ? `, against a four-week average of ${usual}` : ''}.${loadSpike ? ' More than one and a half times your usual week.' : ''}` });

  const days = Array.from({ length: 7 }, (_, i) => state.garminDays[addDays(from, i)]).filter(Boolean);
  const wk = (k: 'restingHr' | 'hrv' | 'sleepHours') => avg(days.map(d => d[k]).filter((x): x is number => x != null));
  const base = baselineBefore(state, from);
  const rhr = wk('restingHr'), hrv = wk('hrv'), sleep = wk('sleepHours');
  const recoveryLow = (rhr != null && base.restingHr != null && rhr >= base.restingHr + 3) || (hrv != null && base.hrv != null && hrv <= base.hrv * 0.9) || (sleep != null && sleep < 6.5);
  if (rhr != null || hrv != null || sleep != null) {
    notes.push({ tone: recoveryLow ? 'watch' : 'good', text: 'Recovery: ' + [
      rhr != null ? `resting heart rate ${Math.round(rhr)}${base.restingHr != null ? ` (normal ${Math.round(base.restingHr)})` : ''}` : null,
      hrv != null ? `HRV ${Math.round(hrv)}${base.hrv != null ? ` (normal ${Math.round(base.hrv)})` : ''}` : null,
      sleep != null ? `${sleep.toFixed(1)} h sleep a night` : null,
    ].filter(Boolean).join(', ') + '.' });
  }

  const ANSWER = { yes: 'room to spare', no: 'on the limit', dnf: 'not finished' };
  const key = (type: 'intervals' | 'threshold') => runs.filter(r => r.type === type && inWeek(r.date) && r.answer).at(-1)?.answer;
  const iv = key('intervals'), th = key('threshold');
  const easy = easyRows(state).filter(r => inWeek(r.date));
  const easyHard = easy.filter(isHardEasy).length;
  const quality = [iv ? `intervals ${ANSWER[iv]}` : null, th ? `threshold ${ANSWER[th]}` : null, easy.length ? (easyHard ? `${easyHard} of ${easy.length} easy runs didn't stay easy` : 'easy runs stayed easy') : null].filter(Boolean);
  if (quality.length) notes.push({ tone: iv === 'dnf' || th === 'dnf' || easyHard ? 'watch' : 'good', text: `Runs: ${quality.join(', ')}.` });

  const gym = state.sessions.filter(s => !s.practice && s.finishedAt && inWeek(s.date));
  const sets = state.sets.filter(x => gym.some(s => s.id === x.sessionId) && !x.rampUp && !x.extra).length;
  const worse = state.checkins.filter(c => gym.some(s => s.id === c.sessionId) && (c.knee === 'worse' || c.back === 'worse')).length;
  if (gym.length) notes.push({ tone: worse ? 'watch' : 'info', text: `Gym: ${gym.length} session${gym.length > 1 ? 's' : ''}, ${sets} sets logged.${worse ? ` Knee or back was worse the next morning ${worse === 1 ? 'once' : `${worse} times`}.` : ''}` });

  const eaten = Array.from({ length: 7 }, (_, i) => state.garminDays[addDays(from, i)]?.kcalIn).filter((k): k is number => k != null && k >= 1200);
  const scale = state.weights.filter(w => inWeek(w.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (eaten.length || scale.length) {
    const avgEaten = eaten.length ? Math.round(avg(eaten)! / 10) * 10 : null;
    notes.push({ tone: 'info', text: `Food and weight: ${avgEaten !== null ? `${avgEaten.toLocaleString('en-AU')} kcal a day on ${eaten.length} logged day${eaten.length === 1 ? '' : 's'}` : 'no food logged'}; ${scale.length ? `${scale.length} weigh-in${scale.length === 1 ? '' : 's'}${scale.length >= 2 ? `, ${scale[0].kg} to ${scale.at(-1)!.kg} kg` : ''}` : 'no weigh-ins'}.` });
  }

  const mob = mobilityThisWeek(state, from);
  const target = p.mobilityTarget ?? [4, 5];
  notes.push({ tone: mob >= target[0] ? 'good' : complete ? 'watch' : 'info', text: `Mobility: ${mob} evening${mob === 1 ? '' : 's'}, target ${mobilityTargetText(state)}.` });

  const focus = recoveryLow ? 'Recovery is the limiter right now. Protect sleep before adding anything, and take the readiness suggestions when they appear.'
    : missed >= 2 ? 'Consistency first. Getting every planned session in matters more than any single hard one.'
    : iv === 'dnf' || th === 'dnf' ? 'Hold the hard runs at the same speed until you finish every rep.'
    : easyHard ? 'Slow the easy runs down. They only do their job if they stay easy, and that protects Wednesday and Saturday.'
    : loadSpike || kmJump ? 'A big step up in work. Hold next week steady rather than adding more.'
    : worse ? 'Knee or back flared after a gym day. Follow the hold the app suggests before pushing those lifts.'
    : complete ? 'On track. Repeat the week and let the progression rules do the work.' : 'On track so far.';
  return { week, from, to, complete, notes, focus };
}

/** Which week's review to show: on the home screen from its Sunday until the Tuesday after; on Progress, the latest started. */
export function reviewToShow(state: AppState, today: string, where: 'home' | 'progress'): WeekReview | null {
  const p = state.program!;
  if (today < p.start) return null;
  const current = Math.min(p.weeks, Math.floor((Date.parse(today) - Date.parse(p.start)) / 86400000 / 7) + 1);
  if (where === 'progress') return weeklyReview(state, current, today);
  for (const w of [current, current - 1]) {
    const r = weeklyReview(state, w, today);
    if (r && today >= r.to && today <= addDays(r.to, 2)) return r;
  }
  return null;
}
