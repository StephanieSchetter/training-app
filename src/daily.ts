// Things the app works out by itself each day: missed sessions (spec 4.2) and the resting-HR pull-back alert (8.2).
import { restingHrAlert } from './engine/running';
import { addDays, catchUp } from './engine/schedule';
import { currentSpeeds, getState, today, update } from './store';

const NAMES: Record<string, string> = { easy: 'Easy Run', intervals: 'Intervals', threshold: 'Threshold Run', gymA: 'Gym A', gymB: 'Gym B', gymC: 'Gym C', gymD: 'Gym D' };
const nice = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });

export function dailyChecks() {
  const t = today();
  const s0 = getState();
  if (!s0.program || t < s0.program.start) return;

  // Speeds reset at a review arrive in the program file and are applied once.
  const pending = (s0.program.running?.resets ?? []).filter(r => !(s0.speeds?.resets ?? []).includes(r.from));
  if (pending.length) {
    update(s => {
      let sp = currentSpeeds(s);
      for (const r of pending) sp = { ...sp, intervals: r.intervals ?? sp.intervals, threshold: r.threshold ?? sp.threshold, resets: [...(sp.resets ?? []), r.from] };
      s.speeds = sp;
    });
  }

  // A slot whose session or run was logged and finished is done, whatever this copy of the schedule says
  // (29 Oct 2026: an old copy without the done marks shifted three logged sessions as missed).
  const logged = new Set([...s0.sessions, ...s0.runs].filter(x => x.finishedAt && !x.practice).map(x => x.slotIdx));
  if (s0.schedule.some(x => !x.done && logged.has(x.idx))) {
    update(s => { for (const x of s.schedule) if (!x.done && logged.has(x.idx)) x.done = true; });
  }

  // A missed day pushes every remaining session later, so the missed one lands on today.
  // Development only: ?nocatchup lets a scripted test jump to a later date without the schedule following it.
  const frozen = import.meta.env.DEV && new URLSearchParams(location.search).has('nocatchup');
  const overdue = frozen ? [] : s0.schedule.filter(x => !x.done && !logged.has(x.idx) && !x.skipped && x.date < t).sort((a, b) => a.date.localeCompare(b.date));
  const active = [...s0.sessions.filter(x => !x.finishedAt && !x.practice).map(x => x.slotIdx), ...s0.runs.filter(x => !x.finishedAt && !x.practice).map(x => x.slotIdx)];
  if (overdue.length && !overdue.some(x => active.includes(x.idx))) {
    const first = overdue[0];
    const id = `missed-${first.date}-${t}`;
    update(s => {
      const noTraining = new Set(Object.keys(s.days).filter(d => s.days[d] === 'travel-none'));
      s.schedule = catchUp(s.schedule, first.date, t, noTraining);
      const lands = s.schedule.find(x => x.idx === first.idx)!.date;
      if (!s.notices.some(n => n.id === id)) {
        s.notices.push({ id, date: t, text: `${NAMES[first.type]} on ${nice(first.date)} wasn't logged, so the remaining sessions have moved later. It is now ${lands === t ? "today's session" : `on ${nice(lands)}`}.` });
      }
    });
  }

  // Resting HR 5+ above the 30-day median, three days running -> suggest two full days off.
  const s1 = getState();
  const dates = Object.keys(s1.garminDays).filter(d => d <= t && s1.garminDays[d].restingHr != null).sort();
  const lastDate = dates.at(-1);
  if (lastDate && lastDate >= addDays(t, -1)) {
    const values = dates.slice(-33).map(d => s1.garminDays[d].restingHr as number);
    const recent = s1.alerts.some(a => a.kind === 'rhr-high' && a.date >= addDays(t, -5));
    if (!recent && restingHrAlert(values)) {
      update(s => { s.alerts.push({ id: `rhr-${lastDate}`, kind: 'rhr-high', date: t, status: 'open' }); });
    }
  }
}
