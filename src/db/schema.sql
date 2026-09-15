CREATE TABLE IF NOT EXISTS l0_events (
    event_id TEXT PRIMARY KEY,
    parent_event_id TEXT,
    correlation_id TEXT NOT NULL,
    session_id TEXT,
    project_id TEXT NOT NULL DEFAULT 'default',
    actor TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    timestamp_epoch_ms INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL,
    payload TEXT NOT NULL,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_l0_correlation_id ON l0_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_l0_timestamp ON l0_events(timestamp_epoch_ms);
CREATE INDEX IF NOT EXISTS idx_l0_event_type ON l0_events(event_type);
CREATE INDEX IF NOT EXISTS idx_l0_parent_event_id ON l0_events(parent_event_id);
