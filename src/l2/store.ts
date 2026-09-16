import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { DeterministicLocalEmbedder, type EmbeddingEngine } from '../l3/embeddings';
import type {
  L2KnowledgeItem,
  L2ModelExperience,
  L2RuleCategory,
  L2RuleStatus,
  L2Strategy,
  L2ToolExperience,
  MemoryTier,
  TemporalEdge,
  TemporalRelation,
} from '../types';

export class L2KnowledgeStore {
  private db: Database;
  private embedder: EmbeddingEngine;

  constructor(db: Database, embedder?: EmbeddingEngine) {
    this.db = db;
    this.embedder = embedder || new DeterministicLocalEmbedder();
    this.initSchema();
    this.seedDefaultRulesIfEmpty();
  }

  public setEmbedder(embedder: EmbeddingEngine): void {
    this.embedder = embedder;
  }

  public getEmbedder(): EmbeddingEngine {
    return this.embedder;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS l2_knowledge (
        rule_id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        task_context TEXT NOT NULL DEFAULT 'general',
        confidence REAL NOT NULL DEFAULT 0.5,
        evidence_count INTEGER NOT NULL DEFAULT 1,
        contradiction_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'HYPOTHESIS',
        tags TEXT NOT NULL,
        provenance TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        memory_tier TEXT NOT NULL DEFAULT 'HOT',
        vector TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        superseded_by TEXT,
        temporal_edges TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_l2_status ON l2_knowledge(status);
      CREATE INDEX IF NOT EXISTS idx_l2_context ON l2_knowledge(task_context);
      CREATE INDEX IF NOT EXISTS idx_l2_category ON l2_knowledge(category);
      CREATE INDEX IF NOT EXISTS idx_l2_tier ON l2_knowledge(memory_tier);
      CREATE INDEX IF NOT EXISTS idx_l2_superseded ON l2_knowledge(superseded_by);

      CREATE TABLE IF NOT EXISTS l2_strategies (
        strategy_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        task_class TEXT NOT NULL,
        conditions TEXT NOT NULL,
        steps TEXT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0.5,
        provenance TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_l2_strategy_task ON l2_strategies(task_class);

      CREATE TABLE IF NOT EXISTS l2_model_experience (
        record_id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        task_class TEXT NOT NULL,
        context TEXT NOT NULL,
        strategy_used TEXT,
        sample_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0.5
      );

      CREATE INDEX IF NOT EXISTS idx_l2_model_exp ON l2_model_experience(model, task_class);

      CREATE TABLE IF NOT EXISTS l2_tool_experience (
        record_id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        task_context TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        usefulness_score REAL NOT NULL DEFAULT 0.5
      );

      CREATE INDEX IF NOT EXISTS idx_l2_tool_exp ON l2_tool_experience(tool_name, task_context);
    `);

    try {
      this.db.exec(`ALTER TABLE l2_knowledge ADD COLUMN memory_tier TEXT NOT NULL DEFAULT 'HOT'`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE l2_knowledge ADD COLUMN valid_from TEXT`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE l2_knowledge ADD COLUMN valid_until TEXT`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE l2_knowledge ADD COLUMN superseded_by TEXT`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE l2_knowledge ADD COLUMN temporal_edges TEXT NOT NULL DEFAULT '[]'`);
    } catch {}
  }

  // --------------------------------------------------------------------------
  // KNOWLEDGE RULES & BELIEFS
  // --------------------------------------------------------------------------

  public upsertRule(params: {
    ruleId?: string;
    category: L2RuleCategory;
    content: string;
    taskContext: string;
    confidence?: number;
    evidenceCount?: number;
    contradictionCount?: number;
    status?: L2RuleStatus;
    tags?: string[];
    provenance?: string[];
    memoryTier?: MemoryTier;
    validFrom?: string;
    validUntil?: string | null;
    supersededBy?: string | null;
    temporalEdges?: TemporalEdge[];
  }): L2KnowledgeItem {
    const ruleId = params.ruleId || `rule-${randomUUID()}`;
    const now = new Date().toISOString();
    const confidence = params.confidence ?? 0.45;
    const evidenceCount = params.evidenceCount ?? 1;
    const contradictionCount = params.contradictionCount ?? 0;
    const status: L2RuleStatus = params.status || (evidenceCount >= 2 && confidence >= 0.7 ? 'CONFIRMED' : 'HYPOTHESIS');
    const tags = params.tags || [];
    const provenance = params.provenance || [];
    const memoryTier = params.memoryTier || 'HOT';
    const validFrom = params.validFrom || now;
    const validUntil = params.validUntil ?? null;
    const supersededBy = params.supersededBy ?? null;
    const temporalEdges = params.temporalEdges || [];
    const vector = this.embedder ? (this.embedder as any).embedSync(params.content) : null;

    this.db
      .prepare(`
      INSERT INTO l2_knowledge (
        rule_id, category, content, task_context, confidence, evidence_count,
        contradiction_count, status, tags, provenance, created_at, updated_at,
        memory_tier, vector, valid_from, valid_until, superseded_by, temporal_edges
      ) VALUES (
        $rule_id, $category, $content, $task_context, $confidence, $evidence_count,
        $contradiction_count, $status, $tags, $provenance, $created_at, $updated_at,
        $memory_tier, $vector, $valid_from, $valid_until, $superseded_by, $temporal_edges
      )
      ON CONFLICT(rule_id) DO UPDATE SET
        content = excluded.content,
        task_context = excluded.task_context,
        confidence = excluded.confidence,
        evidence_count = excluded.evidence_count,
        contradiction_count = excluded.contradiction_count,
        status = excluded.status,
        tags = excluded.tags,
        provenance = excluded.provenance,
        updated_at = excluded.updated_at,
        memory_tier = excluded.memory_tier,
        vector = excluded.vector,
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
        superseded_by = excluded.superseded_by,
        temporal_edges = excluded.temporal_edges
    `)
      .run({
        $rule_id: ruleId,
        $category: params.category,
        $content: params.content,
        $task_context: params.taskContext || 'general',
        $confidence: confidence,
        $evidence_count: evidenceCount,
        $contradiction_count: contradictionCount,
        $status: status,
        $tags: JSON.stringify(tags),
        $provenance: JSON.stringify(provenance),
        $created_at: now,
        $updated_at: now,
        $memory_tier: memoryTier,
        $vector: JSON.stringify(vector),
        $valid_from: validFrom,
        $valid_until: validUntil,
        $superseded_by: supersededBy,
        $temporal_edges: JSON.stringify(temporalEdges),
      });

    return this.getRule(ruleId)!;
  }

  public getRule(ruleId: string): L2KnowledgeItem | null {
    const row = this.db.prepare('SELECT * FROM l2_knowledge WHERE rule_id = ?').get(ruleId) as any;
    if (!row) return null;
    return this.mapRuleRow(row);
  }

  public patchRule(ruleId: string, patch: { status?: string; confidence?: number; content?: string }): L2KnowledgeItem | null {
    const current = this.getRule(ruleId);
    if (!current) return null;
    const fields: string[] = [];
    const params: any[] = [];
    if (patch.status) { fields.push('status = ?'); params.push(patch.status); }
    if (patch.confidence !== undefined) { fields.push('confidence = ?'); params.push(patch.confidence); }
    if (patch.content) { fields.push('content = ?'); params.push(patch.content); }
    if (fields.length === 0) return current;
    params.push(ruleId);
    this.db.prepare(`UPDATE l2_knowledge SET ${fields.join(', ')}, updated_at = datetime('now') WHERE rule_id = ?`).run(...params);
    return this.getRule(ruleId);
  }

  public getAllRules(filter?: { status?: L2RuleStatus; category?: string; taskContext?: string }): L2KnowledgeItem[] {
    let sql = 'SELECT * FROM l2_knowledge WHERE 1=1';
    const params: any[] = [];

    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.taskContext) {
      sql += ' AND task_context = ?';
      params.push(filter.taskContext);
    }

    sql += ' ORDER BY confidence DESC';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRuleRow(r));
  }

  /**
   * Applies Bayesian/evidence reinforcement:
   * Increases evidence count, boosts confidence, and promotes to CONFIRMED when evidence >= 2.
   */
  public recordSupportingEvidence(ruleId: string, experienceId: string): L2KnowledgeItem {
    const current = this.getRule(ruleId);
    if (!current) throw new Error(`Rule not found: ${ruleId}`);

    const newEvidenceCount = current.evidence_count + 1;
    // Per Single Observation Rule: 2nd+ observation promotes hypothesis to CONFIRMED (confidence >= 0.70)
    const baseConfidence = newEvidenceCount >= 2 ? Math.max(0.75, current.confidence) : current.confidence;
    const newConfidence = Math.min(0.98, baseConfidence + (1 - baseConfidence) * 0.25);
    const newStatus: L2RuleStatus = newEvidenceCount >= 2 ? 'CONFIRMED' : current.status;
    const updatedProvenance = current.provenance.includes(experienceId)
      ? current.provenance
      : [...current.provenance, experienceId];

    return this.upsertRule({
      ruleId: current.rule_id,
      category: current.category,
      content: current.content,
      taskContext: current.task_context,
      confidence: Math.round(newConfidence * 100) / 100,
      evidenceCount: newEvidenceCount,
      contradictionCount: current.contradiction_count,
      status: newStatus,
      tags: current.tags,
      provenance: updatedProvenance,
    });
  }

  /**
   * Applies contradiction penalty:
   * Decrements confidence; demotes to DEPRECATED if confidence drops below 0.40.
   */
  public recordContradictoryEvidence(ruleId: string, experienceId: string): L2KnowledgeItem {
    const current = this.getRule(ruleId);
    if (!current) throw new Error(`Rule not found: ${ruleId}`);

    const newContradictionCount = current.contradiction_count + 1;
    // Decay confidence by 35%
    const newConfidence = Math.max(0.1, current.confidence - current.confidence * 0.35);
    const newStatus: L2RuleStatus = newConfidence < 0.40 ? 'DEPRECATED' : 'HYPOTHESIS';
    const updatedProvenance = current.provenance.includes(experienceId)
      ? current.provenance
      : [...current.provenance, experienceId];

    return this.upsertRule({
      ruleId: current.rule_id,
      category: current.category,
      content: current.content,
      taskContext: current.task_context,
      confidence: Math.round(newConfidence * 100) / 100,
      evidenceCount: current.evidence_count,
      contradictionCount: newContradictionCount,
      status: newStatus,
      tags: current.tags,
      provenance: updatedProvenance,
    });
  }

  public updateRuleVector(ruleId: string, vector: number[]): void {
    this.db
      .prepare('UPDATE l2_knowledge SET vector = ?, updated_at = ? WHERE rule_id = ?')
      .run(JSON.stringify(vector), new Date().toISOString(), ruleId);
  }

  /**
   * Re-embeds all rules using the active embedder to ensure vector dimensional consistency.
   */
  public async reembedAll(customEmbedder?: EmbeddingEngine): Promise<{ rulesUpdated: number; dimension: number }> {
    const activeEmbedder = customEmbedder || this.embedder;
    const rules = this.getAllRules();
    let updated = 0;
    let dimension = 0;

    for (const rule of rules) {
      const vec = await activeEmbedder.embed(rule.content);
      if (vec && vec.length > 0) {
        this.updateRuleVector(rule.rule_id, vec);
        dimension = vec.length;
        updated++;
      }
    }

    return {
      rulesUpdated: updated,
      dimension,
    };
  }

  // --------------------------------------------------------------------------
  // STRATEGY MEMORY
  // --------------------------------------------------------------------------

  public saveStrategy(params: {
    strategyId?: string;
    name: string;
    taskClass: string;
    conditions: string;
    steps: string[];
    confidence?: number;
    provenance?: string[];
    successCount?: number;
    failureCount?: number;
  }): L2Strategy {
    const strategyId = params.strategyId || `strat-${randomUUID()}`;
    const confidence = params.confidence ?? 0.6;
    const provenance = params.provenance || [];
    const successCount = params.successCount ?? 0;
    const failureCount = params.failureCount ?? 0;

    this.db
      .prepare(`
      INSERT INTO l2_strategies (
        strategy_id, name, task_class, conditions, steps,
        success_count, failure_count, confidence, provenance
      ) VALUES (
        $strategy_id, $name, $task_class, $conditions, $steps,
        $success_count, $failure_count, $confidence, $provenance
      )
      ON CONFLICT(strategy_id) DO UPDATE SET
        name = excluded.name,
        task_class = excluded.task_class,
        conditions = excluded.conditions,
        steps = excluded.steps,
        confidence = excluded.confidence,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count
    `)
      .run({
        $strategy_id: strategyId,
        $name: params.name,
        $task_class: params.taskClass,
        $conditions: params.conditions,
        $steps: JSON.stringify(params.steps),
        $success_count: successCount,
        $failure_count: failureCount,
        $confidence: confidence,
        $provenance: JSON.stringify(provenance),
      });

    return this.getStrategy(strategyId)!;
  }

  public upsertStrategy(params: {
    strategyId?: string;
    name: string;
    taskClass: string;
    conditions: string;
    steps: string[];
    confidence?: number;
    provenance?: string[];
    successCount?: number;
    failureCount?: number;
  }): L2Strategy {
    return this.saveStrategy(params);
  }

  public getStrategy(strategyId: string): L2Strategy | null {
    const row = this.db.prepare('SELECT * FROM l2_strategies WHERE strategy_id = ?').get(strategyId) as any;
    if (!row) return null;
    return this.mapStrategyRow(row);
  }

  public getStrategiesByTaskClass(taskClass: string): L2Strategy[] {
    const rows = this.db
      .prepare('SELECT * FROM l2_strategies WHERE task_class = ? ORDER BY confidence DESC')
      .all(taskClass) as any[];
    return rows.map((r) => this.mapStrategyRow(r));
  }

  public getAllStrategies(): L2Strategy[] {
    const rows = this.db.prepare('SELECT * FROM l2_strategies ORDER BY confidence DESC').all() as any[];
    return rows.map((r) => this.mapStrategyRow(r));
  }

  public recordStrategyOutcome(strategyId: string, success: boolean, experienceId: string): L2Strategy {
    const strat = this.getStrategy(strategyId);
    if (!strat) throw new Error(`Strategy not found: ${strategyId}`);

    const newSuccess = strat.success_count + (success ? 1 : 0);
    const newFailure = strat.failure_count + (success ? 0 : 1);
    const total = newSuccess + newFailure;
    const newConfidence = total > 0 ? Math.round((newSuccess / total) * 100) / 100 : 0.5;
    const updatedProvenance = strat.provenance.includes(experienceId)
      ? strat.provenance
      : [...strat.provenance, experienceId];

    this.db
      .prepare(`
      UPDATE l2_strategies
      SET success_count = $success_count,
          failure_count = $failure_count,
          confidence = $confidence,
          provenance = $provenance
      WHERE strategy_id = $strategy_id
    `)
      .run({
        $strategy_id: strategyId,
        $success_count: newSuccess,
        $failure_count: newFailure,
        $confidence: newConfidence,
        $provenance: JSON.stringify(updatedProvenance),
      });

    return this.getStrategy(strategyId)!;
  }

  // --------------------------------------------------------------------------
  // MODEL EXPERIENCE
  // --------------------------------------------------------------------------

  public recordModelOutcome(params: {
    model: string;
    taskClass: string;
    context: string;
    strategyUsed?: string;
    success: boolean;
    latencyMs: number;
  }): L2ModelExperience {
    const recordId = `modelexp-${params.model}-${params.taskClass}`;
    const row = this.db.prepare('SELECT * FROM l2_model_experience WHERE record_id = ?').get(recordId) as any;

    let sampleCount = 1;
    let successCount = params.success ? 1 : 0;
    let failureCount = params.success ? 0 : 1;
    let avgLatency = params.latencyMs;

    if (row) {
      sampleCount = row.sample_count + 1;
      successCount = row.success_count + (params.success ? 1 : 0);
      failureCount = row.failure_count + (params.success ? 0 : 1);
      avgLatency = (row.avg_latency_ms * row.sample_count + params.latencyMs) / sampleCount;
    }

    const confidence = Math.round((successCount / sampleCount) * 100) / 100;

    this.db
      .prepare(`
      INSERT INTO l2_model_experience (
        record_id, model, task_class, context, strategy_used,
        sample_count, success_count, failure_count, avg_latency_ms, confidence
      ) VALUES (
        $record_id, $model, $task_class, $context, $strategy_used,
        $sample_count, $success_count, $failure_count, $avg_latency_ms, $confidence
      )
      ON CONFLICT(record_id) DO UPDATE SET
        sample_count = excluded.sample_count,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        avg_latency_ms = excluded.avg_latency_ms,
        confidence = excluded.confidence
    `)
      .run({
        $record_id: recordId,
        $model: params.model,
        $task_class: params.taskClass,
        $context: params.context,
        $strategy_used: params.strategyUsed || null,
        $sample_count: sampleCount,
        $success_count: successCount,
        $failure_count: failureCount,
        $avg_latency_ms: Math.round(avgLatency),
        $confidence: confidence,
      });

    return this.getModelExperience(params.model, params.taskClass)!;
  }

  public getModelExperience(model: string, taskClass: string): L2ModelExperience | null {
    const recordId = `modelexp-${model}-${taskClass}`;
    const row = this.db.prepare('SELECT * FROM l2_model_experience WHERE record_id = ?').get(recordId) as any;
    if (!row) return null;
    return {
      record_id: row.record_id,
      model: row.model,
      task_class: row.task_class,
      context: row.context,
      strategy_used: row.strategy_used,
      sample_count: row.sample_count,
      success_count: row.success_count,
      failure_count: row.failure_count,
      avg_latency_ms: row.avg_latency_ms,
      confidence: row.confidence,
    };
  }

  public getAllModelExperiences(): L2ModelExperience[] {
    const rows = this.db.prepare('SELECT * FROM l2_model_experience ORDER BY sample_count DESC').all() as any[];
    return rows.map((r) => ({
      record_id: r.record_id,
      model: r.model,
      task_class: r.task_class,
      context: r.context,
      strategy_used: r.strategy_used,
      sample_count: r.sample_count,
      success_count: r.success_count,
      failure_count: r.failure_count,
      avg_latency_ms: r.avg_latency_ms,
      confidence: r.confidence,
    }));
  }

  // --------------------------------------------------------------------------
  // TOOL EXPERIENCE
  // --------------------------------------------------------------------------

  public recordToolUsage(params: {
    toolName: string;
    taskContext: string;
    success: boolean;
    usefulnessScore?: number;
  }): L2ToolExperience {
    const recordId = `toolexp-${params.toolName}-${params.taskContext}`;
    const row = this.db.prepare('SELECT * FROM l2_tool_experience WHERE record_id = ?').get(recordId) as any;

    let usageCount = 1;
    let successCount = params.success ? 1 : 0;
    let failureCount = params.success ? 0 : 1;

    if (row) {
      usageCount = row.usage_count + 1;
      successCount = row.success_count + (params.success ? 1 : 0);
      failureCount = row.failure_count + (params.success ? 0 : 1);
    }

    const usefulness = params.usefulnessScore !== undefined
      ? params.usefulnessScore
      : Math.round((successCount / usageCount) * 100) / 100;

    this.db
      .prepare(`
      INSERT INTO l2_tool_experience (
        record_id, tool_name, task_context, usage_count,
        success_count, failure_count, usefulness_score
      ) VALUES (
        $record_id, $tool_name, $task_context, $usage_count,
        $success_count, $failure_count, $usefulness_score
      )
      ON CONFLICT(record_id) DO UPDATE SET
        usage_count = excluded.usage_count,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        usefulness_score = excluded.usefulness_score
    `)
      .run({
        $record_id: recordId,
        $tool_name: params.toolName,
        $task_context: params.taskContext,
        $usage_count: usageCount,
        $success_count: successCount,
        $failure_count: failureCount,
        $usefulness_score: usefulness,
      });

    return this.getToolExperience(params.toolName, params.taskContext)!;
  }

  public recordToolExperience(toolName: string, taskContext: string, success: boolean, confidence?: number): L2ToolExperience {
    return this.recordToolUsage({ toolName, taskContext, success, usefulnessScore: confidence });
  }

  public getToolExperience(toolName: string, taskContext: string): L2ToolExperience | null {
    const recordId = `toolexp-${toolName}-${taskContext}`;
    const row = this.db.prepare('SELECT * FROM l2_tool_experience WHERE record_id = ?').get(recordId) as any;
    if (!row) return null;
    return {
      record_id: row.record_id,
      tool_name: row.tool_name,
      task_context: row.task_context,
      usage_count: row.usage_count,
      success_count: row.success_count,
      failure_count: row.failure_count,
      usefulness_score: row.usefulness_score,
    };
  }

  public getAllToolExperiences(): L2ToolExperience[] {
    const rows = this.db.prepare('SELECT * FROM l2_tool_experience ORDER BY usage_count DESC').all() as any[];
    return rows.map((r) => ({
      record_id: r.record_id,
      tool_name: r.tool_name,
      task_context: r.task_context,
      usage_count: r.usage_count,
      success_count: r.success_count,
      failure_count: r.failure_count,
      usefulness_score: r.usefulness_score,
    }));
  }

  public updateRuleMemoryTier(ruleId: string, tier: MemoryTier): void {
    this.db.prepare(`UPDATE l2_knowledge SET memory_tier = ? WHERE rule_id = ?`).run(tier, ruleId);
  }

  public getRulesByTier(tier: MemoryTier): L2KnowledgeItem[] {
    const rows = this.db.prepare('SELECT * FROM l2_knowledge WHERE memory_tier = ? ORDER BY confidence DESC').all(tier) as any[];
    return rows.map((r) => this.mapRuleRow(r));
  }

  // --------------------------------------------------------------------------
  // TEMPORAL KNOWLEDGE GRAPH (GRAPHITI INTEGRATION)
  // --------------------------------------------------------------------------

  public addTemporalEdge(
    sourceRuleId: string,
    targetRuleId: string,
    relation: TemporalRelation,
    metadata?: Record<string, unknown>
  ): void {
    const rule = this.getRule(sourceRuleId);
    if (!rule) return;

    const existingEdges = rule.temporal_edges || [];
    const edge: TemporalEdge = {
      target_id: targetRuleId,
      relation,
      timestamp: new Date().toISOString(),
      metadata,
    };

    const updatedEdges = [...existingEdges, edge];
    this.db
      .prepare('UPDATE l2_knowledge SET temporal_edges = ?, updated_at = ? WHERE rule_id = ?')
      .run(JSON.stringify(updatedEdges), new Date().toISOString(), sourceRuleId);
  }

  /**
   * Marks oldRuleId as superseded by newRuleId, establishes bidirectional temporal edges,
   * sets valid_until on old rule and demotes its tier to COLD.
   */
  public supersedeRule(oldRuleId: string, newRuleId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE l2_knowledge
        SET superseded_by = ?, valid_until = ?, status = 'DEPRECATED', memory_tier = 'COLD', updated_at = ?
        WHERE rule_id = ?
      `)
      .run(newRuleId, now, now, oldRuleId);

    this.addTemporalEdge(oldRuleId, newRuleId, 'superseded_by');
    this.addTemporalEdge(newRuleId, oldRuleId, 'supersedes');
  }

  /**
   * Checks whether a rule is temporally valid at a given point in time (defaulting to now).
   */
  public isTemporallyValid(rule: L2KnowledgeItem, atTimestamp: string = new Date().toISOString()): boolean {
    if (rule.superseded_by) return false;
    if (rule.valid_from && atTimestamp < rule.valid_from) return false;
    if (rule.valid_until && atTimestamp > rule.valid_until) return false;
    return true;
  }

  /**
   * Retrieves full temporal graph context for a rule including direct incoming and outgoing edges.
   */
  public getRuleGraph(ruleId: string): {
    rule: L2KnowledgeItem;
    outgoing_edges: TemporalEdge[];
    incoming_edges: Array<{ source_id: string; relation: TemporalRelation }>;
    related_rules: L2KnowledgeItem[];
  } | null {
    const rule = this.getRule(ruleId);
    if (!rule) return null;

    const outgoing = rule.temporal_edges || [];
    const relatedIds = new Set<string>();
    for (const e of outgoing) {
      relatedIds.add(e.target_id);
    }

    // Find incoming edges from other rules
    const allRules = this.getAllRules();
    const incoming: Array<{ source_id: string; relation: TemporalRelation }> = [];
    for (const other of allRules) {
      if (other.rule_id === ruleId) continue;
      for (const edge of other.temporal_edges || []) {
        if (edge.target_id === ruleId) {
          incoming.push({ source_id: other.rule_id, relation: edge.relation });
          relatedIds.add(other.rule_id);
        }
      }
    }

    const relatedRules: L2KnowledgeItem[] = [];
    for (const id of relatedIds) {
      const r = this.getRule(id);
      if (r) relatedRules.push(r);
    }

    return {
      rule,
      outgoing_edges: outgoing,
      incoming_edges: incoming,
      related_rules: relatedRules,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private mapRuleRow(row: any): L2KnowledgeItem {
    return {
      rule_id: row.rule_id,
      category: row.category as L2RuleCategory,
      content: row.content,
      task_context: row.task_context,
      confidence: row.confidence,
      evidence_count: row.evidence_count,
      contradiction_count: row.contradiction_count,
      status: row.status as L2RuleStatus,
      tags: JSON.parse(row.tags || '[]'),
      provenance: JSON.parse(row.provenance || '[]'),
      created_at: row.created_at,
      updated_at: row.updated_at,
      memory_tier: (row.memory_tier || 'HOT') as MemoryTier,
      vector: JSON.parse(row.vector || '[]'),
      valid_from: row.valid_from || undefined,
      valid_until: row.valid_until || null,
      superseded_by: row.superseded_by || null,
      temporal_edges: JSON.parse(row.temporal_edges || '[]'),
    };
  }

  private mapStrategyRow(row: any): L2Strategy {
    return {
      strategy_id: row.strategy_id,
      name: row.name,
      task_class: row.task_class,
      conditions: row.conditions,
      steps: JSON.parse(row.steps || '[]'),
      success_count: row.success_count,
      failure_count: row.failure_count,
      confidence: row.confidence,
      provenance: JSON.parse(row.provenance || '[]'),
    };
  }

  private seedDefaultRulesIfEmpty(): void {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM l2_knowledge').get() as { count: number };
    if (count.count > 0) return;

    // Seed initial validated rules with provenance
    this.upsertRule({
      ruleId: 'rule-arch-minimal',
      category: 'user_preference',
      taskContext: 'architecture',
      content: 'User prefers minimal architectural changes, localized diffs, and evidence-first reasoning over large rewrites.',
      confidence: 0.94,
      evidenceCount: 3,
      status: 'CONFIRMED',
      tags: ['architecture', 'minimal', 'refactor', 'diff'],
      provenance: ['exp-historical-41', 'exp-historical-73', 'exp-historical-119'],
    });

    this.upsertRule({
      ruleId: 'rule-test-gate',
      category: 'project_constraint',
      taskContext: 'testing',
      content: 'This project requires automated integration testing and verified test pass status before code modifications are marked complete.',
      confidence: 0.92,
      evidenceCount: 4,
      status: 'CONFIRMED',
      tags: ['testing', 'integration', 'verification', 'tests'],
      provenance: ['exp-historical-12', 'exp-historical-15'],
    });

    this.upsertRule({
      ruleId: 'rule-streaming-sse',
      category: 'project_constraint',
      taskContext: 'gateway',
      content: 'Always preserve real-time streaming Server-Sent Events (SSE) behavior for client responsiveness; never buffer stream output unnecessarily.',
      confidence: 0.89,
      evidenceCount: 2,
      status: 'CONFIRMED',
      tags: ['streaming', 'sse', 'proxy', 'latency'],
      provenance: ['exp-historical-19', 'exp-historical-22'],
    });

    this.upsertRule({
      ruleId: 'rule-style-concise',
      category: 'user_preference',
      taskContext: 'communication',
      content: 'User prefers concise responses with bulleted points and explicit confidence metrics rather than conversational filler.',
      confidence: 0.87,
      evidenceCount: 3,
      status: 'CONFIRMED',
      tags: ['communication', 'style', 'concise', 'brevity'],
      provenance: ['exp-historical-55', 'exp-historical-62'],
    });

    // Seed representative strategy
    this.saveStrategy({
      strategyId: 'strat-legacy-debug',
      name: 'Legacy Boundary Debugging Procedure',
      taskClass: 'legacy_debugging',
      conditions: 'Legacy modules without comprehensive automated unit coverage',
      steps: [
        '1. Inspect existing unit and integration tests around the module boundary',
        '2. Identify minimal integration contract interface',
        '3. Make targeted minimal code modification',
        '4. Run targeted tests and check exit codes',
        '5. Run full regression integration test suite',
        '6. Inspect git diff for unintended side-effects',
        '7. Mark successful only after all evidence passes',
      ],
      confidence: 0.88,
      provenance: ['exp-historical-88', 'exp-historical-94'],
    });
  }
}
