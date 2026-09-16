import type { L0Ledger } from '../db/ledger';
import type { L1ExperienceManager } from '../l1/experience';
import type { L2LearningEngine } from '../l2/learning_engine';
import type { L2KnowledgeStore } from '../l2/store';
import type { L4MetaEngine } from '../l4/meta_engine';
import type { L4Store } from '../l4/store';
import type {
  ConsolidationReport,
  L1Experience,
  L2KnowledgeItem,
  MemoryTier,
  MemoryTierDistribution,
} from '../types';

export interface DreamingConsolidatorOptions {
  l0Ledger: L0Ledger;
  l1Manager: L1ExperienceManager;
  l2Store: L2KnowledgeStore;
  l2LearningEngine?: L2LearningEngine;
  l4Store?: L4Store;
  l4MetaEngine?: L4MetaEngine;
}

export class DreamingConsolidator {
  private l0Ledger: L0Ledger;
  private l1Manager: L1ExperienceManager;
  private l2Store: L2KnowledgeStore;
  private l2LearningEngine?: L2LearningEngine;
  private l4Store?: L4Store;
  private l4MetaEngine?: L4MetaEngine;

  constructor(options: DreamingConsolidatorOptions) {
    this.l0Ledger = options.l0Ledger;
    this.l1Manager = options.l1Manager;
    this.l2Store = options.l2Store;
    this.l2LearningEngine = options.l2LearningEngine;
    this.l4Store = options.l4Store;
    this.l4MetaEngine = options.l4MetaEngine;
  }

