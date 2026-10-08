// Upload/download between the phone and the database (spec section 10).
// The phone saves first and is always usable; this catches the database up whenever there is signal.
import { createClient, Session } from '@supabase/supabase-js';
import { get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { AppState, getState, setProgram, subscribe, update } from './store';

// Public values: safe to ship. Row-level security in the database is what protects the data.
const SUPABASE_URL = 'https://cycpaeykmufxxkhmrvdf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_4Kf4zEgOLILz11Vyyg7GYg_AaUgtnrs';

/** Development only: open the app with ?local to skip sign-in and the database. */
export const LOCAL_ONLY = import.meta.env.DEV && new URLSearchParams(location.search).has('local');

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Rec { kind: string; id: string; data: unknown }
interface SyncDisk { pushed: Record<string, number>; since: Record<string, number>; lastPull: string | null; reads?: number }
const READS_VERSION = 3;
/** Shown in Settings so it's easy to confirm a phone has picked up the latest update. */
export const APP_VERSION = 20;
export interface SyncView {
  auth: 'loading' | 'in' | 'out';
  pending: number;
  /** When the oldest waiting item was first queued. */
  oldest: number | null;
  error: string | null;
}

const DISK_KEY = 'training-app-sync-v1';
const DAY = 24 * 3600 * 1000;
let disk: SyncDisk = { pushed: {}, since: {}, lastPull: null };
let session: Session | null = null;
let view: SyncView = { auth: LOCAL_ONLY ? 'in' : 'loading', pending: 0, oldest: null, error: null };
const listeners = new Set<() => void>();
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function setView(patch: Partial<SyncView>) {
  view = { ...view, ...patch };
  listeners.forEach(l => l());
}

export function useSync(): SyncView {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => view);
}

export const waitingTooLong = (v: SyncView) => v.oldest !== null && Date.now() - v.oldest > DAY;

