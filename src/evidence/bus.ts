import { randomUUID } from 'crypto';
import type { L0EventLedger } from '../db/ledger';
import type { L1ExperienceManager } from '../l1/experience';
import type { L2LearningEngine } from '../l2/learning_engine';
import type { L4MetaEngine } from '../l4/meta_engine';
import type { DreamScheduler } from '../consolidation/scheduler';
import type { EvidenceSignal, EvidenceSource, EvidenceType, L1Experience } from '../types';

export type SignalHandler = (signal: EvidenceSignal) => void | Promise<void>;

export interface EmitSignalParams {
  source: EvidenceSource;
  type: EvidenceType;
  correlationId?: string;
  projectId?: string;
  files?: string[];
  payload?: Record<string, unknown>;
}

export class EvidenceBus {
  private ledger: L0EventLedger;
  private experienceManager?: L1ExperienceManager;
  private learningEngine?: L2LearningEngine;
  private metaEngine?: L4MetaEngine;
  private dreamScheduler?: DreamScheduler;
  private listeners: SignalHandler[] = [];

  constructor(
    ledger: L0EventLedger,
    experienceManager?: L1ExperienceManager,
    learningEngine?: L2LearningEngine,
    metaEngine?: L4MetaEngine
  ) {
    this.ledger = ledger;
    this.experienceManager = experienceManager;
    this.learningEngine = learningEngine;
    this.metaEngine = metaEngine;
  }

  public setExperienceManager(mgr: L1ExperienceManager): void {
    this.experienceManager = mgr;
  }

  public setLearningEngine(engine: L2LearningEngine): void {
    this.learningEngine = engine;
  }

  public setMetaEngine(engine: L4MetaEngine): void {
    this.metaEngine = engine;
  }

  public setDreamScheduler(scheduler: DreamScheduler): void {
    this.dreamScheduler = scheduler;
  }

