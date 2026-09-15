import type { L0EventLedger } from '../db/ledger';
import type { L1ExperienceManager } from '../l1/experience';
import type { L2KnowledgeStore } from '../l2/store';
import type {
  L4CalibrationMetrics,
  L4ContextualReliability,
  L4Prediction,
  L4RetrievalFeedback,
  L4SelfModel,
} from '../types';
import type { L4Store } from './store';

export class L4MetaEngine {
  private l4Store: L4Store;
  private l2Store: L2KnowledgeStore;
  private expManager?: L1ExperienceManager;
  private ledger?: L0EventLedger;

  // Known archetypal technical domains used to identify epistemic frontiers / blind spots
  private static SYSTEM_DOMAIN_ARCHETYPES = [
    'distributed_consensus',
    'cryptographic_primitives',
    'kernel_memory_management',
    'hardware_io_interfaces',
    'compiler_backend_codegen',
  ];

  constructor(
    l4Store: L4Store,
    l2Store: L2KnowledgeStore,
    expManager?: L1ExperienceManager,
    ledger?: L0EventLedger
  ) {
    this.l4Store = l4Store;
    this.l2Store = l2Store;
    this.expManager = expManager;
    this.ledger = ledger;
  }

  public getStore(): L4Store {
    return this.l4Store;
  }

  // --------------------------------------------------------------------------
  // PREDICTION BEFORE OUTCOME
  // --------------------------------------------------------------------------

  public recordPrediction(params: {
    predictionId?: string;
    experienceId?: string | null;
    correlationId?: string | null;
    context?: string | null;
    taskContext?: string;
    taskClass?: string;
    predictionText?: string;
    claim?: string;
    predictedOutcome?: 'SUCCESS' | 'FAILURE';
    confidence: number;
    rationale?: string | null;
    modelUsed?: string;
  }): L4Prediction {
    const taskContext = params.taskContext || params.taskClass || 'general';
    const predictionText = params.predictionText || params.claim || 'Task prediction wager';
    const correlationId = params.correlationId || params.context || null;
    return this.l4Store.savePrediction({
      predictionId: params.predictionId,
      experienceId: params.experienceId,
      correlationId,
      taskContext,
      predictionText,
      predictedOutcome: params.predictedOutcome || 'SUCCESS',
      confidence: params.confidence,
      rationale: params.rationale || (params.modelUsed ? `Model: ${params.modelUsed}` : null),
    });
  }

  public resolveOutcome(params: {
    predictionId: string;
    actualOutcome: 'SUCCESS' | 'FAILURE' | 'UNKNOWN';
    evidenceId?: string | null;
  }): L4Prediction {
    return this.l4Store.resolvePrediction(params);
  }

  public resolvePrediction(
    predictionId: string,
    actualOutcome: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | number,
    evidenceId?: string | null
  ): L4Prediction {
    const outcome: 'SUCCESS' | 'FAILURE' =
      typeof actualOutcome === 'number'
        ? (actualOutcome >= 0.5 ? 'SUCCESS' : 'FAILURE')
        : (actualOutcome === 'UNKNOWN' ? 'FAILURE' : actualOutcome);
    return this.resolveOutcome({
      predictionId,
      actualOutcome: outcome,
      evidenceId,
    });
  }

  // --------------------------------------------------------------------------
  // CALIBRATION & BIAS METRICS
  // --------------------------------------------------------------------------

  public calculateCalibration(filter?: { taskContext?: string }): L4CalibrationMetrics {
    const all = this.l4Store.getAllPredictions(filter);
    const resolved = all.filter((p) => p.brier_score !== null && p.actual_outcome !== null);

    if (resolved.length === 0) {
      return {
        total_predictions: all.length,
        resolved_predictions: 0,
        mean_brier_score: 0,
        average_confidence: 0,
        accuracy: 0,
        calibration_bias: 0,
        calibration_status: 'INSUFFICIENT_DATA',
        contextual_breakdown: {},
      };
    }

    const brierSum = resolved.reduce((acc, p) => acc + (p.brier_score || 0), 0);
    const confSum = resolved.reduce((acc, p) => acc + p.confidence, 0);
    const correctCount = resolved.filter((p) => p.actual_outcome === p.predicted_outcome).length;

    const meanBrier = Math.round((brierSum / resolved.length) * 1000) / 1000;
    const avgConf = Math.round((confSum / resolved.length) * 1000) / 1000;
    const accuracy = Math.round((correctCount / resolved.length) * 1000) / 1000;
    const bias = Math.round((avgConf - accuracy) * 1000) / 1000;

    let status: L4CalibrationMetrics['calibration_status'] = 'WELL_CALIBRATED';
    if (resolved.length < 2) {
      status = 'INSUFFICIENT_DATA';
    } else if (bias > 0.10) {
      status = 'OVERCONFIDENT';
    } else if (bias < -0.10) {
      status = 'UNDERCONFIDENT';
    }

    // Contextual breakdown
    const breakdown: L4CalibrationMetrics['contextual_breakdown'] = {};
    const grouped = new Map<string, L4Prediction[]>();
    for (const p of resolved) {
      const list = grouped.get(p.task_context) || [];
      list.push(p);
      grouped.set(p.task_context, list);
    }

    for (const [ctx, list] of grouped.entries()) {
      const ctxBrierSum = list.reduce((acc, p) => acc + (p.brier_score || 0), 0);
      const ctxCorrect = list.filter((p) => p.actual_outcome === p.predicted_outcome).length;
      breakdown[ctx] = {
        brier_score: Math.round((ctxBrierSum / list.length) * 1000) / 1000,
        accuracy: Math.round((ctxCorrect / list.length) * 1000) / 1000,
        sample_count: list.length,
      };
    }

    return {
      total_predictions: all.length,
      resolved_predictions: resolved.length,
      mean_brier_score: meanBrier,
      average_confidence: avgConf,
      accuracy,
      calibration_bias: bias,
      calibration_status: status,
      contextual_breakdown: breakdown,
    };
  }

