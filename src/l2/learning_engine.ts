import { randomUUID } from 'crypto';
import type { L1Experience, L2KnowledgeItem, L2RuleCategory } from '../types';
import type { L2KnowledgeStore } from './store';
import { DeterministicLocalEmbedder, cosineSimilarity } from '../l3/embeddings';

export interface LearnFromExperienceParams {
  experience: L1Experience;
  ruleCandidate?: {
    category?: L2RuleCategory;
    taskContext?: string;
    content: string;
    tags?: string[];
  };
  strategyCandidate?: {
    name: string;
    taskClass: string;
    conditions: string;
    steps: string[];
  };
  toolUsed?: string;
  latencyMs?: number;
}

export class L2LearningEngine {
  private store: L2KnowledgeStore;
  private embedder: DeterministicLocalEmbedder;
  private similarityThreshold: number;

  constructor(
    store: L2KnowledgeStore,
    embedder?: DeterministicLocalEmbedder,
    similarityThreshold: number = 0.25
  ) {
    this.store = store;
    this.embedder = embedder || new DeterministicLocalEmbedder();
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Computes blended contextual semantic similarity between two texts.
   * Combines normalized vector cosine similarity, keyword token overlap, and tag overlap.
   */
  public computeSemanticSimilarity(
    textA: string,
    textB: string,
    vecA?: number[],
    vecB?: number[],
    tagsA?: string[],
    tagsB?: string[]
  ): number {
    const va = vecA && vecA.length > 0 ? vecA : this.embedder.embedSync(textA);
    const vb = vecB && vecB.length > 0 ? vecB : this.embedder.embedSync(textB);
    const cos = Math.max(0, cosineSimilarity(va, vb));

    const wordsA = new Set(
      textA.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
    );
    const wordsB = new Set(
      textB.toLowerCase().replace(/[^a-z0-9_]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
    );
    let inter = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) inter++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    const wordJaccard = union > 0 ? inter / union : 0;

    let tagJaccard = 0;
    if (tagsA && tagsB && (tagsA.length > 0 || tagsB.length > 0)) {
      const setA = new Set(tagsA.map((t) => t.toLowerCase().trim()));
      const setB = new Set(tagsB.map((t) => t.toLowerCase().trim()));
      let ti = 0;
      for (const t of setA) {
        if (setB.has(t)) ti++;
      }
      const tu = new Set([...setA, ...setB]).size;
      tagJaccard = tu > 0 ? ti / tu : 0;
      return 0.50 * cos + 0.25 * wordJaccard + 0.25 * tagJaccard;
    }

    return 0.70 * cos + 0.30 * wordJaccard;
  }

  /**
   * Contextual Compatibility Check:
   * Rules can only corroborate if their contexts are strictly compatible.
   * Disparate contexts (e.g. 'ui' vs 'database') MUST NOT merge even if texts are similar.
   */
  public isContextCompatible(ruleContext: string, candidateContext: string): boolean {
    const rc = ruleContext.toLowerCase().trim();
    const cc = candidateContext.toLowerCase().trim();
    if (rc === cc) return true;
    if (rc === 'general' || cc === 'general' || rc === 'default' || cc === 'default') return true;
    if (rc.startsWith(cc + ':') || cc.startsWith(rc + ':')) return true;
    return false;
  }

  /**
   * Finds the best matching existing rule using Contextual Semantic Corroboration.
   * Replaces raw string equality with semantic vector similarity + contextual compatibility.
   */
  public findCorroboratingRule(candidate: {
    category?: L2RuleCategory;
    taskContext: string;
    content: string;
    tags?: string[];
  }): { rule: L2KnowledgeItem; similarity: number } | null {
    const allRules = this.store.getAllRules();
    const candidateVec = this.embedder.embedSync(candidate.content);

    let bestMatch: L2KnowledgeItem | null = null;
    let highestSim = -1;

    for (const rule of allRules) {
      // 1. Strict contextual compatibility requirement
      if (!this.isContextCompatible(rule.task_context, candidate.taskContext)) {
        continue;
      }

      // 2. Category compatibility (user_preference must match user_preference, etc.)
      if (candidate.category && candidate.category !== rule.category) {
        // Allow cross-match only between learned_rule and project_constraint if context matches
        const ruleNorm = rule.category === 'project_constraint' ? 'learned_rule' : rule.category;
        const candNorm = candidate.category === 'project_constraint' ? 'learned_rule' : candidate.category;
        if (ruleNorm !== candNorm) {
          continue;
        }
      }

      // 3. Exact string match shortcut
      if (rule.content.toLowerCase().trim() === candidate.content.toLowerCase().trim()) {
        return { rule, similarity: 1.0 };
      }

      // 4. Semantic similarity evaluation
      const sim = this.computeSemanticSimilarity(
        candidate.content,
        rule.content,
        candidateVec,
        rule.vector,
        candidate.tags,
        rule.tags
      );

      if (sim >= this.similarityThreshold && sim > highestSim) {
        highestSim = sim;
        bestMatch = rule;
      }
    }

    if (bestMatch) {
      return { rule: bestMatch, similarity: highestSim };
    }
    return null;
  }

  /**
   * Evaluates an experience outcome and triggers appropriate L2 learning.
   * Enforces the Single Observation Rule:
   * 1st occurrence -> HYPOTHESIS (confidence 0.45)
   * 2nd+ occurrence -> CONFIRMED (confidence >= 0.70)
   * Contradiction -> confidence decay & potential deprecation
   */
  public learnFromExperience(params: LearnFromExperienceParams): {
    ruleLearned?: any;
    modelExperienceUpdated?: any;
    strategyUpdated?: any;
  } {
    const exp = params.experience;
    const isSuccess = exp.status === 'SUCCESS' || exp.status === 'PARTIAL_SUCCESS';
    const isFailure = exp.status === 'FAILURE';
    const results: any = {};

    // 1. Model Experience Tracking
    if (exp.model) {
      const taskClass = params.ruleCandidate?.taskContext || exp.project_id || 'general';
      results.modelExperienceUpdated = this.store.recordModelOutcome({
        model: exp.model,
        taskClass,
        context: exp.project_id,
        strategyUsed: params.strategyCandidate?.name,
        success: isSuccess,
        latencyMs: params.latencyMs || 50,
      });
    }

    // 2. Tool Experience Tracking
    if (params.toolUsed) {
      const taskContext = params.ruleCandidate?.taskContext || exp.project_id || 'general';
      this.store.recordToolUsage({
        toolName: params.toolUsed,
        taskContext,
        success: isSuccess,
      });
    }

    // 3. Strategy Memory Tracking
    if (params.strategyCandidate) {
      const existingStrats = this.store.getStrategiesByTaskClass(params.strategyCandidate.taskClass);
      const existing = existingStrats.find((s) => s.name === params.strategyCandidate!.name);

      if (existing) {
        results.strategyUpdated = this.store.recordStrategyOutcome(
          existing.strategy_id,
          isSuccess,
          exp.experience_id
        );
      } else if (isSuccess) {
        results.strategyUpdated = this.store.saveStrategy({
          name: params.strategyCandidate.name,
          taskClass: params.strategyCandidate.taskClass,
          conditions: params.strategyCandidate.conditions,
          steps: params.strategyCandidate.steps,
          confidence: 0.65,
          provenance: [exp.experience_id],
        });
      }
    }

    // 4. Knowledge Rule Learning / Updating with Contextual L2 Corroboration
    // If ruleCandidate was not explicitly passed, extract/infer candidate from experience
    const candidate = params.ruleCandidate || (exp.metadata as any)?.rule_candidate || {
      category: 'learned_rule' as L2RuleCategory,
      taskContext: exp.project_id || 'general',
      content: exp.intent,
      tags: [exp.project_id, ...(exp.affected_files || [])],
    };

    if (candidate && candidate.content) {
      const candidateContext = candidate.taskContext || exp.project_id || 'general';
      const match = this.findCorroboratingRule({
        category: candidate.category || 'learned_rule',
        taskContext: candidateContext,
        content: candidate.content,
        tags: candidate.tags,
      });

      if (match) {
        const existingRule = match.rule;
        if (isSuccess) {
          // Supporting evidence reinforces confidence, increments evidence count, promotes to CONFIRMED if >= 2
          results.ruleLearned = this.store.recordSupportingEvidence(
            existingRule.rule_id,
            exp.experience_id
          );
        } else if (isFailure) {
          // Contradictory evidence penalizes confidence & increments contradiction count
          results.ruleLearned = this.store.recordContradictoryEvidence(
            existingRule.rule_id,
            exp.experience_id
          );
        }
      } else if (isSuccess) {
        // First observation: create a HYPOTHESIS per Single Observation Rule
        results.ruleLearned = this.store.upsertRule({
          ruleId: `rule-hypo-${randomUUID()}`,
          category: candidate.category || 'learned_rule',
          taskContext: candidateContext,
          content: candidate.content,
          confidence: 0.45, // Initial hypothesis confidence
          evidenceCount: 1,
          status: 'HYPOTHESIS',
          tags: candidate.tags || [],
          provenance: [exp.experience_id],
        });
      }
    }

    return results;
  }
}
