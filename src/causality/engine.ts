import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { L0EventLedger } from '../db/ledger';

export type CausalStatus = 'HYPOTHESIZED' | 'CORROBORATED' | 'FALSIFIED' | 'PROVEN';

export interface CausalHypothesis {
  hypothesis_id: string;
  candidate_cause: string;
  observed_effect: string;
  context: string;
  confidence: number;
  causal_status: CausalStatus;
  supporting_evidence: string[];
  contradicting_evidence: string[];
  observations_count: number;
  avg_delta_ms: number;
  created_at: string;
  updated_at: string;
}

export class CausalityEngine {
  private db: Database;
  private ledger?: L0EventLedger;

  constructor(db: Database, ledger?: L0EventLedger) {
    this.db = db;
    this.ledger = ledger;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS causal_hypotheses (
        hypothesis_id TEXT PRIMARY KEY,
        candidate_cause TEXT NOT NULL,
        observed_effect TEXT NOT NULL,
        context TEXT NOT NULL,
        confidence REAL NOT NULL,
        causal_status TEXT NOT NULL,
        supporting_evidence TEXT NOT NULL,
        contradicting_evidence TEXT NOT NULL,
        observations_count INTEGER NOT NULL,
        avg_delta_ms REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_causal_cause_effect ON causal_hypotheses(candidate_cause, observed_effect);
      CREATE INDEX IF NOT EXISTS idx_causal_context ON causal_hypotheses(context);
    `);
  }

  /**
   * Distinguishes mere temporal correlation from true causal confidence.
   * Multiple supporting observations increase confidence; contradicting observations reduce it.
   */
  public recordObservation(params: {
    candidateCause: string;
    observedEffect: string;
    context: string;
    evidenceId: string;
    deltaMs?: number;
  }): CausalHypothesis {
    const existing = this.getHypothesis(params.candidateCause, params.observedEffect, params.context);
    const now = new Date().toISOString();
    const delta = params.deltaMs || 0;

    if (!existing) {
      // Create initial weak hypothesis (confidence: 0.35)
      const hypothesis: CausalHypothesis = {
        hypothesis_id: `causal-${randomUUID()}`,
        candidate_cause: params.candidateCause,
        observed_effect: params.observedEffect,
        context: params.context,
        confidence: 0.35,
        causal_status: 'HYPOTHESIZED',
        supporting_evidence: [params.evidenceId],
        contradicting_evidence: [],
        observations_count: 1,
        avg_delta_ms: delta,
        created_at: now,
        updated_at: now,
      };

      this.insertHypothesis(hypothesis);
      return hypothesis;
    }

    // Update existing hypothesis with new supporting evidence
    const supporting = new Set(existing.supporting_evidence);
    supporting.add(params.evidenceId);

    const count = existing.observations_count + 1;
    const newAvgDelta = (existing.avg_delta_ms * existing.observations_count + delta) / count;

    // Asymptotic Bayesian confidence increase
    const currentConf = existing.confidence;
    const newConf = Math.min(0.98, currentConf + (1.0 - currentConf) * 0.5);

    let newStatus: CausalStatus = existing.causal_status;
    if (newConf >= 0.80 && count >= 3) {
      newStatus = 'PROVEN';
    } else if (newConf >= 0.55 && count >= 2) {
      newStatus = 'CORROBORATED';
    }

    const updated: CausalHypothesis = {
      ...existing,
      confidence: Math.round(newConf * 1000) / 1000,
      causal_status: newStatus,
      supporting_evidence: Array.from(supporting),
      observations_count: count,
      avg_delta_ms: Math.round(newAvgDelta * 100) / 100,
      updated_at: now,
    };

    this.updateHypothesis(updated);
    return updated;
  }

  public recordContradiction(params: {
    candidateCause: string;
    observedEffect: string;
    context: string;
    evidenceId: string;
  }): CausalHypothesis | null {
    const existing = this.getHypothesis(params.candidateCause, params.observedEffect, params.context);
    if (!existing) return null;

    const contradicting = new Set(existing.contradicting_evidence);
    contradicting.add(params.evidenceId);

    // Severe penalty on contradicting evidence
    const newConf = Math.max(0.05, existing.confidence * 0.45);
    const newStatus: CausalStatus = newConf < 0.25 ? 'FALSIFIED' : 'HYPOTHESIZED';

    const updated: CausalHypothesis = {
      ...existing,
      confidence: Math.round(newConf * 1000) / 1000,
      causal_status: newStatus,
      contradicting_evidence: Array.from(contradicting),
      updated_at: new Date().toISOString(),
    };

    this.updateHypothesis(updated);
    return updated;
  }

  public getHypothesis(cause: string, effect: string, context: string): CausalHypothesis | null {
    const row = this.db
      .prepare('SELECT * FROM causal_hypotheses WHERE candidate_cause = ? AND observed_effect = ? AND context = ?')
      .get(cause, effect, context) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getAllHypotheses(context?: string): CausalHypothesis[] {
    let rows: any[];
    if (context) {
      rows = this.db.prepare('SELECT * FROM causal_hypotheses WHERE context = ? ORDER BY confidence DESC').all(context);
    } else {
      rows = this.db.prepare('SELECT * FROM causal_hypotheses ORDER BY confidence DESC').all();
    }
    return rows.map((r) => this.mapRow(r));
  }

  private insertHypothesis(h: CausalHypothesis): void {
    this.db.prepare(`
      INSERT INTO causal_hypotheses (
        hypothesis_id, candidate_cause, observed_effect, context, confidence,
        causal_status, supporting_evidence, contradicting_evidence,
        observations_count, avg_delta_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      h.hypothesis_id,
      h.candidate_cause,
      h.observed_effect,
      h.context,
      h.confidence,
      h.causal_status,
      JSON.stringify(h.supporting_evidence),
      JSON.stringify(h.contradicting_evidence),
      h.observations_count,
      h.avg_delta_ms,
      h.created_at,
      h.updated_at
    );
  }

  private updateHypothesis(h: CausalHypothesis): void {
    this.db.prepare(`
      UPDATE causal_hypotheses SET
        confidence = ?,
        causal_status = ?,
        supporting_evidence = ?,
        contradicting_evidence = ?,
        observations_count = ?,
        avg_delta_ms = ?,
        updated_at = ?
      WHERE hypothesis_id = ?
    `).run(
      h.confidence,
      h.causal_status,
      JSON.stringify(h.supporting_evidence),
      JSON.stringify(h.contradicting_evidence),
      h.observations_count,
      h.avg_delta_ms,
      h.updated_at,
      h.hypothesis_id
    );
  }

  private mapRow(row: any): CausalHypothesis {
    return {
      hypothesis_id: row.hypothesis_id,
      candidate_cause: row.candidate_cause,
      observed_effect: row.observed_effect,
      context: row.context,
      confidence: row.confidence,
      causal_status: row.causal_status as CausalStatus,
      supporting_evidence: JSON.parse(row.supporting_evidence || '[]'),
      contradicting_evidence: JSON.parse(row.contradicting_evidence || '[]'),
      observations_count: row.observations_count,
      avg_delta_ms: row.avg_delta_ms,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
