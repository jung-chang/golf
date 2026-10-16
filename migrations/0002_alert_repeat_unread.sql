-- weekdays: JSON list of days (0 = Sunday) for an alert that repeats every week; [] = its fixed dates.
-- unread: JSON list of time keys the cron found and notified about that the member hasn't looked at yet.
ALTER TABLE alerts ADD COLUMN weekdays TEXT NOT NULL DEFAULT '[]';
ALTER TABLE alerts ADD COLUMN unread TEXT NOT NULL DEFAULT '[]';
