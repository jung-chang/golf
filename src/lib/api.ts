// Tiny JSON fetch helper for the Worker API.
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Fired when Cloudflare Access no longer lets API calls through; the app offers "Sign in again". */
export const SIGNED_OUT = 'golf:signed-out';

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    // An expired Access session redirects to its login page; catch that instead of following it.
    redirect: 'manual',
  });
  if (res.type === 'opaqueredirect' || res.status === 401) {
    dispatchEvent(new Event(SIGNED_OUT));
    throw new ApiError(401, 'Your sign-in expired');
  }
  if (!res.ok) throw new ApiError(res.status, (await res.text().catch(() => '')) || res.statusText);
  return res.json() as Promise<T>;
}
