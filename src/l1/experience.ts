import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type {
  EvidenceSignal,
  L1ClosureReason,
  L1Experience,
  L1ExperienceStatus,
  MemoryTier,
} from '../types';

export interface CreateExperienceParams {
  experienceId?: string;
  correlationId: string;
  sessionId?: string | null;
  projectId?: string;
  intent: string;
  model: string;
  affectedFiles?: string[];
  supportingL0EventIds?: string[];
  observationWindowMs?: number;
  memoryTier?: MemoryTier;
  metadata?: Record<string, unknown>;
}

export class L1ExperienceManager {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS l1_experiences (
        experience_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        session_id TEXT,
        project_id TEXT NOT NULL DEFAULT 'default',
        intent TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        closure_reason TEXT,
        observation_window_ms INTEGER NOT NULL DEFAULT 7200000,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        reopened_at TEXT,
        reopen_count INTEGER NOT NULL DEFAULT 0,
        affected_files TEXT NOT NULL,
        supporting_l0_event_ids TEXT NOT NULL,
        evidence_log TEXT NOT NULL,
        memory_tier TEXT NOT NULL DEFAULT 'HOT',
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_l1_correlation ON l1_experiences(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_l1_status ON l1_experiences(status);
      CREATE INDEX IF NOT EXISTS idx_l1_project ON l1_experiences(project_id);
      CREATE INDEX IF NOT EXISTS idx_l1_tier ON l1_experiences(memory_tier);
    `);

    try {
      this.db.exec(`ALTER TABLE l1_experiences ADD COLUMN memory_tier TEXT NOT NULL DEFAULT 'HOT'`);
    } catch {
      // Column already exists
    }
  }

  public createExperience(params: CreateExperienceParams): L1Experience {
    const experienceId = params.experienceId || `exp-${randomUUID()}`;
    const now = new Date().toISOString();
    const projectId = params.projectId || 'default';
    const affectedFiles = params.affectedFiles || [];
    const supportingL0EventIds = params.supportingL0EventIds || [];
    const windowMs = params.observationWindowMs || 7200000; // 2 hours default

    const exp: L1Experience = {
      experience_id: experienceId,
      correlation_id: params.correlationId,
      session_id: params.sessionId ?? null,
      project_id: projectId,
      intent: params.intent,
      model: params.model,
      status: 'PROPOSED',
      confidence: 0.5,
      closure_reason: null,
      observation_window_ms: windowMs,
      opened_at: now,
      closed_at: null,
      reopened_at: null,
      reopen_count: 0,
      affected_files: affectedFiles,
      supporting_l0_event_ids: supportingL0EventIds,
      evidence_log: [],
      memory_tier: params.memoryTier || 'HOT',
      metadata: params.metadata || null,
    };

    this.db
      .prepare(`
      INSERT INTO l1_experiences (
        experience_id, correlation_id, session_id, project_id, intent, model,
        status, confidence, closure_reason, observation_window_ms,
        opened_at, closed_at, reopened_at, reopen_count,
        affected_files, supporting_l0_event_ids, evidence_log, memory_tier, metadata
      ) VALUES (
        $experience_id, $correlation_id, $session_id, $project_id, $intent, $model,
        $status, $confidence, $closure_reason, $observation_window_ms,
        $opened_at, $closed_at, $reopened_at, $reopen_count,
        $affected_files, $supporting_l0_event_ids, $evidence_log, $memory_tier, $metadata
      )
    `)
      .run({
        $experience_id: exp.experience_id,
        $correlation_id: exp.correlation_id,
        $session_id: exp.session_id,
        $project_id: exp.project_id,
        $intent: exp.intent,
        $model: exp.model,
        $status: exp.status,
        $confidence: exp.confidence,
        $closure_reason: exp.closure_reason,
        $observation_window_ms: exp.observation_window_ms,
        $opened_at: exp.opened_at,
        $closed_at: exp.closed_at,
        $reopened_at: exp.reopened_at,
        $reopen_count: exp.reopen_count,
        $affected_files: JSON.stringify(exp.affected_files),
        $supporting_l0_event_ids: JSON.stringify(exp.supporting_l0_event_ids),
        $evidence_log: JSON.stringify(exp.evidence_log),
        $memory_tier: exp.memory_tier || 'HOT',
        $metadata: exp.metadata ? JSON.stringify(exp.metadata) : null,
      });

    return exp;
  }

  public transitionState(
    experienceId: string,
    newStatus: L1ExperienceStatus,
    closureReason?: L1ClosureReason | string | null
  ): L1Experience {
    return this.transitionStatus(experienceId, newStatus, {
      closureReason: closureReason as any,
    });
  }

  public transitionStatus(
    experienceId: string,
    newStatus: L1ExperienceStatus,
    updates: {
      confidence?: number;
      closureReason?: L1ClosureReason | null;
      evidence?: EvidenceSignal;
    } = {}
  ): L1Experience {
    const current = this.getExperience(experienceId);
    if (!current) {
      throw new Error(`Experience not found: ${experienceId}`);
    }

    const now = new Date().toISOString();
    let closedAt = current.closed_at;
    let reopenedAt = current.reopened_at;
    let reopenCount = current.reopen_count;

    if (newStatus === 'REOPENED_BY_EVIDENCE') {
      reopenedAt = now;
      reopenCount += 1;
      closedAt = null;
    } else if (['SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE', 'UNKNOWN'].includes(newStatus)) {
      closedAt = now;
    }

    const updatedEvidenceLog = [...current.evidence_log];
    if (updates.evidence) {
      updatedEvidenceLog.push(updates.evidence);
    }

    const confidence = updates.confidence !== undefined ? updates.confidence : current.confidence;
    const closureReason = updates.closureReason !== undefined ? updates.closureReason : current.closure_reason;

    this.db
      .prepare(`
      UPDATE l1_experiences
      SET status = $status,
          confidence = $confidence,
          closure_reason = $closure_reason,
          closed_at = $closed_at,
          reopened_at = $reopened_at,
          reopen_count = $reopen_count,
          evidence_log = $evidence_log
      WHERE experience_id = $experience_id
    `)
      .run({
        $experience_id: experienceId,
        $status: newStatus,
        $confidence: confidence,
        $closure_reason: closureReason,
        $closed_at: closedAt,
        $reopened_at: reopenedAt,
        $reopen_count: reopenCount,
        $evidence_log: JSON.stringify(updatedEvidenceLog),
      });

    return this.getExperience(experienceId)!;
  }

  public markProvisionallyAccepted(experienceId: string): L1Experience {
    return this.transitionStatus(experienceId, 'PROVISIONALLY_ACCEPTED', { confidence: 0.6 });
  }

  public startObservation(experienceId: string): L1Experience {
    return this.transitionStatus(experienceId, 'OBSERVATION', { confidence: 0.65 });
  }

  public settleOutcome(
    experienceId: string,
    outcome: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILURE' | 'UNKNOWN',
    confidence: number,
    closureReason: L1ClosureReason,
    evidence?: EvidenceSignal
  ): L1Experience {
    return this.transitionStatus(experienceId, outcome, {
      confidence,
      closureReason,
      evidence,
    });
  }

  public reopenWithEvidence(experienceId: string, evidence: EvidenceSignal): L1Experience {
    const current = this.getExperience(experienceId);
    if (!current) throw new Error(`Experience not found: ${experienceId}`);
    return this.transitionStatus(experienceId, 'REOPENED_BY_EVIDENCE', {
      evidence,
      closureReason: null,
    });
  }

  public reclassify(
    experienceId: string,
    newOutcome: 'PARTIAL_SUCCESS' | 'FAILURE',
    confidence: number,
    closureReason: L1ClosureReason
  ): L1Experience {
    return this.transitionStatus(experienceId, newOutcome, {
      confidence,
      closureReason,
    });
  }

  public addSupportingL0Event(experienceId: string, l0EventId: string): void {
    const exp = this.getExperience(experienceId);
    if (!exp) return;
    if (!exp.supporting_l0_event_ids.includes(l0EventId)) {
      const updated = [...exp.supporting_l0_event_ids, l0EventId];
      this.db
        .prepare('UPDATE l1_experiences SET supporting_l0_event_ids = ? WHERE experience_id = ?')
        .run(JSON.stringify(updated), experienceId);
    }
  }

  public getExperience(experienceId: string): L1Experience | null {
    const row = this.db.prepare('SELECT * FROM l1_experiences WHERE experience_id = ?').get(experienceId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getExperienceByCorrelationId(correlationId: string): L1Experience | null {
    const row = this.db.prepare('SELECT * FROM l1_experiences WHERE correlation_id = ?').get(correlationId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findActiveExperiencesByFiles(projectId: string, files: string[]): L1Experience[] {
    const rows = this.db
      .prepare(`SELECT * FROM l1_experiences WHERE project_id = ? AND status IN ('PROPOSED', 'PROVISIONALLY_ACCEPTED', 'OBSERVATION', 'REOPENED_BY_EVIDENCE')`)
      .all(projectId) as any[];

    const experiences = rows.map((r) => this.mapRow(r));
    if (files.length === 0) return experiences;

    return experiences.filter((exp) => {
      return exp.affected_files.some((f) => files.includes(f));
    });
  }

  public getAllExperiences(): L1Experience[] {
    const rows = this.db.prepare('SELECT * FROM l1_experiences ORDER BY opened_at DESC').all() as any[];
    return rows.map((r) => this.mapRow(r));
  }

  public updateMemoryTier(experienceId: string, tier: MemoryTier): void {
    this.db.prepare(`UPDATE l1_experiences SET memory_tier = ? WHERE experience_id = ?`).run(tier, experienceId);
  }

  public getExperiencesByTier(tier: MemoryTier): L1Experience[] {
    const rows = this.db.prepare('SELECT * FROM l1_experiences WHERE memory_tier = ? ORDER BY opened_at DESC').all(tier) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: any): L1Experience {
    return {
      experience_id: row.experience_id,
      correlation_id: row.correlation_id,
      session_id: row.session_id,
      project_id: row.project_id,
      intent: row.intent,
      model: row.model,
      status: row.status as L1ExperienceStatus,
      confidence: row.confidence,
      closure_reason: row.closure_reason as L1ClosureReason | null,
      observation_window_ms: row.observation_window_ms,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
      reopened_at: row.reopened_at,
      reopen_count: row.reopen_count,
      affected_files: JSON.parse(row.affected_files || '[]'),
      supporting_l0_event_ids: JSON.parse(row.supporting_l0_event_ids || '[]'),
      evidence_log: JSON.parse(row.evidence_log || '[]'),
      memory_tier: (row.memory_tier || 'HOT') as MemoryTier,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }
}
