ALTER TABLE water_readings ADD COLUMN free_chlorine REAL;
ALTER TABLE water_readings ADD COLUMN total_chlorine REAL;
ALTER TABLE water_readings ADD COLUMN hardness REAL;
ALTER TABLE water_readings ADD COLUMN cyanuric_acid REAL;
ALTER TABLE water_readings ADD COLUMN salt REAL;
ALTER TABLE water_readings ADD COLUMN pressure_psi REAL;
ALTER TABLE water_readings ADD COLUMN water_level TEXT;
ALTER TABLE water_readings ADD COLUMN pressure_photo_key TEXT;
ALTER TABLE water_readings ADD COLUMN level_photo_key TEXT;

UPDATE water_readings
SET free_chlorine=chlorine
WHERE free_chlorine IS NULL;