  // --------------------------------------------------------------------------
  // CONTEXTUAL RELIABILITY (NON-UNIVERSAL)
  // --------------------------------------------------------------------------

  public evaluateContextualReliability(
    taskContext: string,
    options?: {
      model?: string;
      tool?: string;
      strategyId?: string;
    }
  ): L4ContextualReliability {
    const reasoning: string[] = [];

    // 1. Task predictions & calibration
    const taskPreds = this.l4Store.getAllPredictions({ taskContext, resolvedOnly: true });
    let taskReliability = 0.65;
    let brierPenalty = 0.20;

    if (taskPreds.length > 0) {
      const correct = taskPreds.filter((p) => p.actual_outcome === p.predicted_outcome).length;
      taskReliability = Math.round((correct / taskPreds.length) * 100) / 100;
      const brierSum = taskPreds.reduce((acc, p) => acc + (p.brier_score || 0), 0);
      brierPenalty = Math.round((brierSum / taskPreds.length) * 100) / 100;
      reasoning.push(
        `Task empirical accuracy: ${Math.round(taskReliability * 100)}% (Brier: ${brierPenalty}, samples: ${taskPreds.length})`
      );
    } else {
      reasoning.push(`Zero direct predictions in context '${taskContext}' — using uncalibrated baseline.`);
    }

    // 2. Model reliability in this context
    let modelReliability = 0.70;
    if (options?.model) {
      const exp = this.l2Store.getModelExperience(options.model, taskContext);
      if (exp && exp.sample_count > 0) {
        modelReliability = exp.confidence;
        reasoning.push(
          `Model '${options.model}' track record in '${taskContext}': ${Math.round(modelReliability * 100)}% (samples: ${exp.sample_count})`
        );
      } else {
        reasoning.push(`Model '${options.model}' has zero historical observations in context '${taskContext}'.`);
      }
    }

    // 3. Strategy reliability
    let strategyReliability = 0.65;
    if (options?.strategyId) {
      const strat = this.l2Store.getStrategy(options.strategyId);
      if (strat) {
        strategyReliability = strat.confidence;
        reasoning.push(`Selected strategy '${strat.name}' confidence: ${Math.round(strategyReliability * 100)}%`);
      }
    } else {
      const strats = this.l2Store.getStrategiesByTaskClass(taskContext);
      if (strats.length > 0) {
        strategyReliability = strats[0].confidence;
        reasoning.push(`Top strategy for '${taskContext}' has confidence: ${Math.round(strategyReliability * 100)}%`);
      }
    }

    // 4. Belief reliability in this context
    const contextRules = this.l2Store.getAllRules({ taskContext, status: 'CONFIRMED' });
    let beliefReliability = 0.60;
    if (contextRules.length > 0) {
      const confSum = contextRules.reduce((acc, r) => acc + r.confidence, 0);
      beliefReliability = Math.round((confSum / contextRules.length) * 100) / 100;
      reasoning.push(`Active confirmed beliefs in '${taskContext}': ${contextRules.length} (Avg conf: ${Math.round(beliefReliability * 100)}%)`);
    }

    // Check for conflicting beliefs in this context
    const allContextRules = this.l2Store.getAllRules({ taskContext });
    const hasContradictions = allContextRules.some((r) => r.contradiction_count > 0);
    if (hasContradictions) {
      reasoning.push(`WARNING: Context '${taskContext}' contains active contradictions.`);
    }

    // Multi-dimensional composite score:
    // 0.3 * task_rel + 0.25 * (1 - brier) + 0.25 * model_rel + 0.2 * strat_rel
    const rawComposite =
      0.3 * taskReliability +
      0.25 * Math.max(0, 1 - brierPenalty) +
      0.25 * modelReliability +
      0.2 * strategyReliability;

    const compositeReliability = Math.round(Math.max(0, Math.min(1, rawComposite)) * 100) / 100;

    // Human verification condition:
    // Low composite reliability (< 0.50) OR active contradictions
    const requiresHuman = compositeReliability < 0.50 || hasContradictions;
    if (requiresHuman) {
      reasoning.push('Requires human verification due to low composite reliability or belief contradictions.');
    }

    return {
      task_context: taskContext,
      composite_reliability: compositeReliability,
      task_reliability: taskReliability,
      model_reliability: modelReliability,
      strategy_reliability: strategyReliability,
      belief_reliability: beliefReliability,
      brier_penalty: brierPenalty,
      requires_human_verification: requiresHuman,
      reasoning,
    };
  }

