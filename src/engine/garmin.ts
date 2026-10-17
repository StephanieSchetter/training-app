// Matching logged sessions to Garmin activities (spec 7.3 and 9).

export interface Activity {
  id: number; type: 'run' | 'strength'; startLocal: string; date: string; durationSec: number;
  avgHr: number | null; maxHr: number | null; laps: { sec: number; km: number; avgHr: number | null }[];
}

/** Minutes since midnight from a Garmin local time like "2026-10-01 15:59:01". */
const clockMinutes = (startLocal: string) => Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14, 16));

/**
 * Same date and kind; if there are several, the one that started closest to when the session was logged.
 * prefer 'longest' takes the longest instead: an easy run whose strides were recorded as their own activity.
 */
export function matchActivity<T extends Activity>(acts: T[], date: string, type: 'run' | 'strength', startedAt: number, prefer?: 'longest'): T | undefined {
  const sameDay = acts.filter(a => a.date === date && a.type === type);
  if (sameDay.length < 2) return sameDay[0];
  if (prefer === 'longest') return sameDay.reduce((best, a) => (a.durationSec > best.durationSec ? a : best));
  const d = new Date(startedAt);
  const logged = d.getHours() * 60 + d.getMinutes();
  return sameDay.reduce((best, a) => (Math.abs(clockMinutes(a.startLocal) - logged) < Math.abs(clockMinutes(best.startLocal) - logged) ? a : best));
}

export interface Rep { km: number; speed: number }

export interface RepLaps<L> { reps: L[]; /** The lap after each rep but the last. */ recoveries: L[]; /** The final entry in reps is a rep that was cut short. */ stoppedEarly: boolean }

/**
 * Laps to reps using the shape of the session: rep, recovery, rep, recovery... A lap is rep-length when it
 * lasted about as long as the rep should; real reps have exactly one other lap between them. That keeps
 * out a stretch of warm-up that happens to be the same length (14 Oct 2026: it was being read as rep 1),
 * and it finds the reps even when fewer were finished than planned. A last rep that was cut short is
 * included and flagged. With no recovery laps to go on, it falls back to the last rep-length laps.
 */
export function matchRepLaps<L extends { sec: number }>(laps: L[], reps: Rep[]): RepLaps<L> | null {
  if (!reps.length) return null;
  const want = (reps[0].km / reps[0].speed) * 3600;
  if (!reps.every(r => Math.abs((r.km / r.speed) * 3600 - want) < 1)) return null;
  const tol = 0.12;
  const isRep = (l: L | undefined) => !!l && Math.abs(l.sec - want) <= want * tol;
  // A rep can be one lap, or up to three in a row when the watch's 1 km auto-lap split it (17 Oct 2026).
  type Span = { s: number; e: number };
  const spans: Span[] = [];
  for (let s = 0; s < laps.length; s++) {
    let total = 0;
    for (let e = s; e < Math.min(laps.length, s + 3); e++) {
      total += laps[e].sec;
      if (Math.abs(total - want) <= want * tol) { spans.push({ s, e }); break; }
      if (total > want * (1 + tol)) break;
    }
  }
  const joined = (sp: Span): L => {
    if (sp.s === sp.e) return laps[sp.s];
    const part = laps.slice(sp.s, sp.e + 1) as unknown as { sec: number; km?: number; avgHr?: number | null }[];
    const sec = part.reduce((a, l) => a + l.sec, 0);
    const hr = part.every(l => l.avgHr != null) ? part.reduce((a, l) => a + l.avgHr! * l.sec, 0) / sec : null;
    return { ...laps[sp.s], sec, km: part.reduce((a, l) => a + (l.km ?? 0), 0), avgHr: hr } as unknown as L;
  };
  // Real reps have exactly one other lap (the recovery) between them.
  let best: Span[] = [];
  for (const first of spans) {
    const chain = [first];
    for (let next = spans.find(x => x.s === first.e + 2); next && !isRep(laps[chain.at(-1)!.e + 1]); next = spans.find(x => x.s === next!.e + 2)) chain.push(next);
    if (chain.length >= best.length) best = chain;
  }
  if (best.length >= 2) {
    const idx = best.slice(-reps.length);
    const last = idx.at(-1)!.e;
    const cut = laps[last + 2];
    const stoppedEarly = idx.length < reps.length && !!cut && !isRep(laps[last + 1]) && cut.sec >= 20 && cut.sec < want * (1 - tol);
    return {
      reps: [...idx.map(joined), ...(stoppedEarly ? [cut] : [])],
      recoveries: [...idx.slice(0, -1).map(sp => laps[sp.e + 1]), ...(stoppedEarly ? [laps[last + 1]] : [])],
      stoppedEarly,
    };
  }
  const candidates = laps.filter(isRep);
  return candidates.length >= reps.length ? { reps: candidates.slice(-reps.length), recoveries: [], stoppedEarly: false } : null;
}

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
