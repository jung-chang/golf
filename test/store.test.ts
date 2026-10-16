// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const db = vi.hoisted(() => {
  const stores = new Map<string, Map<string, unknown>>();
  const table = (name: string) => { if (!stores.has(name)) stores.set(name, new Map()); return stores.get(name)!; };
  return { stores, table };
});
vi.mock('idb-keyval', () => ({
  createStore: (name: string) => name,
  entries: vi.fn(async (name: string) => [...db.table(name).entries()]),
  get: vi.fn(async (key: string, name: string) => db.table(name).get(key)),
  set: vi.fn(async (key: string, value: unknown, name: string) => { db.table(name).set(key, structuredClone(value)); }),
  del: vi.fn(async (key: string, name: string) => { db.table(name).delete(key); }),
}));
import { entries, set } from 'idb-keyval';

let online = true;
let email = 'a@example.test';
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const registrations: { target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }[] = [];
const reply = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function ready() { const store = await import('../src/lib/store'); await store.load(); await store.sync(); return store; }

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  db.stores.clear();
  localStorage.clear();
  online = true;
  email = 'a@example.test';
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (listener) { registrations.push({ target, type, listener }); original(type, listener, options); }
    });
  }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const owner = (init?.headers as Record<string, string>)?.['X-Golf-Member'];
    if (owner && owner !== email) return reply({ error: 'account changed' }, 409, { 'X-Golf-Account-Changed': '1' });
    if (url === '/api/me') return reply({ email });
    if (init?.method === 'PUT' || init?.method === 'DELETE') return reply({ ok: true });
    return reply(url === '/api/rounds' ? [] : null);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  for (const { target, type, listener } of registrations.splice(0)) target.removeEventListener(type, listener);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('member-owned golf storage', () => {
  it('does not open the previous member after an online timeout or expired login', async () => {
    localStorage.setItem('golf.member', 'previous@example.test');
    fetchMock.mockRejectedValueOnce(new Error('Timed out'));
    const store = await import('../src/lib/store');
    await store.load();
    expect(store.getState()).toMatchObject({ loaded: false, owner: null, error: 'Timed out' });
    expect(db.stores.size).toBe(0);
    fetchMock.mockResolvedValueOnce(reply({ error: 'unauthorized' }, 401));
    await store.load();
    expect(store.getState().loaded).toBe(false);
    expect(db.stores.size).toBe(0);
  });

  it('opens a remembered member only when explicitly offline, without network requests', async () => {
    localStorage.setItem('golf.member', email);
    online = false;
    const store = await ready();
    expect(store.getState()).toMatchObject({ loaded: true, owner: email, syncStatus: 'offline', initialSynced: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reopen private data when sign-out occurs during the identity request', async () => {
    const identity = deferred<Response>();
    fetchMock.mockReturnValueOnce(identity.promise);
    const store = await import('../src/lib/store');
    const loading = store.load();
    const { SIGNED_OUT } = await import('../src/lib/api');
    dispatchEvent(new Event(SIGNED_OUT));
    identity.resolve(reply({ email }));
    await loading;
    expect(store.getState()).toMatchObject({ loaded: false, owner: null });
    expect(db.stores.size).toBe(0);
    expect(localStorage.getItem('golf.member')).toBeNull();
  });

  it('can retry failed local initialization', async () => {
    vi.mocked(entries).mockRejectedValueOnce(new Error('Storage unavailable'));
    const store = await import('../src/lib/store');
    await store.load();
    expect(store.getState().error).toBe('Storage unavailable');
    await store.load();
    await store.sync();
    expect(store.getState()).toMatchObject({ loaded: true, error: null, syncStatus: 'synced' });
  });

  it('locks the old member data before an account change can upload a queued bag', async () => {
    const store = await ready();
    online = false;
    store.saveBag({ ...store.getState().bag, useTracked: false });
    await vi.waitFor(() => expect(db.table(`golf-meta:${email}`).get('dirty')).toEqual(['bag']));
    email = 'b@example.test';
    online = true;
    await store.sync();
    expect(store.getState()).toMatchObject({ loaded: false, owner: null, rounds: {} });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(0);
    expect(db.table('golf-meta:a@example.test').get('dirty')).toEqual(['bag']);
  });

  it('keeps an edit made during an upload queued and eventually uploads the newer value', async () => {
    const store = await ready();
    const first = deferred<Response>();
    let uploads = 0;
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/bag' && init?.method === 'PUT' && ++uploads === 1) return first.promise;
      return base(url, init);
    });
    store.saveBag({ ...store.getState().bag, useTracked: false });
    await vi.waitFor(() => expect(uploads).toBe(1));
    store.saveBag({ ...store.getState().bag, useTracked: true });
    first.resolve(reply({ ok: true }));
    await store.sync();
    await vi.waitFor(() => expect(uploads).toBe(2));
    await store.sync();
    const bodies = fetchMock.mock.calls.filter(([url, init]) => url === '/api/bag' && init?.method === 'PUT').map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies.map((b) => b.useTracked)).toEqual([false, true]);
    expect(store.getState()).toMatchObject({ pending: 0, syncStatus: 'synced' });
    expect(db.table(`golf-meta:${email}`).get('dirty')).toEqual([]);
  });

  it('reports local save failures and retries without losing the pending change', async () => {
    const store = await ready();
    const persist = vi.mocked(set).getMockImplementation()!;
    let blocked = true;
    vi.mocked(set).mockImplementation((...args) => blocked ? Promise.reject(new Error('Quota exceeded')) : persist(...args));
    store.saveBag({ ...store.getState().bag, useTracked: false });
    await vi.waitFor(() => expect(store.getState().saveError).toBe(true));
    blocked = false;
    await store.sync();
    // A later retry can persist the original queued write.
    await store.sync();
    expect(store.getState()).toMatchObject({ saveError: false, pending: 0, syncStatus: 'synced' });
    expect(db.table(`golf-meta:${email}`).get('bag')).toMatchObject({ useTracked: false });
    vi.mocked(set).mockImplementation(persist);
  });

  it('does not mark the first sync complete until remote history arrives', async () => {
    const remote = deferred<Response>();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/rounds' ? remote.promise : base(url, init));
    const store = await import('../src/lib/store');
    await store.load();
    expect(store.getState().initialSynced).toBe(false);
    remote.resolve(reply([]));
    await store.sync();
    expect(store.getState()).toMatchObject({ initialSynced: true, syncStatus: 'synced' });
  });
});
