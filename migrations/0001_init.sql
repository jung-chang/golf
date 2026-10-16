-- Group members. Rows are created on first visit (the email comes from Cloudflare Access).
CREATE TABLE members (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  home_course TEXT,
  show_handicap INTEGER NOT NULL DEFAULT 0,
  notify_games INTEGER NOT NULL DEFAULT 1,
  handicap REAL,
  created_at TEXT NOT NULL
);

-- One web-push subscription per device.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  keys TEXT NOT NULL
);

-- A tee time proposed to the group.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  facility_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  teetime TEXT NOT NULL,
  holes INTEGER NOT NULL,
  spots INTEGER NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | booked | cancelled
  booked_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX games_teetime ON games (teetime);

CREATE TABLE game_players (
  game_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL, -- in | out
  PRIMARY KEY (game_id, email)
);

-- criteria and seen are JSON (validated with Zod).
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  criteria TEXT NOT NULL,
  seen TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  checked_at TEXT
);

-- Shot tracking. A round is one JSON document; the other columns are for listing and conflict checks.
CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  date TEXT NOT NULL,
  course_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX rounds_email_date ON rounds (email, date);

CREATE TABLE settings (
  email TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (email, key)
);
