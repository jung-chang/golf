// Member-owned local data. Disk writes are serialized; sync verifies the owner on every request.
import { useSyncExternalStore } from 'react';
import { createStore, del, entries, get, set } from 'idb-keyval';
import { z } from 'zod';
import { Bag, Round } from '../schemas/round';
import type { Course } from '../schemas/course';
import { defaultBag } from './clubs';
import { newRound } from './round';
import { ACCOUNT_CHANGED, ApiError, SIGNED_OUT, api } from './api';

type State = {
  loaded: boolean;
  loading: boolean;
  owner: string | null;
  error: string | null;
  saveError: boolean;
  saving: boolean;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'offline' | 'error';
  initialSynced: boolean;
  pending: number;
  rounds: Record<string, Round>;
  bag: Bag;
  activeId: string | null;
  // The server couldn't be reached to confirm who you are, but this phone remembers who signed in
  // last: the person can choose to open that copy (weak signal on the course).
  savedMember: string | null;
};
type Db = ReturnType<typeof createStore>;
type Context = {
  owner: string;
  roundsDb: Db;
  metaDb: Db;
  dirty: Map<string, number>;
  writes: Map<string, { version: number; run: () => Promise<unknown> }>;
  queue: Promise<void>;
  controller: AbortController;
};
const MEMBER_KEY = 'golf.member';
const blank = (): State => ({ loaded: false, loading: false, owner: null, error: null, saveError: false, saving: false,
  syncStatus: 'pending', initialSynced: false, pending: 0, rounds: {}, bag: defaultBag(), activeId: null, savedMember: null });
let state = blank();
let context: Context | null = null;
let loading: Promise<void> | null = null;
let syncing: Promise<void> | null = null;
let revision = 0;
let sessionEpoch = 0;
let chosenOffline: string | null = null; // set by openSaved(): the person chose the remembered copy
const listeners = new Set<() => void>();
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => select(state));
}
export const getState = () => state;

function lock(message: string) {
  sessionEpoch++;
  const owner = context?.owner ?? state.owner;
  context?.controller.abort();
  context = null;
  try { if (localStorage.getItem(MEMBER_KEY) === owner) localStorage.removeItem(MEMBER_KEY); } catch { /* storage unavailable */ }
  setState({ ...blank(), error: message });
}
addEventListener(SIGNED_OUT, () => lock('Sign in again to open your golf data.'));
addEventListener(ACCOUNT_CHANGED, () => lock('Your account changed. Reload to continue.'));
addEventListener('storage', (event) => {
  if (event.key === MEMBER_KEY && context && event.newValue !== context.owner) dispatchEvent(new Event(ACCOUNT_CHANGED));
});

async function member(): Promise<string> {
  // Only an explicitly offline device can open the previously verified member's local copy.
  // A timeout, invalid response, or expired login must not select somebody else's stores.
  // Without a server answer it never opens on its own; openSaved() is the person choosing it.
  const saved = localStorage.getItem(MEMBER_KEY);
  const chosen = chosenOffline;
  chosenOffline = null; // one open only: any later load (e.g. after a sign-out) asks the server again
  if (chosen && chosen === saved) return chosen;
  if (!navigator.onLine) {
    if (saved) return saved;
    throw new Error('Connect once to sign in before using golf offline.');
  }
  try {
    const m = z.object({ email: z.string().email() }).parse(await api('/me', { signal: AbortSignal.timeout(8000) }));
    return m.email;
  } catch (e) {
    // No answer (weak signal, timeout) as opposed to a sign-in answer: offer the remembered copy.
    if (!(e instanceof ApiError) && saved) {
      setState({ savedMember: saved });
      throw new Error("Can't reach the server. Your round is saved on this phone.");
    }
    throw e;
  }
}

/** Open the remembered member's data without the server (offered after a failed identity check). */
export function openSaved(): Promise<void> {
  chosenOffline = state.savedMember;
  setState({ error: null, savedMember: null });
  return load();
}

