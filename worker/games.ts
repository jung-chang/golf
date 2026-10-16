// Group games: propose, add tee times, in/out (no cap), book each time, check in on the day,
// and the leaderboard from rounds started from the game.
import { Hono } from 'hono';
import { z } from 'zod';
import { capacity, gameLabel, ins, timeLabel } from '../src/features/games/label';
import { BookTime, Game, GameTime, GameUpdate, NewGame, NewTime, RsvpStatus, type GameScore } from '../src/schemas/group';
import { Round } from '../src/schemas/round';
import { addDays, courseByCode, nyClock, nyToday } from '../src/lib/nyc';
import { playedHoles, toPar, totalScore } from '../src/lib/round';
import { bad } from './rounds';
import { notify } from './push';
import type { AppEnv, Env } from './env';

const app = new Hono<AppEnv>();

type Row = {
  id: string; code: string; facility_id: number; date: string; teetime: string; times: string;
  holes: 9 | 18; note: string | null; created_by: string; status: Game['status']; updated_at: string;
  p_email: string | null; p_status: 'in' | 'out' | null; p_name: string | null; p_checked_in: string | null;
};

const displayName = (name: string | null | undefined, email: string) => name || email.split('@')[0];

const memberName = async (env: Env, email: string) => {
  const row = await env.DB.prepare('SELECT name FROM members WHERE email = ?').bind(email).first<{ name: string }>();
  return displayName(row?.name, email);
};

/** Those of these members who have game notifications on. */
async function wantGames(env: Env, emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  const { results } = await env.DB.prepare(`SELECT email FROM members WHERE notify_games = 1 AND email IN (${emails.map(() => '?').join(',')})`)
    .bind(...emails).all<{ email: string }>();
  return results.map((r) => r.email);
}

const names = (game: Game) => ins(game).map((p) => p.name).join(', ');
const gameLink = (game: Game) => ({ url: `/#games/${game.id}`, tag: `game-${game.id}` });

