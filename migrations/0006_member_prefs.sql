-- Display preferences follow the member across devices. NULL = never chosen (the device's copy wins once).
ALTER TABLE members ADD COLUMN theme TEXT;
ALTER TABLE members ADD COLUMN temperature_unit TEXT;
