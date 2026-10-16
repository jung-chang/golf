import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { auth } from '../worker/auth';
import type { AppEnv } from '../worker/env';

describe('expected member guard', () => {
  const run = async (owner?: string) => {
    const write = vi.fn(async () => ({}));
    const db = { prepare: () => ({ bind: () => ({ run: write }) }) };
    const app = new Hono<AppEnv>().use('*', auth).all('*', (c) => c.json({ email: c.get('email') }));
    const response = await app.request('http://localhost/api/bag', {
      method: 'PUT', headers: owner ? { 'X-Golf-Member': owner } : {},
    }, { DEV_EMAIL: 'current@example.test', DB: db } as unknown as AppEnv['Bindings']);
    return { response, write };
  };
  it('rejects stale account requests before running any member or data writes', async () => {
    const { response, write } = await run('previous@example.test');
    expect(response.status).toBe(409);
    expect(response.headers.get('X-Golf-Account-Changed')).toBe('1');
    expect(write).not.toHaveBeenCalled();
  });
  it('allows a request whose expected owner matches the signed-in account', async () => {
    const { response } = await run('current@example.test');
    expect(response.status).toBe(200);
  });
});
