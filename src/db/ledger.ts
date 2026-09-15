import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'crypto';
import type { L0Actor, L0Event, L0EventType } from '../types';
import { PrivacyRedactor } from '../session/privacy';

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJsonStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalJsonStringify(val);
  });
  return '{' + pairs.join(',') + '}';
}

export function computeContentHash(payload: unknown): string {
  const canonical = canonicalJsonStringify(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface AppendEventParams {
  eventId?: string;
  parentEventId?: string | null;
  correlationId: string;
  sessionId?: string | null;
  projectId?: string;
  actor: L0Actor;
  eventType: L0EventType;
  payload: unknown;
  metadata?: Record<string, unknown> | null;
}

export class L0EventLedger {
  private db: Database;
  private insertStmt: ReturnType<Database['prepare']>;
  private redactor: PrivacyRedactor;

  public getDatabase(): Database {
    return this.db;
  }

  constructor(dbOrPath: string | Database = 'original_brain_l0.db') {
    this.redactor = new PrivacyRedactor();
    if (typeof dbOrPath === 'string') {
      this.db = new Database(dbOrPath, { create: true });
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
    } else {
      this.db = dbOrPath;
    }

    this.initSchema();

    this.insertStmt = this.db.prepare(`
      INSERT INTO l0_events (
        event_id, parent_event_id, correlation_id, session_id,
        project_id, actor, event_type, timestamp, timestamp_epoch_ms,
        schema_version, content_hash, payload, metadata
      ) VALUES (
        $event_id, $parent_event_id, $correlation_id, $session_id,
        $project_id, $actor, $event_type, $timestamp, $timestamp_epoch_ms,
        $schema_version, $content_hash, $payload, $metadata
      )
    `);
  }

  private initSchema(): void {
    this.db.exec(`
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
    `);
  }

  public appendEvent(params: AppendEventParams | any): L0Event {
    const now = new Date();
    const eventId = params.eventId || params.event_id || randomUUID();
    const sanitizedPayload = this.redactor.redactObject(params.payload);
    const contentHash = computeContentHash(sanitizedPayload);
    const payloadStr = canonicalJsonStringify(sanitizedPayload);
    const sanitizedMetadata = params.metadata ? this.redactor.redactObject(params.metadata) : null;
    const metadataStr = sanitizedMetadata ? canonicalJsonStringify(sanitizedMetadata) : null;
    const projectId = params.projectId || params.project_id || 'default';
    const parentEventId = params.parentEventId ?? params.parent_event_id ?? null;
    const sessionId = params.sessionId ?? params.session_id ?? null;
    const correlationId = params.correlationId || params.correlation_id;
    const eventType = params.eventType || params.event_type;

    const event: L0Event = {
      event_id: eventId,
      parent_event_id: parentEventId,
      correlation_id: correlationId,
      session_id: sessionId,
      project_id: projectId,
      actor: params.actor,
      event_type: eventType,
      timestamp: now.toISOString(),
      timestamp_epoch_ms: now.getTime(),
      schema_version: 1,
      content_hash: contentHash,
      payload: typeof sanitizedPayload === 'string' ? sanitizedPayload : (sanitizedPayload as Record<string, unknown>),
      metadata: sanitizedMetadata as Record<string, unknown> | null,
    };

    this.insertStmt.run({
      $event_id: event.event_id,
      $parent_event_id: event.parent_event_id,
      $correlation_id: event.correlation_id,
      $session_id: event.session_id,
      $project_id: event.project_id,
      $actor: event.actor,
      $event_type: event.event_type,
      $timestamp: event.timestamp,
      $timestamp_epoch_ms: event.timestamp_epoch_ms,
      $schema_version: event.schema_version,
      $content_hash: event.content_hash,
      $payload: payloadStr,
      $metadata: metadataStr,
    });

    return event;
  }

  public getEventById(eventId: string): L0Event | null {
    const row = this.db.prepare('SELECT * FROM l0_events WHERE event_id = ?').get(eventId) as any;
    if (!row) return null;
    return this.mapRowToEvent(row);
  }

  public getEvent(eventId: string): L0Event | null {
    return this.getEventById(eventId);
  }

  public getEventsByCorrelationId(correlationId: string): L0Event[] {
    const rows = this.db
      .prepare('SELECT * FROM l0_events WHERE correlation_id = ? ORDER BY timestamp_epoch_ms ASC')
      .all(correlationId) as any[];
    return rows.map((r) => this.mapRowToEvent(r));
  }

  public getAllEvents(limit: number = 100, offset: number = 0): L0Event[] {
    const rows = this.db
      .prepare('SELECT * FROM l0_events ORDER BY timestamp_epoch_ms ASC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
    return rows.map((r) => this.mapRowToEvent(r));
  }

  public getEventCount(): number {
    const res = this.db.prepare('SELECT COUNT(*) as count FROM l0_events').get() as { count: number };
    return res.count;
  }

  public verifyEventHash(eventId: string): boolean {
    const event = this.getEventById(eventId);
    if (!event) return false;
    const computed = computeContentHash(event.payload);
    return computed === event.content_hash;
  }

  private mapRowToEvent(row: any): L0Event {
    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(row.payload);
    } catch {
      parsedPayload = row.payload;
    }

    let parsedMetadata: any = null;
    if (row.metadata) {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch {
        parsedMetadata = null;
      }
    }

    return {
      event_id: row.event_id,
      parent_event_id: row.parent_event_id,
      correlation_id: row.correlation_id,
      session_id: row.session_id,
      project_id: row.project_id,
      actor: row.actor as L0Actor,
      event_type: row.event_type as L0EventType,
      timestamp: row.timestamp,
      timestamp_epoch_ms: row.timestamp_epoch_ms,
      schema_version: row.schema_version,
      content_hash: row.content_hash,
      payload: parsedPayload,
      metadata: parsedMetadata,
    };
  }

  public close(): void {
    this.db.close();
  }
}

export { L0EventLedger as L0Ledger, computeContentHash as computeSha256 };
