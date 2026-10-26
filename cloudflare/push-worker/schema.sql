-- Identificadores idempotentes de entrega; nunca armazenar tokens FCM aqui.
CREATE TABLE IF NOT EXISTS delivered (
  event_key TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS delivered_created_at ON delivered(created_at);

-- Diagnostico agregado por hora e tipo; nao contem UID, token FCM, IDs de eventos
-- individuais, corpo da mensagem, IP ou dados pessoais.
CREATE TABLE IF NOT EXISTS push_delivery_stats (
  hour_bucket INTEGER NOT NULL,
  kind TEXT NOT NULL,
  outcome TEXT NOT NULL,
  fcm_http_status INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 1,
  attempted INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_bucket, kind, outcome, fcm_http_status)
);
CREATE INDEX IF NOT EXISTS push_delivery_stats_hour ON push_delivery_stats(hour_bucket);


-- Reservas limitadas de inferência. Sem texto, UID ou resposta do modelo.
CREATE TABLE IF NOT EXISTS guardiao_ai_budget (
  event_key TEXT PRIMARY KEY NOT NULL,
  day_bucket INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guardiao_ai_budget_day ON guardiao_ai_budget(day_bucket);