/** Score only (never shots) for each round started from these games. */
async function loadScores(env: Env, ids: string[]): Promise<Map<string, GameScore[]>> {
  const out = new Map<string, GameScore[]>();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(`SELECT r.email, r.data, m.name FROM rounds r LEFT JOIN members m ON m.email = r.email
      WHERE json_extract(r.data, '$.gameId') IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all<{ email: string; data: string; name: string | null }>();
  for (const row of results) {
    const round = Round.safeParse(JSON.parse(row.data));
    if (!round.success || !round.data.gameId) continue;
    const r = round.data;
    const list = out.get(r.gameId!) ?? [];
    list.push({ email: row.email, name: displayName(row.name, row.email), thru: playedHoles(r).length, toPar: toPar(r), strokes: totalScore(r), done: r.done });
    out.set(r.gameId!, list);
  }
  return out;
}

// One row per (game, player); games are rebuilt in JS. Keeps it to a single query.
const GAMES_SQL = `SELECT g.*, gp.email AS p_email, gp.status AS p_status, gp.checked_in AS p_checked_in, m.name AS p_name
  FROM games g
  LEFT JOIN game_players gp ON gp.game_id = g.id
  LEFT JOIN members m ON m.email = gp.email`;

async function loadGames(env: Env, where: string, binds: unknown[] = []): Promise<Game[]> {
  const { results } = await env.DB.prepare(`${GAMES_SQL} WHERE ${where} ORDER BY julianday(g.teetime), g.id, gp.status`)
    .bind(...binds).all<Row>();
  const games = new Map<string, Game>();
  for (const r of results) {
    let g = games.get(r.id);
    if (!g) {
      games.set(r.id, (g = {
        id: r.id, code: r.code, facilityId: r.facility_id, date: r.date, holes: r.holes,
        times: z.array(GameTime).parse(JSON.parse(r.times)), note: r.note, createdBy: r.created_by,
        status: r.status, players: [], scores: [], updatedAt: r.updated_at,
      }));
    }
    if (r.p_email && r.p_status) {
      g.players.push({ email: r.p_email, name: displayName(r.p_name, r.p_email), status: r.p_status, checkedIn: !!r.p_checked_in });
    }
  }
  const scores = await loadScores(env, [...games.keys()]);
  for (const g of games.values()) g.scores = (scores.get(g.id) ?? [])
      .sort((a, b) => Number(!a.thru) - Number(!b.thru) || a.toPar - b.toPar || b.thru - a.thru); // not started yet: last
  return [...games.values()];
}

const loadGame = async (env: Env, id: string) => (await loadGames(env, 'g.id = ?', [id]))[0];

/** Save a game's tee times (earliest first); booked once every time is booked. */
function saveTimes(env: Env, game: Game, times: GameTime[]) {
  const sorted = [...times].sort((a, b) => a.teetime.localeCompare(b.teetime));
  const status = game.status === 'cancelled' ? 'cancelled' : sorted.every((t) => t.bookedBy) ? 'booked' : 'open';
  return env.DB.prepare('UPDATE games SET times = ?, teetime = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(sorted), sorted[0].teetime, status, new Date().toISOString(), game.id).run();
}

// Upcoming and today's games, plus the last week's (for results).
app.get('/', async (c) => {
  const today = nyToday();
  return c.json(await loadGames(c.env, "g.date >= ? AND g.status != 'cancelled'", [addDays(today, -7)]));
});

app.post('/', async (c) => {
  const parsed = NewGame.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const n = parsed.data;
  const email = c.get('email');
  const db = c.env.DB;

  const id = crypto.randomUUID();
  const times: GameTime[] = [{ teetime: n.teetime, time: n.time, spots: n.spots, bookedBy: null }];
  await db.batch([
    db.prepare(`INSERT INTO games (id, code, facility_id, date, teetime, times, holes, note, created_by, status, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10)`)
      .bind(id, n.code, n.facilityId, n.date, n.teetime, JSON.stringify(times), n.holes, n.note || null, email, new Date().toISOString()),
    db.prepare("INSERT INTO game_players (game_id, email, status) VALUES (?1, ?2, 'in')").bind(id, email),
  ]);
  const game = await loadGame(c.env, id);

  const { results } = await db.prepare('SELECT email FROM members WHERE notify_games = 1 AND email != ?')
    .bind(email).all<{ email: string }>();
  const creator = await memberName(c.env, email);
  c.executionCtx.waitUntil(notify(c.env, results.map((r) => r.email), {
    title: `New game: ${gameLabel(game)}`,
    body: `${creator} proposed it · In?`,
    ...gameLink(game),
  }));
  return c.json(game);
});

// Another tee time for the same game (more players than one time holds).
app.post('/:id/times', async (c) => {
  const parsed = NewTime.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const game = await loadGame(c.env, c.req.param('id'));
  if (!game) return c.json({ error: 'not found' }, 404);
  // Same course, same day: the time has to fall on the game's date (New York).
  if (nyToday(new Date(parsed.data.teetime)) !== game.date) return c.json({ error: 'tee time is on another day' }, 400);
  if (!game.times.some((t) => t.teetime === parsed.data.teetime)) {
    await saveTimes(c.env, game, [...game.times, { ...parsed.data, bookedBy: null }]);
  }
  const after = await loadGame(c.env, game.id);
  const others = await wantGames(c.env, ins(after).map((p) => p.email).filter((e) => e !== c.get('email')));
  c.executionCtx.waitUntil(notify(c.env, others, {
    title: `Tee time added: ${after.code} ${timeLabel(parsed.data)}`,
    body: `${capacity(after)} spots for ${ins(after).length} in`,
    ...gameLink(after),
  }));
  return c.json(after);
});

app.put('/:id/rsvp', async (c) => {
  const parsed = z.object({ status: RsvpStatus }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const id = c.req.param('id');
  const email = c.get('email');
  const db = c.env.DB;
  const game = await loadGame(c.env, id);
  if (!game) return c.json({ error: 'not found' }, 404);
  const was = game.players.find((p) => p.email === email)?.status;

  // Out also clears a check-in.
  await db.batch([
    db.prepare(`INSERT INTO game_players (game_id, email, status) VALUES (?1, ?2, ?3)
        ON CONFLICT (game_id, email) DO UPDATE SET status = excluded.status,
          checked_in = CASE WHEN excluded.status = 'out' THEN NULL ELSE game_players.checked_in END`).bind(id, email, parsed.data.status),
    db.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id),
  ]);
  const after = await loadGame(c.env, id);

  // Joining tells the proposer. Filling the last spot tells everyone who's in; going past it
  // tells the proposer another tee time is needed. There's no cap on players.
  if (parsed.data.status === 'in' && was !== 'in') {
    const n = ins(after).length;
    const cap = capacity(after);
    const me = await memberName(c.env, email);
    const msg = n === cap
      ? { to: ins(after).map((p) => p.email), title: `Full: ${gameLabel(after)}`, body: `${names(after)}${after.status === 'open' ? ' · someone book it on TeeItUp' : ''}` }
      : n > cap
        ? { to: [after.createdBy], title: `${me} is in: ${gameLabel(after)}`, body: `${n} in, ${cap} spots · add another tee time` }
        : { to: [after.createdBy], title: `${me} is in: ${gameLabel(after)}`, body: `${n} in · ${cap - n} ${cap - n === 1 ? 'spot' : 'spots'} left` };
    const to = await wantGames(c.env, msg.to.filter((e) => e !== email));
    c.executionCtx.waitUntil(notify(c.env, to, { title: msg.title, body: msg.body, ...gameLink(after) }));
  }
  return c.json(after);
});

// On the day: I'm here (and in), usually as I start my round.
app.put('/:id/checkin', async (c) => {
  const id = c.req.param('id');
  const game = await loadGame(c.env, id);
  if (!game) return c.json({ error: 'not found' }, 404);
  await c.env.DB.prepare(`INSERT INTO game_players (game_id, email, status, checked_in) VALUES (?1, ?2, 'in', ?3)
      ON CONFLICT (game_id, email) DO UPDATE SET status = 'in', checked_in = COALESCE(game_players.checked_in, ?3)`)
    .bind(id, c.get('email'), new Date().toISOString()).run();
  return c.json(await loadGame(c.env, id));
});

// Mark one tee time booked (or not).
app.put('/:id/book', async (c) => {
  const parsed = BookTime.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const email = c.get('email');
  const game = await loadGame(c.env, c.req.param('id'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const slot = game.times.find((t) => t.teetime === parsed.data.teetime);
  if (!slot) return c.json({ error: 'no such tee time' }, 404);
  if (!parsed.data.booked && slot.bookedBy && slot.bookedBy !== email) return c.json({ error: 'only the person who booked it can undo' }, 403);

  await saveTimes(c.env, game, game.times.map((t) => (t === slot ? { ...t, bookedBy: parsed.data.booked ? email : null } : t)));
  // Whoever books is playing.
  if (parsed.data.booked) {
    await c.env.DB.prepare(`INSERT INTO game_players (game_id, email, status) VALUES (?1, ?2, 'in')
        ON CONFLICT (game_id, email) DO UPDATE SET status = 'in'`).bind(game.id, email).run();
  }
  const after = await loadGame(c.env, game.id);
  if (parsed.data.booked) {
    const others = await wantGames(c.env, ins(after).map((p) => p.email).filter((e) => e !== email));
    const booker = await memberName(c.env, email);
    c.executionCtx.waitUntil(notify(c.env, others, {
      title: `Booked: ${after.code} ${timeLabel(slot)}`,
      body: after.status === 'booked' ? `${booker} booked it · you're all set` : `${booker} booked it · ${after.times.filter((t) => !t.bookedBy).length} more to book`,
      ...gameLink(after),
    }));
  }
  return c.json(after);
});

