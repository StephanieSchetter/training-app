// Matching logged sessions to Garmin activities (spec 7.3 and 9).

export interface Activity {
  id: number; type: 'run' | 'strength'; startLocal: string; date: string; durationSec: number;
  avgHr: number | null; maxHr: number | null; laps: { sec: number; km: number; avgHr: number | null }[];
}

/** Minutes since midnight from a Garmin local time like "2026-10-01 15:59:01". */
const clockMinutes = (startLocal: string) => Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14, 16));

/** Same date and kind; if there are several, the one that started closest to when the session was logged. */
export function matchActivity<T extends Activity>(acts: T[], date: string, type: 'run' | 'strength', startedAt: number): T | undefined {
  const sameDay = acts.filter(a => a.date === date && a.type === type);
  if (sameDay.length < 2) return sameDay[0];
  const d = new Date(startedAt);
  const logged = d.getHours() * 60 + d.getMinutes();
  return sameDay.reduce((best, a) => (Math.abs(clockMinutes(a.startLocal) - logged) < Math.abs(clockMinutes(best.startLocal) - logged) ? a : best));
}

export interface Rep { km: number; speed: number }

/**
 * Laps to reps, in order. A lap counts as a rep when it lasted about as long as the rep should
 * (treadmill distance on the watch is unreliable; time is not). If there are fewer such laps than
 * reps, nothing is matched and the session average is used instead. A warm-up the same length as a
 * rep comes first, so when there are extra candidates the last ones are the reps.
 */
export function matchLaps<L extends { sec: number }>(laps: L[], reps: Rep[]): L[] | null {
  if (!reps.length) return null;
  const want = reps.map(r => (r.km / r.speed) * 3600);
  const tol = 0.12;
  const sameLength = want.every(w => Math.abs(w - want[0]) < 1);
  if (!sameLength) return null;
  const candidates = laps.filter(l => Math.abs(l.sec - want[0]) <= want[0] * tol);
  if (candidates.length < reps.length) return null;
  return candidates.slice(-reps.length);
}