  // --------------------------------------------------------------------------
  // RETRIEVAL FEEDBACK
  // --------------------------------------------------------------------------

  public recordRetrievalFeedback(params: {
    experienceId: string;
    ruleId: string;
    wasUseful: boolean;
  }): L4RetrievalFeedback {
    return this.l4Store.saveRetrievalFeedback(params);
  }

  // --------------------------------------------------------------------------
  // SELF-MODEL SYNTHESIS (STRICTLY EPISTEMIC — NOT CONSCIOUSNESS)
  // --------------------------------------------------------------------------

  public synthesizeSelfModel(): L4SelfModel {
    const allRules = this.l2Store.getAllRules();
    const confirmedRules = allRules.filter((r) => r.status === 'CONFIRMED');

    // Known domains: distinct contexts with confirmed rules
    const knownDomains = Array.from(new Set(confirmedRules.map((r) => r.task_context)));

    // Unknown domains: standard system archetypes that have no confirmed rules
    const unknownDomains = L4MetaEngine.SYSTEM_DOMAIN_ARCHETYPES.filter(
      (d) => !knownDomains.includes(d)
    );

    // Weak beliefs: hypotheses or low confidence (< 0.60)
    const weakBeliefs = allRules
      .filter((r) => r.status === 'HYPOTHESIS' || r.confidence < 0.60)
      .map((r) => ({
        rule_id: r.rule_id,
        content: r.content,
        confidence: r.confidence,
        task_context: r.task_context,
      }));

    // Conflicting beliefs: rules with contradiction_count >= 1
    const conflictingBeliefs = allRules
      .filter((r) => r.contradiction_count >= 1)
      .map((r) => ({
        rule_id: r.rule_id,
        content: r.content,
        contradiction_count: r.contradiction_count,
        task_context: r.task_context,
      }));

    // Strategy evaluations
    const allStrategies = this.l2Store.getAllStrategies();
    const successfulStrategies = allStrategies
      .filter((s) => s.confidence >= 0.70)
      .map((s) => s.name);
    const failedStrategies = allStrategies
      .filter((s) => s.failure_count > s.success_count)
      .map((s) => s.name);

    // Unreliable tools: usefulness < 0.50
    const allTools = this.l2Store.getAllToolExperiences();
    const unreliableTools = allTools
      .filter((t) => t.usefulness_score < 0.50 && t.usage_count >= 1)
      .map((t) => ({
        tool_name: t.tool_name,
        usefulness_score: t.usefulness_score,
        task_context: t.task_context,
      }));

    // Prediction wagers & calibration
    const allPreds = this.l4Store.getAllPredictions({ resolvedOnly: true });
    const failedPredsCount = allPreds.filter((p) => p.actual_outcome !== p.predicted_outcome).length;
    const calibration = this.calculateCalibration();

    // Situations requiring human input
    const situations: string[] = [];
    if (conflictingBeliefs.length > 0) {
      situations.push(
        `Conflicting beliefs exist in contexts: ${Array.from(new Set(conflictingBeliefs.map((c) => c.task_context))).join(', ')}`
      );
    }
    if (unreliableTools.length > 0) {
      situations.push(
        `Unreliable tools detected: ${unreliableTools.map((u) => `${u.tool_name} in ${u.task_context}`).join(', ')}`
      );
    }
    if (calibration.calibration_status === 'OVERCONFIDENT') {
      situations.push(`Systematic overconfidence detected (+${calibration.calibration_bias}). Require human verification for high-risk bets.`);
    }
    if (unknownDomains.length > 0) {
      situations.push(`Zero empirical observations in unexplored domains: ${unknownDomains.join(', ')}`);
    }

    return {
      synthesized_at: new Date().toISOString(),
      known_domains: knownDomains,
      unknown_domains: unknownDomains,
      confirmed_beliefs_count: confirmedRules.length,
      weak_beliefs: weakBeliefs,
      conflicting_beliefs: conflictingBeliefs,
      failed_predictions_count: failedPredsCount,
      successful_strategies: successfulStrategies,
      failed_strategies: failedStrategies,
      unreliable_tools: unreliableTools,
      calibration,
      situations_requiring_human_input: situations,
    };
  }
}
