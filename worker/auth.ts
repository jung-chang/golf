// Who is calling: the email inside the Cloudflare Access JWT. The plain
// Cf-Access-Authenticated-User-Email header is not trusted on its own.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env';

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function accessEmail(req: Request, env: AppEnv['Bindings']): Promise<string | null> {
  const token = req.headers.get('Cf-Access-Jwt-Assertion');
  if (token && env.TEAM_DOMAIN && env.POLICY_AUD) {
    const issuer = `https://${env.TEAM_DOMAIN}`;
    let keys = jwks.get(issuer);
    if (!keys) jwks.set(issuer, (keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))));
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience: env.POLICY_AUD });
      return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  // Local dev: no Access in front, so use DEV_EMAIL — but only on localhost.
  const host = new URL(req.url).hostname;
  if (env.DEV_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return env.DEV_EMAIL.toLowerCase();
  return null;
}

export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const email = await accessEmail(c.req.raw, c.env);
  if (!email) return c.json({ error: 'unauthorized' }, 401);
  // A tab's local data must never be read or written using another account's credentials.
  const owner = c.req.header('X-Golf-Member');
  if (owner && owner !== email) {
    c.header('X-Golf-Account-Changed', '1');
    return c.json({ error: 'account changed' }, 409);
  }
  c.set('email', email);
  // First visit creates the member.
  await c.env.DB.prepare('INSERT OR IGNORE INTO members (email, created_at) VALUES (?, ?)')
    .bind(email, new Date().toISOString()).run();
  await next();
};
