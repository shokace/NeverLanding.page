-- Add local auth fields for email/password sign-in

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_algo TEXT;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;
