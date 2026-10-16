// Only this app's own pages may call the API (on maybe.golf, or wherever it's hosted, and on localhost
// in dev: the same check, since the app and the API share an origin). Cloudflare Access already decides
// *who* can call; this decides *from where*, so another site can't use a signed-in member's cookie.
//
// Browsers label every request: Sec-Fetch-Site says whether it came from our own pages, and Origin is
// sent on every change (POST/PUT/DELETE). Neither can be set by a web page. A script outside a browser
// could fake them, but it would still need the member's own Access sign-in.
import type { MiddlewareHandler } from 'hono';

const SAFE = new Set(['GET', 'HEAD']);

export const sameOrigin: MiddlewareHandler = async (c, next) => {
  const self = new URL(c.req.url).origin;
  const site = c.req.header('Sec-Fetch-Site');
  // Another site's page fetching our API is refused. Opening an API link in the tab is fine: the
  // sign-in round trip (Access → /api/login) arrives as a cross-site navigation, and a page that
  // merely navigates here can't read what comes back.
  const navigating = c.req.method === 'GET' && c.req.header('Sec-Fetch-Mode') === 'navigate';
  if (site && site !== 'same-origin' && site !== 'none' && !navigating) return c.json({ error: 'forbidden' }, 403);
  if (!SAFE.has(c.req.method) && c.req.header('Origin') !== self) return c.json({ error: 'forbidden' }, 403);
  await next();
};
