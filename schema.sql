CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('restaurant','calendar')),
  title TEXT NOT NULL,
  headcount INTEGER NOT NULL CHECK(headcount BETWEEN 2 AND 30),
  created_at TEXT NOT NULL,
  final_restaurant INTEGER,
  final_date TEXT,
  final_place TEXT,
  final_time TEXT
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL,
  edit_token TEXT NOT NULL,
  likes TEXT NOT NULL DEFAULT '[]',
  dislikes TEXT NOT NULL DEFAULT '[]',
  dates TEXT NOT NULL DEFAULT '[]',
  place TEXT,
  available_time TEXT,
  on_duty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS participants_session_idx ON participants(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS participants_session_name_idx ON participants(session_id,name);
