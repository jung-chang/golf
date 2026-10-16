// App data: kept in memory, saved to IndexedDB on every change, and synced to
// the Worker (D1) in the background. Local always wins until the server has it;
// on startup, anything newer on the server is pulled in.
import { useSyncExternalStore } from 'react';
import { createStore, del, entries, get, set } from 'idb-keyval';
import { z } from 'zod';
import { Bag, Round } from '../schemas/round';
import type { Course } from '../schemas/course';
import { defaultBag } from './clubs';
import { newRound } from './round';

type State = {
  loaded: boolean;
  rounds: Record<string, Round>;
  bag: Bag;
  activeId: string | null;
};

// Each member gets their own stores, so a friend signing in on your phone never sees (or syncs) your
// rounds. Who you are comes from /api/me, remembered for when the course has no signal.
type Db = ReturnType<typeof createStore>;
let roundsDb: Db;
let metaDb: Db;
const MEMBER_KEY = 'golf.member';

async function member(): Promise<string> {
  try {
    const res = await fetch('/api/me', { signal: AbortSignal.timeout(4000) });
    const email = res.ok ? z.object({ email: z.string() }).parse(await res.json()).email : null;
    if (email) {
      try { localStorage.setItem(MEMBER_KEY, email); } catch { /* still works this visit */ }
      return email;
    }
  } catch { /* offline: fall back to who was here last */ }
  try { return localStorage.getItem(MEMBER_KEY) ?? 'unknown'; } catch { return 'unknown'; }
}

let state: State = { loaded: false, rounds: {}, bag: defaultBag(), activeId: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}
export const getState = () => state;

// --- persistence ---------------------------------------------------------

let loading: Promise<void> | null = null;
export function load() {
  return (loading ??= open());
}

async function open() {
  const who = await member();
  roundsDb = createStore(`golf-rounds:${who}`, 'rounds');
  metaDb = createStore(`golf-meta:${who}`, 'meta');
  const [rows, bag, activeId] = await Promise.all([entries<string, unknown>(roundsDb), get('bag', metaDb), get('activeId', metaDb)]);
  const rounds: Record<string, Round> = {};
  for (const [id, data] of rows) {
    const r = Round.safeParse(data);
    if (r.success) rounds[id] = r.data;
  }
  const b = Bag.safeParse(bag);
  setState({ loaded: true, rounds, bag: b.success ? b.data : defaultBag(), activeId: activeId ?? null });
  navigator.storage?.persist?.().catch(() => {});
  void sync();
}

export function saveRound(r: Round, { push = false } = {}) {
  setState({ rounds: { ...state.rounds, [r.id]: r } });
  void set(r.id, r, roundsDb);
  markDirty(`round:${r.id}`);
  if (push) void sync();
}

export function deleteRound(id: string) {
  const { [id]: _, ...rest } = state.rounds;
  setState({ rounds: rest, activeId: state.activeId === id ? null : state.activeId });
  void del(id, roundsDb);
  markDirty(`delete:${id}`);
  void sync();
}

/** Start a round and make it the active one; any round still in progress is finished first. */
export function startRound(course: Course, teeId: string, gameId?: string): Round {
  const old = state.activeId ? state.rounds[state.activeId] : undefined;
  if (old && !old.done) saveRound({ ...old, done: true, updatedAt: new Date().toISOString() }, { push: true });
  const r = { ...newRound(course, teeId), ...(gameId && { gameId }) };
  saveRound(r, { push: true }); // pushed now so the game's leaderboard shows you straight away
  setActive(r.id);
  return r;
}

export function setActive(id: string | null) {
  setState({ activeId: id });
  void set('activeId', id, metaDb);
}

export function saveBag(bag: Bag) {
  const b = { ...bag, updatedAt: new Date().toISOString() };
  setState({ bag: b });
  void set('bag', b, metaDb);
  markDirty('bag');
  void sync();
}

// --- sync ----------------------------------------------------------------

let dirty: Set<string> | null = null;
async function dirtySet() {
  return (dirty ??= new Set((await get<string[]>('dirty', metaDb)) ?? []));
}
async function markDirty(key: string) {
  (await dirtySet()).add(key);
  await set('dirty', [...dirty!], metaDb);
}

let syncing = false;

export async function sync() {
  if (syncing || !state.loaded || !navigator.onLine) return;
  syncing = true;
  try {
    // push local changes
    const d = await dirtySet();
    for (const key of [...d]) {
      const [kind, id] = key.split(':');
      let res: Response | null = null;
      if (kind === 'round' && state.rounds[id]) {
        res = await fetch(`/api/rounds/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.rounds[id]) });
      } else if (kind === 'delete') {
        res = await fetch(`/api/rounds/${id}`, { method: 'DELETE' });
      } else if (kind === 'bag') {
        res = await fetch('/api/bag', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.bag) });
      }
      if (!res || res.ok) d.delete(key);
      else if (res.status >= 500 || res.status === 401 || res.status === 403) break; // try again later
      else d.delete(key); // 4xx: the server will never accept it; don't retry forever
    }
    await set('dirty', [...d], metaDb);

    // pull anything newer
    const remote = await fetch('/api/rounds').then((r) => (r.ok ? r.json() : null));
    const parsed = z.array(Round).safeParse(remote);
    if (parsed.success) {
      const rounds = { ...state.rounds };
      for (const r of parsed.data) {
        const local = rounds[r.id];
        if (d.has(`delete:${r.id}`)) continue; // deleted here, not yet on the server
        if (!local || r.updatedAt > local.updatedAt) {
          rounds[r.id] = r;
          void set(r.id, r, roundsDb);
        }
      }
      setState({ rounds });
    }
    const bag = Bag.safeParse(await fetch('/api/bag').then((r) => (r.ok ? r.json() : null)));
    if (bag.success && bag.data.updatedAt > state.bag.updatedAt) {
      setState({ bag: bag.data });
      void set('bag', bag.data, metaDb);
    }
  } catch {
    // offline or server down: everything stays queued locally
  } finally {
    syncing = false;
  }
}

addEventListener('online', () => void sync());
