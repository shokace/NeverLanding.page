-- Store provenance for new unlocks without changing existing awards or timestamps.
ALTER TABLE user_achievements ADD COLUMN source_url TEXT;
UPDATE achievements SET description = '???' WHERE code = 'explorer_level_3';
