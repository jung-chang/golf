-- How often an alert is checked, in hours: 1, 4 or 12 (see CHECK_HOURS in worker/alerts.ts).
ALTER TABLE alerts ADD COLUMN every INTEGER NOT NULL DEFAULT 4;
