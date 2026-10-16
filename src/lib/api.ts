// Tiny JSON fetch helper for the Worker API.
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Fired when Cloudflare Access no longer lets API calls through; the app offers "Sign in again". */
export const SIGNED_OUT = 'golf:signed-out';

export const ACCOUNT_CHANGED = 'golf:account-changed';
let verifiedMember: string | null = null;

export async function api<T>(path: string, init?: { method?: string; body?: unknown; member?: string; signal?: AbortSignal }): Promise<T> {
  const owner = init?.member ?? verifiedMember;
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: { ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }), ...(owner ? { 'X-Golf-Member': owner } : {}) },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    // An expired Access session redirects to its login page; catch that instead of following it.
    redirect: 'manual',
  });
  if (res.type === 'opaqueredirect' || res.status === 401) {
    dispatchEvent(new Event(SIGNED_OUT));
    throw new ApiError(401, 'Your sign-in expired');
  }
  if (res.status === 409 && res.headers.get('X-Golf-Account-Changed') === '1') {
    dispatchEvent(new Event(ACCOUNT_CHANGED));
    throw new ApiError(409, 'Your account changed. Reload to continue.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? 'Could not complete the request. Try again.');
  }
  const data: unknown = await res.json();
  if (path === '/me' && data && typeof data === 'object' && 'email' in data && typeof data.email === 'string') verifiedMember = data.email;
  return data as T;
}
