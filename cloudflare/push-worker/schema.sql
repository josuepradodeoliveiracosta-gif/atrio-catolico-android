-- Identificadores idempotentes de entrega; nunca armazenar tokens FCM aqui.
CREATE TABLE IF NOT EXISTS delivered (
  event_key TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS delivered_created_at ON delivered(created_at);
