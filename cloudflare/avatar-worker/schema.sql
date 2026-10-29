-- Criar na base D1 dedicada às fotos ANTES de implantar o Worker.
CREATE TABLE IF NOT EXISTS avatar_rate (
  uid TEXT PRIMARY KEY NOT NULL,
  next_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS avatar_pending (
  uid TEXT PRIMARY KEY NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS avatar_moderation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_uid TEXT NOT NULL,
  target_uid TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
