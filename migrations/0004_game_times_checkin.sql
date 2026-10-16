-- A game can hold several tee times (eight players = two foursomes) and has no player cap.
-- times: JSON [{teetime, time, spots, bookedBy}], earliest first; games.teetime stays as the earliest, for sorting.
ALTER TABLE games ADD COLUMN times TEXT NOT NULL DEFAULT '[]';
UPDATE games SET times = json_array(json_object('teetime', teetime, 'time', time, 'spots', spots, 'bookedBy', booked_by));
ALTER TABLE games DROP COLUMN time;
ALTER TABLE games DROP COLUMN spots;
ALTER TABLE games DROP COLUMN booked_by;

-- When the player checked in on the day (started their round from the game).
ALTER TABLE game_players ADD COLUMN checked_in TEXT;