export function load(): Promise<void> {
  if (state.loaded) return Promise.resolve();
  if (loading) return loading;
  setState({ loading: true, error: null, savedMember: null });
  loading = open(sessionEpoch).catch((e: unknown) => {
    setState({ loading: false, error: e instanceof Error ? e.message : 'Could not open your saved golf data.' });
  }).finally(() => { loading = null; });
  return loading;
}
async function open(epoch: number) {
  const who = await member();
  if (epoch !== sessionEpoch) return;
  try { localStorage.setItem(MEMBER_KEY, who); } catch { /* works for this visit */ }
  const ctx: Context = { owner: who, roundsDb: createStore(`golf-rounds:${who}`, 'rounds'),
    metaDb: createStore(`golf-meta:${who}`, 'meta'), dirty: new Map(), writes: new Map(),
    queue: Promise.resolve(), controller: new AbortController() };
  context = ctx;
  const [rows, bag, activeId, dirty] = await Promise.all([
    entries<string, unknown>(ctx.roundsDb), get('bag', ctx.metaDb), get<string>('activeId', ctx.metaDb), get<string[]>('dirty', ctx.metaDb),
  ]);
  if (context !== ctx) return;
  const rounds: Record<string, Round> = {};
  for (const [id, data] of rows) {
    const r = Round.safeParse(data);
    if (r.success) rounds[id] = r.data;
  }
  ctx.dirty = new Map((dirty ?? []).map((key) => [key, ++revision]));
  const b = Bag.safeParse(bag);
  setState({ loaded: true, loading: false, owner: who, savedMember: null, rounds, bag: b.success ? b.data : defaultBag(),
    activeId: activeId && rounds[activeId] && !rounds[activeId].done ? activeId : null,
    pending: ctx.dirty.size, syncStatus: navigator.onLine ? 'pending' : 'offline' });
  navigator.storage?.persist?.().catch(() => {});
  void sync();
}

function flush(ctx: Context): Promise<void> {
  ctx.queue = ctx.queue.then(async () => {
    for (const [key, job] of ctx.writes) {
      await job.run();
      if (ctx.writes.get(key)?.version === job.version) ctx.writes.delete(key);
    }
    await set('dirty', [...ctx.dirty.keys()], ctx.metaDb);
    if (context === ctx) setState({ saveError: false, saving: ctx.writes.size > 0 });
  }).catch(() => {
    if (context === ctx) setState({ saveError: true, syncStatus: 'error' });
  });
  return ctx.queue;
}
function write(ctx: Context, key: string, run: () => Promise<unknown>, dirty = true) {
  const version = ++revision;
  if (dirty) ctx.dirty.set(key, version);
  ctx.writes.set(key, { version, run });
  setState({ saving: true, pending: ctx.dirty.size, syncStatus: navigator.onLine ? 'pending' : 'offline' });
  void flush(ctx).then(() => sync());
}
function current(): Context {
  if (!context || !state.loaded) throw new Error('Your golf data is still loading.');
  return context;
}
export function saveRound(r: Round, _options: { push?: boolean } = {}) {
  const ctx = current();
  setState({ rounds: { ...state.rounds, [r.id]: r } });
  write(ctx, `round:${r.id}`, () => set(r.id, r, ctx.roundsDb));
}
export function deleteRound(id: string) {
  const ctx = current();
  const { [id]: _, ...rest } = state.rounds;
  setState({ rounds: rest });
  if (state.activeId === id) setActive(null);
  ctx.dirty.delete(`round:${id}`);
  ctx.writes.delete(`round:${id}`);
  write(ctx, `delete:${id}`, () => del(id, ctx.roundsDb));
}
export function startRound(course: Course, teeId: string, gameId?: string): Round {
  const old = state.activeId ? state.rounds[state.activeId] : undefined;
  if (old && !old.done) saveRound({ ...old, done: true, updatedAt: new Date().toISOString() });
  const r = { ...newRound(course, teeId), ...(gameId && { gameId }) };
  saveRound(r);
  setActive(r.id);
  return r;
}
export function setActive(id: string | null) {
  const ctx = current();
  setState({ activeId: id });
  write(ctx, 'activeId', () => set('activeId', id, ctx.metaDb), false);
}
export function saveBag(bag: Bag) {
  const ctx = current();
  const b = { ...bag, updatedAt: new Date().toISOString() };
  setState({ bag: b });
  write(ctx, 'bag', () => set('bag', b, ctx.metaDb));
}

