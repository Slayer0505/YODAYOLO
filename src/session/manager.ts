import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { L0Actor, L0Event, L0EventType, EvidenceSource, EvidenceType } from '../types';
import type { L0EventLedger } from '../db/ledger';
import type { EvidenceBus } from '../evidence/bus';
import { PrivacyRedactor } from './privacy';

export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED';

export type ObservationSource = 'agent' | 'terminal' | 'ide' | 'git' | 'filesystem' | 'browser' | 'test' | 'system';

export interface SessionActorTaxonomy {
  category: 'human' | 'agent' | 'environment';
  actionType: string;
}

export interface SessionRecord {
  session_id: string;
  project_id: string;
  workspace_path: string;
  status: SessionStatus;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  active_task: string | null;
  active_agents: string[];
  active_models: string[];
  active_tools: string[];
  source_configs: Record<string, boolean>;
  events_count: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata: Record<string, unknown>;
}

export interface SessionEventInput {
  sessionId?: string;
  projectId?: string;
  source: ObservationSource;
  actor: 'human' | 'agent' | 'environment';
  eventType: string;
  task?: string;
  model?: string;
  tool?: string;
  payload: unknown;
  correlationId?: string;
  parentEventId?: string | null;
  metadata?: Record<string, unknown>;
}

export class SessionManager {
  private db: Database;
  private ledger: L0EventLedger;
  private evidenceBus?: EvidenceBus;
  private redactor: PrivacyRedactor;
  private activeSessionId: string | null = null;
  private isObservationEnabled: boolean = true;
  private enabledSources: Set<ObservationSource> = new Set([
    'agent',
    'terminal',
    'ide',
    'git',
    'filesystem',
    'test',
    'system',
  ]);

