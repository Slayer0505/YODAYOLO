import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { L0EventLedger } from '../db/ledger';

export type BeadStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'RESOLVED' | 'CLOSED';

export interface BeadTask {
  bead_id: string;
  title: string;
  description: string;
  status: BeadStatus;
  assignee_agent: string | null;
  project_id: string;
  parent_bead_id: string | null;
  correlation_id: string;
  supporting_experience_ids: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateBeadParams {
  beadId?: string;
  title: string;
  description: string;
  assigneeAgent?: string;
  projectId?: string;
  parentBeadId?: string;
  correlationId?: string;
  tags?: string[];
}

/**
 * Beads-Lite: Lightweight Cross-Agent Task & Issue Continuity Manager.
 * Maintains persistent task state and handoff continuity across distinct agents/models
 * without turning the Brain into a heavy orchestration engine.
 */
export class BeadsLiteManager {
  private db: Database;
  private ledger?: L0EventLedger;

  constructor(db: Database, ledger?: L0EventLedger) {
    this.db = db;
    this.ledger = ledger;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS beads_tasks (
        bead_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        assignee_agent TEXT,
        project_id TEXT NOT NULL DEFAULT 'default',
        parent_bead_id TEXT,
        correlation_id TEXT NOT NULL,
        supporting_experience_ids TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_beads_status ON beads_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_beads_project ON beads_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_beads_assignee ON beads_tasks(assignee_agent);
    `);
  }

  public createBead(params: CreateBeadParams): BeadTask {
    const beadId = params.beadId || `bead-${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();
    const corrId = params.correlationId || `corr-bead-${randomUUID()}`;
    const projectId = params.projectId || 'default';
    const tags = params.tags || [];

    this.db
      .prepare(`
      INSERT INTO beads_tasks (
        bead_id, title, description, status, assignee_agent,
        project_id, parent_bead_id, correlation_id, supporting_experience_ids,
        tags, created_at, updated_at
      ) VALUES (
        $bead_id, $title, $description, 'OPEN', $assignee_agent,
        $project_id, $parent_bead_id, $correlation_id, '[]',
        $tags, $created_at, $updated_at
      )
    `)
      .run({
        $bead_id: beadId,
        $title: params.title,
        $description: params.description,
        $assignee_agent: params.assigneeAgent || null,
        $project_id: projectId,
        $parent_bead_id: params.parentBeadId || null,
        $correlation_id: corrId,
        $tags: JSON.stringify(tags),
        $created_at: now,
        $updated_at: now,
      });

    if (this.ledger) {
      this.ledger.appendEvent({
        correlation_id: corrId,
        actor: params.assigneeAgent || 'system',
        event_type: 'evidence_ingested',
        payload: {
          action: 'bead_created',
          bead_id: beadId,
          title: params.title,
        },
      });
    }

    return this.getBead(beadId)!;
  }

  public updateBeadStatus(
    beadId: string,
    status: BeadStatus,
    agentId?: string,
    comment?: string
  ): BeadTask | null {
    const bead = this.getBead(beadId);
    if (!bead) return null;

    const now = new Date().toISOString();
    this.db
      .prepare(`
      UPDATE beads_tasks
      SET status = ?, assignee_agent = COALESCE(?, assignee_agent), updated_at = ?
      WHERE bead_id = ?
    `)
      .run(status, agentId || null, now, beadId);

    if (this.ledger) {
      this.ledger.appendEvent({
        correlation_id: bead.correlation_id,
        actor: agentId || 'agent',
        event_type: 'evidence_ingested',
        payload: {
          action: 'bead_status_changed',
          bead_id: beadId,
          old_status: bead.status,
          new_status: status,
          comment,
        },
      });
    }

    return this.getBead(beadId);
  }

  public linkExperience(beadId: string, experienceId: string): BeadTask | null {
    const bead = this.getBead(beadId);
    if (!bead) return null;

    if (!bead.supporting_experience_ids.includes(experienceId)) {
      const updated = [...bead.supporting_experience_ids, experienceId];
      this.db
        .prepare('UPDATE beads_tasks SET supporting_experience_ids = ?, updated_at = ? WHERE bead_id = ?')
        .run(JSON.stringify(updated), new Date().toISOString(), beadId);
    }

    return this.getBead(beadId);
  }

  public getBead(beadId: string): BeadTask | null {
    const row = this.db.prepare('SELECT * FROM beads_tasks WHERE bead_id = ?').get(beadId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getActiveBeads(projectId: string = 'default', agentId?: string): BeadTask[] {
    let sql = `SELECT * FROM beads_tasks WHERE status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED') AND project_id = ?`;
    const params: any[] = [projectId];

    if (agentId) {
      sql += ' AND (assignee_agent = ? OR assignee_agent IS NULL)';
      params.push(agentId);
    }

    sql += ' ORDER BY created_at DESC LIMIT 10';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRow(r));
  }

  public formatBeadsMarkdown(beads: BeadTask[]): string {
    if (!beads || beads.length === 0) return '';
    const lines: string[] = ['### ACTIVE TASK CONTINUITY (BEADS-LITE):'];
    for (const b of beads) {
      const agentLabel = b.assignee_agent ? ` | Agent: ${b.assignee_agent}` : '';
      lines.push(`- [${b.status}${agentLabel}]: **${b.title}** (${b.bead_id}) — ${b.description}`);
    }
    return lines.join('\n');
  }

  private mapRow(row: any): BeadTask {
    return {
      bead_id: row.bead_id,
      title: row.title,
      description: row.description,
      status: row.status as BeadStatus,
      assignee_agent: row.assignee_agent,
      project_id: row.project_id,
      parent_bead_id: row.parent_bead_id,
      correlation_id: row.correlation_id,
      supporting_experience_ids: JSON.parse(row.supporting_experience_ids || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
