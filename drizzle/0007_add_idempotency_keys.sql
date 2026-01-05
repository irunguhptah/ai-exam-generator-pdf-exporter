-- Add idempotency_keys table to record idempotency keys for safe retries
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  exam_id INTEGER,
  domain TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (exam_id) REFERENCES exams(id)
);