// cyrb53: small, fast string hash, enough to tell "changed since last upload".
function hash(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const hashOf = (data: unknown) => hash(JSON.stringify(data));
const keyOf = (r: { kind: string; id: string }) => `${r.kind}/${r.id}`;

/** Everything on the phone that belongs in the database. */
function localRecords(s: AppState): Map<string, Rec> {
  const out = new Map<string, Rec>();
  const add = (kind: string, id: string, data: unknown) => out.set(`${kind}/${id}`, { kind, id, data });
  for (const x of s.sessions) add('session', x.id, x);
  for (const x of s.sets) add('set', x.id, x);
  for (const x of s.runs) add('run', x.id, x);
  for (const x of s.alerts) add('alert', x.id, x);
  for (const x of s.checkins) add('checkin', x.id, x);
  if (s.program) {
    add('meta', 'reductions', s.reductions);
    add('meta', 'tempSwaps', s.tempSwaps);
    add('meta', 'notices', s.notices);
    add('meta', 'weights', s.weights);
    add('meta', 'stretch', s.stretch);
    add('meta', 'physio', s.physio);
  }
  if (s.speeds) add('meta', 'speeds', s.speeds);
  if (s.program) {
    add('meta', 'program', s.program);
    for (const p of s.profiles) add('profile', p.id, p);
    add('meta', 'schedule', s.schedule);
    add('meta', 'stints', s.stints);
    add('meta', 'days', s.days);
    add('meta', 'restOverrides', s.restOverrides);
  }
  return out;
}

function applyRemote(s: AppState, r: Rec & { deleted: boolean }) {
  const upsert = <T extends { id: string }>(list: T[], row: T) => {
    const i = list.findIndex(x => x.id === row.id);
    if (i >= 0) list[i] = row; else list.push(row);
  };
  if (r.kind === 'session') {
    if (r.deleted) s.sessions = s.sessions.filter(x => x.id !== r.id);
    else upsert(s.sessions, r.data as AppState['sessions'][number]);
  } else if (r.kind === 'set') {
    if (r.deleted) s.sets = s.sets.filter(x => x.id !== r.id);
    else upsert(s.sets, r.data as AppState['sets'][number]);
  } else if (r.kind === 'run') {
    if (r.deleted) s.runs = s.runs.filter(x => x.id !== r.id);
    else upsert(s.runs, r.data as AppState['runs'][number]);
  } else if (r.kind === 'alert') {
    if (r.deleted) s.alerts = s.alerts.filter(x => x.id !== r.id);
    else upsert(s.alerts, r.data as AppState['alerts'][number]);
  } else if (r.kind === 'checkin') {
    if (r.deleted) s.checkins = s.checkins.filter(x => x.id !== r.id);
    else upsert(s.checkins, r.data as AppState['checkins'][number]);
  } else if (r.kind === 'garmin_day' && !r.deleted) {
    s.garminDays[r.id] = r.data as AppState['garminDays'][string];
  } else if (r.kind === 'garmin_activity' && !r.deleted) {
    upsert(s.garminActs as unknown as { id: string }[], r.data as { id: string });
  } else if (r.kind === 'meta' && r.id === 'garmin_status' && !r.deleted) {
    s.garminStatus = r.data as AppState['garminStatus'];
  } else if (r.kind === 'profile' && !r.deleted) {
    upsert(s.profiles, r.data as AppState['profiles'][number]);
  } else if (r.kind === 'meta' && !r.deleted) {
    if (r.id === 'program') {
      const p = r.data as NonNullable<AppState['program']>;
      setProgram(s, p);
    } else if (r.id === 'schedule') s.schedule = r.data as AppState['schedule'];
    else if (r.id === 'stints') s.stints = r.data as AppState['stints'];
    else if (r.id === 'days') s.days = r.data as AppState['days'];
    else if (r.id === 'restOverrides') s.restOverrides = r.data as AppState['restOverrides'];
    else if (r.id === 'speeds') s.speeds = r.data as AppState['speeds'];
    else if (r.id === 'reductions') s.reductions = r.data as AppState['reductions'];
    else if (r.id === 'tempSwaps') s.tempSwaps = r.data as AppState['tempSwaps'];
    else if (r.id === 'notices') s.notices = r.data as AppState['notices'];
    else if (r.id === 'weights') s.weights = r.data as AppState['weights'];
    else if (r.id === 'stretch') s.stretch = r.data as AppState['stretch'];
    else if (r.id === 'physio') s.physio = r.data as AppState['physio'];
  }
}

/** Records this phone writes. Everything else (Garmin data) is written by the daily pull and only read here. */
const ownedByPhone = (r: { kind: string; id: string }) =>
  ['session', 'set', 'run', 'alert', 'profile', 'checkin'].includes(r.kind) || (r.kind === 'meta' && r.id !== 'garmin_status');

interface Pending { upserts: Rec[]; deletes: { kind: string; id: string }[] }

function pendingNow(): Pending {
  const local = localRecords(getState());
  const upserts = [...local.values()].filter(r => disk.pushed[keyOf(r)] !== hashOf(r.data));
  const deletes = Object.keys(disk.pushed).filter(k => !local.has(k)).map(k => {
    const i = k.indexOf('/');
    return { kind: k.slice(0, i), id: k.slice(i + 1) };
  }).filter(ownedByPhone);
  return { upserts, deletes };
}

function refreshCount(): Pending {
  const p = pendingNow();
  const keys = new Set([...p.upserts, ...p.deletes].map(keyOf));
  const now = Date.now();
  for (const k of keys) disk.since[k] ??= now;
  for (const k of Object.keys(disk.since)) if (!keys.has(k)) delete disk.since[k];
  const times = Object.values(disk.since);
  setView({ pending: keys.size, oldest: times.length ? Math.min(...times) : null });
  set(DISK_KEY, disk);
  return p;
}

async function pull() {
  let from = 0;
  let newest = disk.lastPull;
  const incoming: (Rec & { deleted: boolean; updated_at: string })[] = [];
  for (;;) {
    // The Garmin sign-in token lives in the same table; the app has no use for it and never downloads it.
    let q = supabase.from('records').select('kind,id,data,deleted,updated_at').neq('kind', 'secret').order('updated_at').range(from, from + 999);
    // Re-read a short overlap each time: a record stamped slightly earlier can land slightly later.
    if (disk.lastPull) q = q.gt('updated_at', new Date(Date.parse(disk.lastPull) - 5 * 60 * 1000).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    incoming.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  if (!incoming.length) return;
  const local = localRecords(getState());
  const accepted = incoming.filter(r => {
    const k = keyOf(r);
    const mine = local.get(k);
    // A change made on this phone since its last upload wins; otherwise take the database's copy.
    const changedHere = mine !== undefined && disk.pushed[k] !== undefined && disk.pushed[k] !== hashOf(mine.data);
    return !changedHere;
  });
  update(s => accepted.forEach(r => applyRemote(s, r)));
  // Only track what this version of the app actually understands and now holds. A record written by a
  // newer version (a kind this one doesn't know) must never look like "deleted here".
  const held = localRecords(getState());
  for (const r of accepted) {
    const k = keyOf(r);
    if (!ownedByPhone(r) || r.deleted || !held.has(k)) delete disk.pushed[k];
    else disk.pushed[k] = hashOf(r.data);
  }
  for (const r of incoming) if (!newest || r.updated_at > newest) newest = r.updated_at;
  disk.lastPull = newest;
}

async function push(p: Pending) {
  const user_id = session!.user.id;
  const stamp = new Date().toISOString();
  const rows = [
    ...p.upserts.map(r => ({ user_id, kind: r.kind, id: r.id, data: r.data, deleted: false, updated_at: stamp })),
    ...p.deletes.map(r => ({ user_id, kind: r.kind, id: r.id, data: {}, deleted: true, updated_at: stamp })),
  ];
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('records').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,kind,id' });
    if (error) throw error;
  }
  for (const r of p.upserts) disk.pushed[keyOf(r)] = hashOf(r.data);
  for (const r of p.deletes) delete disk.pushed[keyOf(r)];
}

export async function syncNow() {
  if (LOCAL_ONLY || busy || !session) { refreshCount(); return; }
  if (!navigator.onLine) { refreshCount(); return; }
  busy = true;
  try {
    await pull();
    const p = refreshCount();
    if (p.upserts.length || p.deletes.length) await push(p);
    setView({ error: null });
  } catch (e) {
    // Never interrupt logging: the items stay queued and the badge keeps counting.
    setView({ error: e instanceof Error ? e.message : String((e as { message?: string }).message ?? e) });
  } finally {
    busy = false;
    refreshCount();
  }
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

export async function initSync() {
  disk = (await get(DISK_KEY)) ?? disk;
  // When a new version of the app understands more kinds of record (e.g. Garmin data), download
  // everything once more so nothing an older version skipped stays missing. Raise the number to trigger it.
  if (disk.reads !== READS_VERSION) { disk.lastPull = null; disk.reads = READS_VERSION; }
  // An early version tracked records it doesn't own (Garmin data) and then tried to delete them. Forget those.
  for (const k of Object.keys(disk.pushed)) {
    const i = k.indexOf('/');
    if (!ownedByPhone({ kind: k.slice(0, i), id: k.slice(i + 1) })) { delete disk.pushed[k]; delete disk.since[k]; }
  }
  subscribe(() => { refreshCount(); schedule(1500); });
  if (LOCAL_ONLY) return;
  window.addEventListener('online', () => schedule(200));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(200); });
  setInterval(() => { if (view.pending) syncNow(); }, 60000);
  supabase.auth.onAuthStateChange((_event, s) => {
    session = s;
    setView({ auth: s ? 'in' : 'out' });
    if (s) schedule(0);
  });
  const { data } = await supabase.auth.getSession();
  session = data.session;
  setView({ auth: session ? 'in' : 'out' });
  refreshCount();
  if (session) schedule(0);
}

/**
 * "Sync now" (spec 9): asks the database to start the same Garmin job the morning schedule runs.
 * The database holds the GitHub key; the app never sees it. New data arrives a minute or two later.
 */
export async function requestGarminSync(): Promise<'requested' | 'not-set-up' | 'offline' | 'failed'> {
  if (LOCAL_ONLY || !navigator.onLine) return 'offline';
  const { data, error } = await supabase.rpc('request_garmin_sync');
  if (error) return /function .* does not exist|PGRST202/i.test(`${error.code} ${error.message}`) ? 'not-set-up' : 'failed';
  if (data !== 'requested') return 'not-set-up';
  // The job takes about a minute; look for its results a few times afterwards.
  for (const s of [60, 100, 150]) setTimeout(syncNow, s * 1000);
  return 'requested';
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
