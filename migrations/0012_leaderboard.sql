-- Preserve historical landings; future landings consume a single-use receipt.
ALTER TABLE visits ADD COLUMN visit_token_id TEXT;
CREATE UNIQUE INDEX idx_visits_token ON visits(visit_token_id) WHERE visit_token_id IS NOT NULL;

CREATE TABLE user_visit_totals (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0)
);
INSERT INTO user_visit_totals(user_id, visits)
SELECT user_id, COUNT(*) FROM visits GROUP BY user_id;
CREATE INDEX idx_user_visit_totals_rank ON user_visit_totals(visits DESC, user_id);

CREATE TRIGGER visits_total_insert AFTER INSERT ON visits BEGIN
  INSERT INTO user_visit_totals(user_id, visits) VALUES (NEW.user_id, 1)
  ON CONFLICT(user_id) DO UPDATE SET visits = visits + 1;
END;
CREATE TRIGGER visits_total_delete AFTER DELETE ON visits BEGIN
  UPDATE user_visit_totals SET visits = visits - 1 WHERE user_id = OLD.user_id;
END;