  constructor(options: {
    db?: Database;
    ledger: L0EventLedger;
    evidenceBus?: EvidenceBus;
    redactor?: PrivacyRedactor;
  }) {
    this.ledger = options.ledger;
    this.db = options.db || options.ledger.getDatabase();
    this.evidenceBus = options.evidenceBus;
    this.redactor = options.redactor || new PrivacyRedactor();

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        active_task TEXT,
        active_agents TEXT NOT NULL,
        active_models TEXT NOT NULL,
        active_tools TEXT NOT NULL,
        source_configs TEXT NOT NULL,
        events_count INTEGER NOT NULL DEFAULT 0,
        risk_level TEXT NOT NULL DEFAULT 'LOW',
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    `);
  }

  public setEvidenceBus(bus: EvidenceBus): void {
    this.evidenceBus = bus;
  }

  // --------------------------------------------------------------------------
  // OBSERVATION CONTROLS (Privacy, Toggles, Pause/Resume)
  // --------------------------------------------------------------------------

  public enableObservation(): void {
    this.isObservationEnabled = true;
  }

  public pauseObservation(): void {
    this.isObservationEnabled = false;
  }

  public resumeObservation(): void {
    this.isObservationEnabled = true;
  }

  public isObserving(): boolean {
    return this.isObservationEnabled;
  }

  public enableSource(source: ObservationSource): void {
    this.enabledSources.add(source);
  }

  public disableSource(source: ObservationSource): void {
    this.enabledSources.delete(source);
  }

  public getActiveSources(): ObservationSource[] {
    return Array.from(this.enabledSources);
  }

  public isSourceActive(source: ObservationSource): boolean {
    return this.isObservationEnabled && this.enabledSources.has(source);
  }

  // --------------------------------------------------------------------------
  // SESSION LIFECYCLE MANAGEMENT
  // --------------------------------------------------------------------------

  public startSession(params: {
    sessionId?: string;
    projectId?: string;
    workspacePath?: string;
    task?: string;
    agents?: string[];
    models?: string[];
    tools?: string[];
    metadata?: Record<string, unknown>;
  }): SessionRecord {
    const sessionId = params.sessionId || `sess-${randomUUID()}`;
    const now = new Date().toISOString();
    const sourceConfigs: Record<string, boolean> = {};
    for (const src of this.enabledSources) {
      sourceConfigs[src] = true;
    }

    const session: SessionRecord = {
      session_id: sessionId,
      project_id: params.projectId || 'default',
      workspace_path: params.workspacePath || process.cwd(),
      status: 'ACTIVE',
      started_at: now,
      updated_at: now,
      completed_at: null,
      active_task: params.task || null,
      active_agents: params.agents || ['agent-primary'],
      active_models: params.models || ['neutral-reasoner'],
      active_tools: params.tools || [],
      source_configs: sourceConfigs,
      events_count: 0,
      risk_level: 'LOW',
      metadata: params.metadata || {},
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        session_id, project_id, workspace_path, status, started_at, updated_at,
        completed_at, active_task, active_agents, active_models, active_tools,
        source_configs, events_count, risk_level, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.session_id,
      session.project_id,
      session.workspace_path,
      session.status,
      session.started_at,
      session.updated_at,
      session.completed_at,
      session.active_task,
      JSON.stringify(session.active_agents),
      JSON.stringify(session.active_models),
      JSON.stringify(session.active_tools),
      JSON.stringify(session.source_configs),
      session.events_count,
      session.risk_level,
      JSON.stringify(session.metadata)
    );

    this.activeSessionId = sessionId;

    // Log session start in L0
    this.ledger.appendEvent({
      sessionId,
      projectId: session.project_id,
      correlationId: `corr-${sessionId}`,
      actor: 'system',
      eventType: 'session_started',
      payload: {
        session_id: sessionId,
        project_id: session.project_id,
        active_task: session.active_task,
        sources: Array.from(this.enabledSources),
      },
    });

    return session;
  }

  public getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as any;
    if (!row) return null;
    return this.mapRowToSession(row);
  }

  public getActiveSession(): SessionRecord | null {
    if (this.activeSessionId) {
      const active = this.getSession(this.activeSessionId);
      if (active && active.status === 'ACTIVE') return active;
    }
    const row = this.db.prepare("SELECT * FROM sessions WHERE status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1").get() as any;
    if (!row) return null;
    return this.mapRowToSession(row);
  }

  public getOrCreateActiveSession(projectId: string = 'default'): SessionRecord {
    const existing = this.getActiveSession();
    if (existing) return existing;
    return this.startSession({ projectId });
  }

  public updateSessionTask(sessionId: string, task: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE sessions SET active_task = ?, updated_at = ? WHERE session_id = ?').run(task, now, sessionId);
  }

  public completeSession(sessionId: string): SessionRecord | null {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE sessions SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE session_id = ?").run(now, now, sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    return this.getSession(sessionId);
  }

  public endSession(sessionId?: string): SessionRecord | null {
    const targetId = sessionId || this.activeSessionId || this.getActiveSession()?.session_id;
    if (!targetId) return null;
    return this.completeSession(targetId);
  }

  // --------------------------------------------------------------------------
  // SENSORY OBSERVATION & EVENT CAPTURE
  // --------------------------------------------------------------------------

  public recordEvent(input: SessionEventInput): L0Event | null {
    if (!this.isSourceActive(input.source)) {
      return null;
    }

    const session = input.sessionId ? this.getSession(input.sessionId) : this.getOrCreateActiveSession(input.projectId);
    const sessionId = session ? session.session_id : input.sessionId || null;
    const projectId = session ? session.project_id : input.projectId || 'default';

    // 1. Redact sensitive values from payload
    const safePayload = this.redactor.redactObject(input.payload);
    const correlationId = input.correlationId || `corr-${randomUUID()}`;

    // 2. Map actor to L0Actor taxonomy (human -> user, agent -> provider, environment -> system/tool)
    let l0Actor: L0Actor = 'system';
    if (input.actor === 'human') l0Actor = 'user';
    else if (input.actor === 'agent') l0Actor = 'provider';
    else if ((input.source as string) === 'tool' || input.source === 'git' || input.source === 'filesystem') l0Actor = 'tool';

    // 3. Append to immutable L0 Raw Ledger
    const l0Event = this.ledger.appendEvent({
      parentEventId: input.parentEventId,
      correlationId,
      sessionId,
      projectId,
      actor: l0Actor,
      eventType: input.eventType as L0EventType,
      payload: safePayload,
      metadata: {
        source: input.source,
        raw_actor: input.actor,
        task: input.task || session?.active_task,
        model: input.model,
        tool: input.tool,
        ...(input.metadata || {}),
      },
    });

    // 4. Update session metadata & participants
    if (sessionId && session) {
      const activeAgents = new Set(session.active_agents);
      const activeModels = new Set(session.active_models);
      const activeTools = new Set(session.active_tools);

      if (input.actor === 'agent' && input.model) activeModels.add(input.model);
      if (input.tool) activeTools.add(input.tool);

      this.db.prepare(`
        UPDATE sessions SET
          events_count = events_count + 1,
          updated_at = ?,
          active_models = ?,
          active_tools = ?
        WHERE session_id = ?
      `).run(
        new Date().toISOString(),
        JSON.stringify(Array.from(activeModels)),
        JSON.stringify(Array.from(activeTools)),
        sessionId
      );
    }

    // 5. Ingest Sensory Signal into Unified Evidence Bus
    if (this.evidenceBus) {
      this.evidenceBus.ingestSignal({
        signal_id: `sig-${randomUUID()}`,
        source: input.source as EvidenceSource,
        type: input.eventType as EvidenceType,
        correlation_id: correlationId,
        project_id: projectId,
        files: (input.metadata?.files as string[]) || [],
        timestamp: new Date().toISOString(),
        payload: safePayload as Record<string, unknown>,
      });
    }

    return l0Event;
  }

  public getSessionEvents(sessionId: string): L0Event[] {
    const rows = this.db
      .prepare('SELECT * FROM l0_events WHERE session_id = ? ORDER BY timestamp_epoch_ms ASC')
      .all(sessionId) as any[];
    return rows.map((r) => this.ledger.getEventById(r.event_id)!);
  }

  private mapRowToSession(row: any): SessionRecord {
    return {
      session_id: row.session_id,
      project_id: row.project_id,
      workspace_path: row.workspace_path,
      status: row.status as SessionStatus,
      started_at: row.started_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      active_task: row.active_task,
      active_agents: JSON.parse(row.active_agents || '[]'),
      active_models: JSON.parse(row.active_models || '[]'),
      active_tools: JSON.parse(row.active_tools || '[]'),
      source_configs: JSON.parse(row.source_configs || '{}'),
      events_count: row.events_count,
      risk_level: row.risk_level,
      metadata: JSON.parse(row.metadata || '{}'),
    };
  }
}
