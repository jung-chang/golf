import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sameOrigin } from '../worker/origin';

const app = new Hono().use('*', sameOrigin).all('*', (c) => c.text('ok'));
const call = async (method: string, headers: Record<string, string>) =>
  (await app.request('https://maybe.golf/api/games', { method, headers })).status;

describe('sameOrigin', () => {
  it("lets the app's own pages read and write", async () => {
    expect(await call('GET', { 'Sec-Fetch-Site': 'same-origin' })).toBe(200);
    expect(await call('POST', { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://maybe.golf' })).toBe(200);
  });
  it('refuses another site, reading or writing', async () => {
    expect(await call('GET', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' })).toBe(403);
    expect(await call('POST', { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' })).toBe(403);
    expect(await call('POST', { 'Sec-Fetch-Site': 'same-site', Origin: 'https://x.maybe.golf' })).toBe(403);
  });
  it('refuses a change with no Origin (a browser always sends one)', async () => {
    expect(await call('PUT', {})).toBe(403);
    expect(await call('DELETE', { Origin: 'https://evil.example' })).toBe(403);
  });
  it('allows opening an API link, like the sign-in round trip', async () => {
    expect(await call('GET', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' })).toBe(200);
    expect(await call('GET', {})).toBe(200);
  });
});