  public async consolidate(options: {
    coldOlderThanDays?: number;
    archiveOlderThanDays?: number;
  } = {}): Promise<ConsolidationReport> {
    const startMs = performance.now();
    const coldDays = options.coldOlderThanDays ?? 7;
    const archiveDays = options.archiveOlderThanDays ?? 30;

    // Safety Invariant: Snapshot initial L0 count to ensure zero L0 mutation
    const initialL0Count = this.l0Ledger.getEventCount();

    const experiences = this.l1Manager.getAllExperiences();
    const hypothesesPromoted: string[] = [];
    const rulesDecayed: string[] = [];
    const rulesDeprecated: string[] = [];
    const strategiesSynthesized: string[] = [];
    let predictionsSettled = 0;

    // ------------------------------------------------------------------------
    // 1. PATTERN DETECTION & CLUSTERING
    // ------------------------------------------------------------------------
    // Group experiences by normalized intent archetype
    const clusters = new Map<string, L1Experience[]>();
    for (const exp of experiences) {
      const clusterKey = this.extractClusterKey(exp.intent);
      const group = clusters.get(clusterKey) || [];
      group.push(exp);
      clusters.set(clusterKey, group);
    }

    // Process clusters for repeated evidence
    for (const [clusterKey, expList] of clusters.entries()) {
      const successfulExps = expList.filter((e) => e.status === 'SUCCESS');
      const failedExps = expList.filter((e) => e.status === 'FAILURE' || e.reopen_count > 0);

      // Repeated Success -> Corroboration & Hypothesis Promotion
      if (successfulExps.length >= 2) {
        const matchingRules = this.l2Store.getAllRules({ taskContext: clusterKey });
        for (const rule of matchingRules) {
          if (rule.status === 'HYPOTHESIS') {
            // Check if we have corroborated evidence across independent experiences
            const uniqueExpIds = Array.from(new Set([...rule.provenance, ...successfulExps.map((e) => e.experience_id)]));
            if (uniqueExpIds.length >= 2) {
              const promotedConfidence = Math.min(0.95, Math.max(0.75, rule.confidence + 0.25));
              this.l2Store.upsertRule({
                ruleId: rule.rule_id,
                category: rule.category,
                content: rule.content,
                taskContext: rule.task_context,
                confidence: promotedConfidence,
                evidenceCount: uniqueExpIds.length,
                contradictionCount: rule.contradiction_count,
                status: 'CONFIRMED',
                provenance: uniqueExpIds,
                tags: Array.from(new Set([...rule.tags, 'consolidated', 'corroborated'])),
              });
              hypothesesPromoted.push(rule.rule_id);
            }
          }
        }

        // Multi-Step Success -> Strategy Synthesis
        const existingStrategies = this.l2Store.getStrategiesByTaskClass(clusterKey);
        if (existingStrategies.length === 0 && successfulExps.length >= 2) {
          const strategyId = `strat-${clusterKey}-${Date.now()}`;
          this.l2Store.upsertStrategy({
            strategyId,
            name: `Optimized Procedure for ${clusterKey}`,
            taskClass: clusterKey,
            conditions: `When executing tasks matching domain '${clusterKey}'`,
            steps: [
              `1. Retrieve verified constraints for ${clusterKey}`,
              `2. Validate input parameters and safety bounds`,
              `3. Execute operation and verify output evidence`,
            ],
            successCount: successfulExps.length,
            failureCount: failedExps.length,
            confidence: Math.min(0.90, 0.5 + successfulExps.length * 0.1),
            provenance: successfulExps.map((e) => e.experience_id),
          });
          strategiesSynthesized.push(strategyId);
        }
      }

      // Repeated Failure -> Contradiction Detection & Bayesian Decay
      if (failedExps.length > 0) {
        const matchingRules = this.l2Store.getAllRules({ taskContext: clusterKey });
        for (const rule of matchingRules) {
          // If experience failed while using this rule, apply confidence decay
          if (rule.status !== 'DEPRECATED') {
            const newContradictions = rule.contradiction_count + failedExps.length;
            const decayedConfidence = Math.max(0.1, rule.confidence * Math.pow(0.65, failedExps.length));
            const newStatus = decayedConfidence < 0.40 ? 'DEPRECATED' : rule.status;

            this.l2Store.upsertRule({
              ruleId: rule.rule_id,
              category: rule.category,
              content: rule.content,
              taskContext: rule.task_context,
              confidence: decayedConfidence,
              evidenceCount: rule.evidence_count,
              contradictionCount: newContradictions,
              status: newStatus,
              provenance: rule.provenance,
              tags: Array.from(new Set([...rule.tags, 'decayed_by_failure'])),
            });

            rulesDecayed.push(rule.rule_id);
            if (newStatus === 'DEPRECATED') {
              rulesDeprecated.push(rule.rule_id);
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // 2. PREDICTION SETTLEMENT
    // ------------------------------------------------------------------------
    if (this.l4Store && this.l4MetaEngine) {
      const pendingPredictions = this.l4Store.getPredictions({ resolved: false });
      for (const pred of pendingPredictions) {
        // Look for corresponding settled L1 experience
        const matchedExp = experiences.find(
          (e) => (e.correlation_id === pred.correlation_id || e.experience_id === pred.experience_id || e.correlation_id === pred.task_context) &&
                 (e.status === 'SUCCESS' || e.status === 'FAILURE' || e.status === 'PARTIAL_SUCCESS')
        );

        if (matchedExp) {
          const outcomeValue = matchedExp.status === 'SUCCESS' ? 1.0 : 0.0;
          this.l4MetaEngine.resolvePrediction(pred.prediction_id, outcomeValue, matchedExp.experience_id);
          predictionsSettled++;
        }
      }
    }

    // ------------------------------------------------------------------------
    // 3. MEMORY LIFECYCLE MANAGEMENT (HOT -> WARM -> COLD -> ARCHIVE)
    // ------------------------------------------------------------------------
    const nowEpoch = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const coldMs = coldDays * oneDayMs;
    const archiveMs = archiveDays * oneDayMs;

    for (const exp of experiences) {
      const closedAtEpoch = exp.closed_at ? new Date(exp.closed_at).getTime() : nowEpoch;
      const ageMs = nowEpoch - closedAtEpoch;

      let targetTier: MemoryTier = 'HOT';
      if (['PROPOSED', 'PROVISIONALLY_ACCEPTED', 'OBSERVATION', 'REOPENED_BY_EVIDENCE'].includes(exp.status)) {
        targetTier = 'HOT';
      } else if (ageMs > archiveMs) {
        targetTier = 'ARCHIVE';
      } else if (ageMs > coldMs) {
        targetTier = 'COLD';
      } else if (ageMs > oneDayMs) {
        targetTier = 'WARM';
      } else {
        targetTier = 'HOT';
      }

      if (exp.memory_tier !== targetTier) {
        this.l1Manager.updateMemoryTier(exp.experience_id, targetTier);
      }
    }

    // Tier L2 Rules
    const allRules = this.l2Store.getAllRules();
    for (const rule of allRules) {
      let targetTier: MemoryTier = 'HOT';
      if (rule.status === 'DEPRECATED') {
        targetTier = 'COLD';
      } else if (rule.status === 'CONFIRMED' && rule.confidence >= 0.7) {
        targetTier = 'WARM'; // Stable confirmed
      } else {
        targetTier = 'HOT'; // Active hypothesis
      }

      if (rule.memory_tier !== targetTier) {
        this.l2Store.updateRuleMemoryTier(rule.rule_id, targetTier);
      }
    }

    // ------------------------------------------------------------------------
    // 4. MEMORY TIER DISTRIBUTION AUDIT
    // ------------------------------------------------------------------------
    const refreshedExperiences = this.l1Manager.getAllExperiences();
    const refreshedRules = this.l2Store.getAllRules();

    let hotCount = 0;
    let warmCount = 0;
    let coldCount = 0;
    let archiveCount = 0;

    for (const exp of refreshedExperiences) {
      if (exp.memory_tier === 'ARCHIVE') archiveCount++;
      else if (exp.memory_tier === 'COLD') coldCount++;
      else if (exp.memory_tier === 'WARM') warmCount++;
      else hotCount++;
    }

    for (const rule of refreshedRules) {
      if (rule.memory_tier === 'ARCHIVE') archiveCount++;
      else if (rule.memory_tier === 'COLD') coldCount++;
      else if (rule.memory_tier === 'WARM') warmCount++;
      else hotCount++;
    }

    const tierDistribution: MemoryTierDistribution = {
      hot_count: hotCount,
      warm_count: warmCount,
      cold_count: coldCount,
      archive_count: archiveCount,
      total_records: refreshedExperiences.length + refreshedRules.length,
    };

    // ------------------------------------------------------------------------
    // 5. SAFETY INVARIANT AUDIT
    // ------------------------------------------------------------------------
    // Crucial rule from anti.md: "Never destroy raw L0 merely because consolidation occurs."
    const finalL0Count = this.l0Ledger.getEventCount();
    if (finalL0Count < initialL0Count) {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: L0 raw events were deleted or destroyed during consolidation! Initial=${initialL0Count}, Final=${finalL0Count}`
      );
    }

    const durationMs = Math.round((performance.now() - startMs) * 100) / 100;

    return {
      timestamp: new Date().toISOString(),
      experiences_scanned: experiences.length,
      clusters_detected: clusters.size,
      hypotheses_promoted: hypothesesPromoted,
      rules_decayed: rulesDecayed,
      rules_deprecated: rulesDeprecated,
      strategies_synthesized: strategiesSynthesized,
      predictions_settled: predictionsSettled,
      tier_distribution: tierDistribution,
      duration_ms: durationMs,
    };
  }

  private extractClusterKey(intent: string): string {
    const lower = intent.toLowerCase();
    if (lower.includes('test') || lower.includes('jest') || lower.includes('bun test')) return 'testing_gate';
    if (lower.includes('migrat') || lower.includes('schema') || lower.includes('sql')) return 'database_migration';
    if (lower.includes('format') || lower.includes('lint') || lower.includes('prettier')) return 'code_style';
    if (lower.includes('auth') || lower.includes('token') || lower.includes('jwt')) return 'authentication';
    if (lower.includes('build') || lower.includes('deploy') || lower.includes('release')) return 'build_deployment';
    return 'general';
  }
}
