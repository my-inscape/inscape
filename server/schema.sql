-- INSCAPE invitation / anonymous session schema
-- Diary content and colors are NEVER stored on the server.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invitation_codes (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  origin_route TEXT NOT NULL,
  is_used INTEGER NOT NULL DEFAULT 0 CHECK (is_used IN (0, 1)),
  used_at TEXT,
  issued_by_session_id TEXT,
  is_reusable INTEGER NOT NULL DEFAULT 0 CHECK (is_reusable IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_unused
  ON invitation_codes (is_used);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_session
  ON invitation_codes (issued_by_session_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  origin_route TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invite_code) REFERENCES invitation_codes(code)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at);
