// Things the app works out by itself each day: missed sessions (spec 4.2) and the resting-HR pull-back alert (8.2).
import { restingHrAlert } from './engine/running';
import { addDays, shiftFrom } from './engine/schedule';
import { getState, today, update } from './store';

const NAMES: Record<string, string> = { easy: 'Easy Run', intervals: 'Intervals', threshold: 'Threshold Run', gymA: 'Gym A', gymB: 'Gym B', gymC: 'Gym C', gymD: 'Gym D' };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const nice = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });

export function dailyChecks() {
  const t = today();
  const s0 = getState();
  if (!s0.program || t < s0.program.start) return;

  // A missed day pushes every remaining session later, so the missed one lands on today.
  // Development only: ?nocatchup lets a scripted test jump to a later date without the schedule following it.
  const frozen = import.meta.env.DEV && new URLSearchParams(location.search).has('nocatchup');
  const overdue = frozen ? [] : s0.schedule.filter(x => !x.done && !x.skipped && x.date < t).sort((a, b) => a.date.localeCompare(b.date));
  const active = [...s0.sessions.filter(x => !x.finishedAt && !x.practice).map(x => x.slotIdx), ...s0.runs.filter(x => !x.finishedAt && !x.practice).map(x => x.slotIdx)];
  if (overdue.length && !overdue.some(x => active.includes(x.idx))) {
    const first = overdue[0];
    const days = daysBetween(first.date, t);
    const id = `missed-${first.date}-${t}`;
    update(s => {
      s.schedule = shiftFrom(s.schedule, first.date, days);
      if (!s.notices.some(n => n.id === id)) {
        s.notices.push({ id, date: t, text: `${NAMES[first.type]} on ${nice(first.date)} wasn't logged, so every remaining session has moved ${days} day${days > 1 ? 's' : ''} later. It is now today's session.` });
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
