CREATE TABLE IF NOT EXISTS calendar_event (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('personal', 'family', 'digital_side')
  ),
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_starts_at
ON calendar_event(starts_at);
