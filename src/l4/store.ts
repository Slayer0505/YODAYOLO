import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { L4Prediction, L4RetrievalFeedback } from '../types';

export class L4Store {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS l4_predictions (
        prediction_id TEXT PRIMARY KEY,
        experience_id TEXT,
        correlation_id TEXT,
        task_context TEXT NOT NULL,
        prediction_text TEXT NOT NULL,
        predicted_outcome TEXT NOT NULL,
        confidence REAL NOT NULL,
        rationale TEXT,
        actual_outcome TEXT,
        brier_score REAL,
        is_calibrated INTEGER,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        evidence_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_l4_pred_context ON l4_predictions(task_context);
      CREATE INDEX IF NOT EXISTS idx_l4_pred_exp ON l4_predictions(experience_id);

      CREATE TABLE IF NOT EXISTS l4_retrieval_feedback (
        feedback_id TEXT PRIMARY KEY,
        experience_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        was_useful INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_l4_feedback_rule ON l4_retrieval_feedback(rule_id);
    `);
  }

  public savePrediction(params: {
    predictionId?: string;
    experienceId?: string | null;
    correlationId?: string | null;
    taskContext: string;
    predictionText: string;
    predictedOutcome: 'SUCCESS' | 'FAILURE';
    confidence: number;
    rationale?: string | null;
  }): L4Prediction {
    const predictionId = params.predictionId || `pred-${randomUUID()}`;
    const now = new Date().toISOString();
    const clampedConfidence = Math.max(0, Math.min(1, params.confidence));

    this.db
      .prepare(`
      INSERT INTO l4_predictions (
        prediction_id, experience_id, correlation_id, task_context,
        prediction_text, predicted_outcome, confidence, rationale,
        actual_outcome, brier_score, is_calibrated, created_at, resolved_at, evidence_id
      ) VALUES (
        $prediction_id, $experience_id, $correlation_id, $task_context,
        $prediction_text, $predicted_outcome, $confidence, $rationale,
        NULL, NULL, NULL, $created_at, NULL, NULL
      )
    `)
      .run({
        $prediction_id: predictionId,
        $experience_id: params.experienceId ?? null,
        $correlation_id: params.correlationId ?? null,
        $task_context: params.taskContext,
        $prediction_text: params.predictionText,
        $predicted_outcome: params.predictedOutcome,
        $confidence: clampedConfidence,
        $rationale: params.rationale ?? null,
        $created_at: now,
      });

    return this.getPrediction(predictionId)!;
  }

  public resolvePrediction(params: {
    predictionId: string;
    actualOutcome: 'SUCCESS' | 'FAILURE' | 'UNKNOWN';
    evidenceId?: string | null;
  }): L4Prediction {
    const current = this.getPrediction(params.predictionId);
    if (!current) {
      throw new Error(`Prediction not found: ${params.predictionId}`);
    }

    const now = new Date().toISOString();
    let brierScore: number | null = null;
    let isCalibrated: number | null = null;

    if (params.actualOutcome === 'SUCCESS' || params.actualOutcome === 'FAILURE') {
      // 1.0 if actual matches prediction, 0.0 otherwise
      const y = params.actualOutcome === current.predicted_outcome ? 1.0 : 0.0;
      brierScore = Math.round(Math.pow(current.confidence - y, 2) * 10000) / 10000;
      isCalibrated = brierScore <= 0.25 ? 1 : 0;
    }

    this.db
      .prepare(`
      UPDATE l4_predictions
      SET actual_outcome = $actual_outcome,
          brier_score = $brier_score,
          is_calibrated = $is_calibrated,
          resolved_at = $resolved_at,
          evidence_id = $evidence_id
      WHERE prediction_id = $prediction_id
    `)
      .run({
        $prediction_id: params.predictionId,
        $actual_outcome: params.actualOutcome,
        $brier_score: brierScore,
        $is_calibrated: isCalibrated,
        $resolved_at: now,
        $evidence_id: params.evidenceId ?? null,
      });

    return this.getPrediction(params.predictionId)!;
  }

  public getPrediction(predictionId: string): L4Prediction | null {
    const row = this.db.prepare('SELECT * FROM l4_predictions WHERE prediction_id = ?').get(predictionId) as any;
    if (!row) return null;
    return this.mapPredictionRow(row);
  }

  public getAllPredictions(filter?: { taskContext?: string; resolvedOnly?: boolean }): L4Prediction[] {
    let sql = 'SELECT * FROM l4_predictions WHERE 1=1';
    const params: any[] = [];

    if (filter?.taskContext) {
      sql += ' AND task_context = ?';
      params.push(filter.taskContext);
    }
    if (filter?.resolvedOnly) {
      sql += ' AND resolved_at IS NOT NULL';
    }

    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapPredictionRow(r));
  }

  public getPredictions(filter?: { taskContext?: string; resolvedOnly?: boolean; resolved?: boolean }): L4Prediction[] {
    if (filter && 'resolved' in filter) {
      if (filter.resolved === false) {
        return this.getAllPredictions({ taskContext: filter.taskContext }).filter((p) => p.resolved_at === null);
      }
      return this.getAllPredictions({ taskContext: filter.taskContext, resolvedOnly: true });
    }
    return this.getAllPredictions(filter);
  }

  public saveRetrievalFeedback(params: {
    experienceId: string;
    ruleId: string;
    wasUseful: boolean;
  }): L4RetrievalFeedback {
    const feedbackId = `fb-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(`
      INSERT INTO l4_retrieval_feedback (
        feedback_id, experience_id, rule_id, was_useful, created_at
      ) VALUES (
        $feedback_id, $experience_id, $rule_id, $was_useful, $created_at
      )
    `)
      .run({
        $feedback_id: feedbackId,
        $experience_id: params.experienceId,
        $rule_id: params.ruleId,
        $was_useful: params.wasUseful ? 1 : 0,
        $created_at: now,
      });

    return {
      feedback_id: feedbackId,
      experience_id: params.experienceId,
      rule_id: params.ruleId,
      was_useful: params.wasUseful,
      created_at: now,
    };
  }

  public getFeedbackForRule(ruleId: string): L4RetrievalFeedback[] {
    const rows = this.db
      .prepare('SELECT * FROM l4_retrieval_feedback WHERE rule_id = ? ORDER BY created_at DESC')
      .all(ruleId) as any[];
    return rows.map((r) => ({
      feedback_id: r.feedback_id,
      experience_id: r.experience_id,
      rule_id: r.rule_id,
      was_useful: Boolean(r.was_useful),
      created_at: r.created_at,
    }));
  }

  public getAllFeedback(): L4RetrievalFeedback[] {
    const rows = this.db
      .prepare('SELECT * FROM l4_retrieval_feedback ORDER BY created_at DESC')
      .all() as any[];
    return rows.map((r) => ({
      feedback_id: r.feedback_id,
      experience_id: r.experience_id,
      rule_id: r.rule_id,
      was_useful: Boolean(r.was_useful),
      created_at: r.created_at,
    }));
  }

  private mapPredictionRow(row: any): L4Prediction {
    return {
      prediction_id: row.prediction_id,
      experience_id: row.experience_id,
      correlation_id: row.correlation_id,
      task_context: row.task_context,
      prediction_text: row.prediction_text,
      predicted_outcome: row.predicted_outcome,
      confidence: row.confidence,
      rationale: row.rationale,
      actual_outcome: row.actual_outcome,
      brier_score: row.brier_score !== null ? row.brier_score : null,
      is_calibrated: row.is_calibrated !== null ? Boolean(row.is_calibrated) : null,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      evidence_id: row.evidence_id,
    };
  }
}