// Cancel, undo a cancel, or change the note.
app.put('/:id', async (c) => {
  const parsed = GameUpdate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(bad(parsed.error), 400);
  const id = c.req.param('id');
  const email = c.get('email');
  const db = c.env.DB;
  const game = await loadGame(c.env, id);
  if (!game) return c.json({ error: 'not found' }, 404);

  const u = parsed.data;
  if (u.status && game.createdBy !== email) return c.json({ error: 'only the creator can cancel' }, 403);
  const now = new Date().toISOString();
  const writes = [];
  if (u.status === 'cancelled') writes.push(db.prepare("UPDATE games SET status = 'cancelled', updated_at = ? WHERE id = ?").bind(now, id));
  if (u.status === 'open') {
    // Undo: back to booked or open, from its tee times.
    const status = game.times.every((t) => t.bookedBy) ? 'booked' : 'open';
    writes.push(db.prepare('UPDATE games SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, id));
  }
  if (u.note !== undefined) writes.push(db.prepare('UPDATE games SET note = ?, updated_at = ? WHERE id = ?').bind(u.note || null, now, id));
  if (writes.length) await db.batch(writes);
  return c.json(await loadGame(c.env, id));
});

// A calendar event for the game; the phone offers "Add to Calendar".
app.get('/:id/ics', async (c) => {
  const game = await loadGame(c.env, c.req.param('id'));
  if (!game) return c.json({ error: 'not found' }, 404);
  const start = new Date(game.times[0].teetime);
  const end = new Date(Date.parse(game.times.at(-1)!.teetime) + (game.holes === 18 ? 270 : 135) * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const text = (s: string) => s.replace(/[\\;,]/g, (ch) => `\\${ch}`).replace(/\n/g, '\\n');
  const name = courseByCode(game.code)?.name ?? game.code;
  const teeTimes = game.times.length > 1 ? `Tee times ${game.times.map(timeLabel).join(', ')}\n` : '';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//golf//tee times//EN', 'BEGIN:VEVENT',
    `UID:${game.id}@golf`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`Golf: ${name} (${game.holes} holes)`)}`,
    `LOCATION:${text(`${name} Golf Course, New York`)}`,
    `DESCRIPTION:${text(`${teeTimes}With ${names(game) || 'the group'}${game.note ? `\n${game.note}` : ''}`)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  return c.body(ics, 200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="tee-time.ics"' });
});

/** Cron: at 7am New York time, remind everyone who's in about today's games. */
export async function remindGames(env: Env, now: Date): Promise<void> {
  const { hour, minute } = nyClock(now);
  if (hour !== 7 || minute >= 15) return;
  const games = await loadGames(env, "g.date = ? AND g.status != 'cancelled'", [nyToday(now)]);
  for (const game of games) {
    const to = await wantGames(env, ins(game).map((p) => p.email));
    const times = game.times.map(timeLabel).join(' & ');
    await notify(env, to, {
      title: `Today: ${gameLabel(game)}`,
      body: game.status === 'booked' ? `${times} with ${names(game)} · start your round from the app` : `Not booked yet · ${names(game)}`,
      ...gameLink(game),
    });
  }
}

export default app;
