-- Incomplete or unsafe public names must be chosen by the account owner.
UPDATE users SET username = NULL
WHERE username IS NOT NULL AND (
  length(username) NOT BETWEEN 1 AND 32 OR username GLOB '*[^A-Za-z0-9_-]*'
);
-- Keep the earliest account's spelling if legacy names differ only by case.
-- Other accounts keep all progress and are prompted to choose a distinct name.
UPDATE users SET username = NULL WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY username COLLATE NOCASE ORDER BY created_at, id) AS ordinal
    FROM users WHERE username IS NOT NULL
  ) WHERE ordinal > 1
);
CREATE UNIQUE INDEX idx_users_username_nocase ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;