  public subscribe(handler: SignalHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  public async ingestSignal(signal: EvidenceSignal): Promise<EvidenceSignal> {
    return this.emit({
      source: signal.source,
      type: signal.type,
      correlationId: signal.correlation_id,
      projectId: signal.project_id,
      files: signal.files,
      payload: signal.payload as Record<string, unknown>,
    });
  }

  public async emit(params: EmitSignalParams): Promise<EvidenceSignal> {
    const signal: EvidenceSignal = {
      signal_id: `sig-${randomUUID()}`,
      source: params.source,
      type: params.type,
      correlation_id: params.correlationId,
      project_id: params.projectId || 'default',
      files: params.files || [],
      payload: params.payload || {},
      timestamp: new Date().toISOString(),
    };

    // 1. Record raw evidence into L0 Event Ledger (immutable audit trail)
    this.ledger.appendEvent({
      correlationId: signal.correlation_id || `evidence-${signal.signal_id}`,
      projectId: signal.project_id,
      actor: 'system',
      eventType: 'evidence_ingested',
      payload: {
        signal_id: signal.signal_id,
        source: signal.source,
        type: signal.type,
        files: signal.files,
        payload: signal.payload,
      },
      metadata: {
        evidence_source: signal.source,
        evidence_type: signal.type,
      },
    });

    // 2. Dispatch causally to L1 Experience Manager if linked
    if (this.experienceManager) {
      await this.processSignalForExperiences(signal);
    }

    // 3. Notify subscribers
    for (const listener of this.listeners) {
      try {
        await listener(signal);
      } catch (err) {
        console.error(`[EvidenceBus] Listener error on signal ${signal.signal_id}:`, err);
      }
    }

    return signal;
  }

  private async processSignalForExperiences(signal: EvidenceSignal): Promise<void> {
    if (!this.experienceManager) return;

    let targetExperiences: L1Experience[] = [];

    // Priority 1: Direct Correlation ID match
    if (signal.correlation_id) {
      const exp = this.experienceManager.getExperienceByCorrelationId(signal.correlation_id);
      if (exp) {
        targetExperiences.push(exp);
      }
    }

    // Priority 2: File overlap within project
    if (targetExperiences.length === 0 && signal.files.length > 0) {
      targetExperiences = this.experienceManager.findActiveExperiencesByFiles(
        signal.project_id,
        signal.files
      );
    }

    for (const exp of targetExperiences) {
      const isPositive = ['test_pass', 'commit', 'build_success', 'user_accept'].includes(signal.type);
      const isNegative = ['test_fail', 'build_fail', 'user_reject'].includes(signal.type);
      const isPartial = signal.type === 'user_correction';

      let settledExp: L1Experience | null = null;

      if (['PROPOSED', 'PROVISIONALLY_ACCEPTED', 'OBSERVATION'].includes(exp.status)) {
        if (isPositive) {
          settledExp = this.experienceManager.settleOutcome(
            exp.experience_id,
            'SUCCESS',
            0.88,
            'SUCCESS_SIGNAL',
            signal
          );
        } else if (isNegative) {
          settledExp = this.experienceManager.settleOutcome(
            exp.experience_id,
            'FAILURE',
            0.92,
            'FAILURE_SIGNAL',
            signal
          );
        } else if (isPartial) {
          settledExp = this.experienceManager.settleOutcome(
            exp.experience_id,
            'PARTIAL_SUCCESS',
            0.75,
            'USER_CLOSED',
            signal
          );
        }
      } else if (['SUCCESS', 'PARTIAL_SUCCESS'].includes(exp.status)) {
        // DELAYED CAUSALITY & REOPENING:
        // Experience was already provisionally marked closed/success, but a later negative signal arrived!
        if (isNegative) {
          this.experienceManager.reopenWithEvidence(exp.experience_id, signal);
          settledExp = this.experienceManager.reclassify(
            exp.experience_id,
            'FAILURE',
            0.95,
            'FAILURE_SIGNAL'
          );
        } else if (isPartial) {
          this.experienceManager.reopenWithEvidence(exp.experience_id, signal);
          settledExp = this.experienceManager.reclassify(
            exp.experience_id,
            'PARTIAL_SUCCESS',
            0.7,
            'USER_CLOSED'
          );
        }
      }

      // AUTOMATIC LEARNING PATH:
      // Route verified outcome directly into L2 Learning Engine without manual API invocation
      if (settledExp && this.learningEngine) {
        const payloadCandidate = (signal.payload as any)?.rule_candidate;
        const metaCandidate = (settledExp.metadata as any)?.rule_candidate;
        const ruleCandidate = payloadCandidate || metaCandidate || {
          category: 'learned_rule' as const,
          taskContext: settledExp.project_id || 'general',
          content: (signal.payload as any)?.rule_content || settledExp.intent,
          tags: [settledExp.project_id, ...(settledExp.affected_files || [])],
        };

        const learnResults = this.learningEngine.learnFromExperience({
          experience: settledExp,
          ruleCandidate,
          strategyCandidate:
            (signal.payload as any)?.strategy_candidate || (settledExp.metadata as any)?.strategy_candidate,
          toolUsed: (signal.payload as any)?.tool || (signal.payload as any)?.tool_name,
          latencyMs: (signal.payload as any)?.latency_ms || (signal.payload as any)?.duration_ms || 50,
        });

        // Append L0 audit event linking settled experience to automatic learning
        const parentEventId =
          settledExp.supporting_l0_event_ids && settledExp.supporting_l0_event_ids.length > 0
            ? settledExp.supporting_l0_event_ids[settledExp.supporting_l0_event_ids.length - 1]
            : undefined;

        this.ledger.appendEvent({
          parentEventId,
          correlationId: settledExp.correlation_id,
          projectId: settledExp.project_id,
          actor: 'brain',
          eventType: 'knowledge_learned',
          payload: {
            experience_id: settledExp.experience_id,
            outcome: settledExp.status,
            evidence_signal_id: signal.signal_id,
            results: learnResults,
          },
          metadata: {
            rule_id: learnResults.ruleLearned?.rule_id,
            confidence: learnResults.ruleLearned?.confidence,
            status: learnResults.ruleLearned?.status,
            evidence_count: learnResults.ruleLearned?.evidence_count,
          },
        });

        // Automatically resolve matching L4 prediction if meta engine is configured
        if (this.metaEngine) {
          try {
            const preds = this.metaEngine.getStore().getAllPredictions({
              taskContext: settledExp.project_id,
              resolvedOnly: false,
            });
            const matchPred = preds.find(
              (p) =>
                p.experience_id === settledExp!.experience_id ||
                p.correlation_id === settledExp!.correlation_id
            );
            if (matchPred) {
              this.metaEngine.resolveOutcome({
                predictionId: matchPred.prediction_id,
                actualOutcome: settledExp.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
                evidenceId: signal.signal_id,
              });
            }
          } catch {
            // Fail open for meta predictions
          }
        }
      }

      if (settledExp) {
        // Event-driven consolidation trigger
        this.dreamScheduler?.onExperienceSettled();
      }
    }
  }
}