export function sync(): Promise<void> {
  if (syncing) return syncing;
  if (!context || !state.loaded) return Promise.resolve();
  const ctx = context;
  if (!navigator.onLine) { setState({ syncStatus: 'offline' }); return Promise.resolve(); }
  syncing = transfer(ctx).finally(() => {
    syncing = null;
    if (context === ctx && ctx.dirty.size && state.syncStatus === 'pending' && navigator.onLine) queueMicrotask(() => void sync());
  });
  return syncing;
}
async function transfer(ctx: Context) {
  const request = <T>(path: string, init?: { method?: string; body?: unknown }) =>
    api<T>(path, { ...init, member: ctx.owner, signal: AbortSignal.any([ctx.controller.signal, AbortSignal.timeout(15_000)]) });
  setState({ syncStatus: 'syncing' });
  try {
    // The server checks the expected member on every request, including reads, closing the
    // race where credentials change after this identity check but before an upload.
    await request('/me');
    if (context !== ctx) return;
    await flush(ctx);
    if (state.saveError || ctx.writes.size) throw new Error('Local save failed');
    for (const [key, version] of [...ctx.dirty]) {
      if (context !== ctx) return;
      const [kind, id] = key.split(':');
      if (kind === 'round' && state.rounds[id]) await request(`/rounds/${id}`, { method: 'PUT', body: state.rounds[id] });
      else if (kind === 'delete') await request(`/rounds/${id}`, { method: 'DELETE' });
      else if (kind === 'bag') await request('/bag', { method: 'PUT', body: state.bag });
      // A shot logged while an upload is in flight must remain queued.
      if (ctx.dirty.get(key) === version) ctx.dirty.delete(key);
      await flush(ctx);
    }
    const remote = z.array(Round).parse(await request('/rounds'));
    const remoteBag = await request('/bag');
    if (context !== ctx) return;
    // Pulls share the same disk queue as local edits. A new edit during a remote write
    // is persisted after it, and we re-check ownership/dirty state before changing memory.
    ctx.queue = ctx.queue.then(async () => {
      for (const r of remote) {
        if (context !== ctx) return;
        if (ctx.dirty.has(`delete:${r.id}`) || ctx.dirty.has(`round:${r.id}`)) continue;
        const local = state.rounds[r.id];
        if (!local || r.updatedAt > local.updatedAt) {
          await set(r.id, r, ctx.roundsDb);
          if (context !== ctx) return;
          if (!ctx.dirty.has(`round:${r.id}`) && !ctx.dirty.has(`delete:${r.id}`)) setState({ rounds: { ...state.rounds, [r.id]: r } });
        }
      }
      const bag = Bag.safeParse(remoteBag);
      if (bag.success && !ctx.dirty.has('bag') && bag.data.updatedAt > state.bag.updatedAt) {
        await set('bag', bag.data, ctx.metaDb);
        if (context !== ctx) return;
        if (!ctx.dirty.has('bag')) setState({ bag: bag.data });
      }
    });
    await ctx.queue;
    if (context !== ctx) return;
    await flush(ctx);
    if (state.saveError || ctx.writes.size) throw new Error('Local save failed');
    setState({ initialSynced: true, pending: ctx.dirty.size, syncStatus: ctx.dirty.size ? 'pending' : 'synced' });
  } catch (e) {
    if (context !== ctx) return;
    if (e instanceof ApiError && (e.status === 401 || e.status === 409)) return;
    setState({ pending: ctx.dirty.size, syncStatus: navigator.onLine ? 'error' : 'offline' });
  }
}
addEventListener('online', () => void sync());
addEventListener('offline', () => setState({ syncStatus: 'offline' }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sync(); });
setInterval(() => { if (document.visibilityState === 'visible' && state.loaded) void sync(); }, 30_000);
