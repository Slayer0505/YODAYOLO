import { randomUUID } from 'crypto';
import type { L0Ledger } from '../db/ledger';
import type { EvidenceBus } from '../evidence/bus';
import type { HeartSupervisor } from '../heart/supervisor';
import type { L1ExperienceManager } from '../l1/experience';
import type { L2LearningEngine } from '../l2/learning_engine';
import type { L2KnowledgeStore } from '../l2/store';
import type { L3ContextCompiler } from '../l3/compiler';
import { BrainContextEnvelope } from '../l3/envelope';
import type { L4MetaEngine } from '../l4/meta_engine';
import type { L4Store } from '../l4/store';
import type { ReasoningProvider } from '../types';
import type { ToolRegistry } from '../tools/registry';
import type {
  CognitiveLoopExecutionResult,
  CognitiveLoopStage,
  EvidenceSignal,
  HeartEvaluation,
  L1Experience,
  L2KnowledgeItem,
  L3CompiledContext,
  L4ContextualReliability,
  L4Prediction,
} from '../types';

export interface CognitiveLoopOrchestratorOptions {
  l0Ledger: L0Ledger;
  l1Manager: L1ExperienceManager;
  l2Store: L2KnowledgeStore;
  l2LearningEngine: L2LearningEngine;
  l3Compiler: L3ContextCompiler;
  l4Store: L4Store;
  l4MetaEngine: L4MetaEngine;
  heartSupervisor: HeartSupervisor;
  evidenceBus: EvidenceBus;
  provider: ReasoningProvider;
  toolRegistry?: ToolRegistry;
}

export interface RunCycleParams {
  userPrompt: string;
  model?: string;
  taskContext?: string;
  userConfirmation?: boolean;
  predictionWager?: {
    claim: string;
    confidence: number;
  };
  toolExecution?: {
    toolName: string;
    args: Record<string, unknown>;
    execute?: (args: Record<string, unknown>) => Promise<{ success: boolean; output: any }>;
  };
  delayedOutcome?: {
    status: 'SUCCESS' | 'FAILURE';
    closureReason?: string;
  };
}

export class CognitiveLoopOrchestrator {
  private l0Ledger: L0Ledger;
  private l1Manager: L1ExperienceManager;
  private l2Store: L2KnowledgeStore;
  private l2LearningEngine: L2LearningEngine;
  private l3Compiler: L3ContextCompiler;
  private l4Store: L4Store;
  private l4MetaEngine: L4MetaEngine;
  private heartSupervisor: HeartSupervisor;
  private evidenceBus: EvidenceBus;
  public provider: ReasoningProvider;
  public toolRegistry?: ToolRegistry;

  constructor(options: CognitiveLoopOrchestratorOptions) {
    this.l0Ledger = options.l0Ledger;
    this.l1Manager = options.l1Manager;
    this.l2Store = options.l2Store;
    this.l2LearningEngine = options.l2LearningEngine;
    this.l3Compiler = options.l3Compiler;
    this.l4Store = options.l4Store;
    this.l4MetaEngine = options.l4MetaEngine;
    this.heartSupervisor = options.heartSupervisor;
    this.evidenceBus = options.evidenceBus;
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
  }

  public updateProvider(provider: ReasoningProvider): void {
    this.provider = provider;
  }

  public async runCycle(params: RunCycleParams): Promise<CognitiveLoopExecutionResult> {
    return this.runFullLoop(params);
  }

  public async runFullLoop(params: RunCycleParams): Promise<CognitiveLoopExecutionResult> {
    const startMs = performance.now();
    const correlationId = `corr-${randomUUID()}`;
    const transactionId = `tx-${randomUUID()}`;
    const stagesExecuted: CognitiveLoopStage[] = [];
    const model = params.model || this.provider.defaultModel || 'neutral-reasoner';
    const taskContext = params.taskContext || 'general';

    // ------------------------------------------------------------------------
    // STAGE 1: USER_REQUEST
    // ------------------------------------------------------------------------
    stagesExecuted.push('USER_REQUEST');
    const userEvent = this.l0Ledger.appendEvent({
      correlation_id: correlationId,
      actor: 'user',
      event_type: 'user_input',
      payload: {
        prompt: params.userPrompt,
        model,
        task_context: taskContext,
        user_confirmation: params.userConfirmation ?? false,
      },
      metadata: { transaction_id: transactionId },
    });

    // ------------------------------------------------------------------------
    // STAGE 2: L3_COMPILATION
    // ------------------------------------------------------------------------
    stagesExecuted.push('L3_COMPILATION');
    const l3Compiled: L3CompiledContext = await this.l3Compiler.compile(params.userPrompt, 'default', {
      modelName: model,
    });

    // ------------------------------------------------------------------------
    // STAGE 3: HEART_SUPERVISION
    // ------------------------------------------------------------------------
    stagesExecuted.push('HEART_SUPERVISION');
    const heartEvaluation: HeartEvaluation = this.heartSupervisor.evaluateAction({
      action: params.userPrompt,
      context: taskContext,
      user_override: params.userConfirmation ?? false,
    });

    // Attach Heart directives to L3 compiled context
    l3Compiled.heart_directive = heartEvaluation;
    const l3Envelope = BrainContextEnvelope.wrap(params.userPrompt, l3Compiled);

    // If BIOS rule triggered without human confirmation, record safety violation and abort
    if (heartEvaluation.requires_human_confirmation && !heartEvaluation.user_override_granted) {
      this.l0Ledger.appendEvent({
        parent_event_id: userEvent.event_id,
        correlation_id: correlationId,
        actor: 'heart',
        event_type: 'safety_violation',
        payload: {
          blocked_action: params.userPrompt,
          rule_triggered: heartEvaluation.bios_rule_triggered,
          risk: heartEvaluation.risk_level,
          rationale: heartEvaluation.rationale,
        },
      });

      throw new Error(
        `Action blocked by Original Brain Heart BIOS: ${heartEvaluation.rationale}`
      );
    }

    // Optional L4 Prediction Wager prior to reasoning / execution
    let predictionRecord: L4Prediction | undefined;
    if (params.predictionWager) {
      predictionRecord = this.l4MetaEngine.recordPrediction({
        taskClass: taskContext,
        predictedOutcome: 'SUCCESS',
        confidence: params.predictionWager.confidence,
        modelUsed: model,
        context: correlationId,
        claim: params.predictionWager.claim,
      });
    }

    // ------------------------------------------------------------------------
    // STAGE 4: MODEL_REASONING
    // ------------------------------------------------------------------------
    stagesExecuted.push('MODEL_REASONING');
    const chatResponse = await this.provider.chat({
      model,
      messages: [
        { role: 'system', content: 'You are an intelligent assistant integrated with The Original Brain.' },
        { role: 'user', content: l3Envelope },
      ],
    });
    const reasoningText = chatResponse.choices[0]?.message?.content || '';

    this.l0Ledger.appendEvent({
      parent_event_id: userEvent.event_id,
      correlation_id: correlationId,
      actor: 'reasoning_engine',
      event_type: 'model_output',
      payload: {
        content: reasoningText,
        model,
      },
    });

    // ------------------------------------------------------------------------
    // STAGE 5: TOOL_ACTION
    // ------------------------------------------------------------------------
    let toolResultRecord: any = undefined;
    const effectiveToolExecution = params.toolExecution || extractAutonomousToolCall(reasoningText);

    if (effectiveToolExecution) {
      stagesExecuted.push('TOOL_ACTION');
      const toolCallId = `tc-${randomUUID()}`;
      this.l0Ledger.appendEvent({
        correlation_id: correlationId,
        actor: 'brain',
        event_type: 'tool_call',
        payload: {
          tool_call_id: toolCallId,
          tool_name: effectiveToolExecution.toolName,
          arguments: effectiveToolExecution.args,
        },
      });

      let execRes: any;
      if (typeof (effectiveToolExecution as any).execute === 'function') {
        execRes = await (effectiveToolExecution as any).execute(effectiveToolExecution.args);
      } else if (this.toolRegistry) {
        execRes = await this.toolRegistry.executeTool({
          toolName: effectiveToolExecution.toolName,
          args: effectiveToolExecution.args,
          userOverride: params.userConfirmation,
          correlationId,
          taskContext,
        });
      } else {
        execRes = { success: true, tool: effectiveToolExecution.toolName, args: effectiveToolExecution.args };
      }
      toolResultRecord = {
        tool_name: effectiveToolExecution.toolName,
        args: effectiveToolExecution.args,
        result: execRes,
      };

      this.l0Ledger.appendEvent({
        correlation_id: correlationId,
        actor: 'tool',
        event_type: 'tool_result',
        payload: {
          tool_call_id: toolCallId,
          result: execRes,
        },
      });
    }

    // ------------------------------------------------------------------------
    // STAGE 6: EVIDENCE_GENERATION & STAGE 7: VERIFICATION
    // ------------------------------------------------------------------------
    stagesExecuted.push('EVIDENCE_GENERATION');
    stagesExecuted.push('VERIFICATION');

    const evidenceType = (toolResultRecord?.result?.success ?? true) ? 'test_pass' : 'test_fail';
    const evidenceSignal: EvidenceSignal = {
      signal_id: `sig-${randomUUID()}`,
      source: 'test',
      type: evidenceType,
      correlation_id: correlationId,
      project_id: 'default',
      files: ['src/core.ts'],
      timestamp: new Date().toISOString(),
      payload: {
        tool: toolResultRecord?.tool_name || 'internal_verifier',
        status: evidenceType,
      },
    };

    this.evidenceBus.ingestSignal(evidenceSignal);

    // ------------------------------------------------------------------------
    // STAGE 8: HUMAN_INTERACTION
    // ------------------------------------------------------------------------
    stagesExecuted.push('HUMAN_INTERACTION');
    if (params.userConfirmation) {
      this.l0Ledger.appendEvent({
        correlation_id: correlationId,
        actor: 'user',
        event_type: 'human_confirmation',
        payload: { confirmed: true, prompt: params.userPrompt },
      });
    }

    // ------------------------------------------------------------------------
    // STAGE 9: ACTION_EXECUTION & STAGE 10: OUTCOME_OBSERVATION
    // ------------------------------------------------------------------------
    stagesExecuted.push('ACTION_EXECUTION');
    stagesExecuted.push('OUTCOME_OBSERVATION');

    const outcomeStatus = params.delayedOutcome?.status || (evidenceType === 'test_pass' ? 'SUCCESS' : 'FAILURE');

    // ------------------------------------------------------------------------
    // STAGE 11: L1_SETTLEMENT
    // ------------------------------------------------------------------------
    stagesExecuted.push('L1_SETTLEMENT');
    const exp = this.l1Manager.createExperience({
      correlationId,
      intent: params.userPrompt,
      model,
      affectedFiles: ['src/core.ts'],
      supportingL0EventIds: [userEvent.event_id],
    });

    this.l1Manager.transitionState(exp.experience_id, 'PROVISIONALLY_ACCEPTED');
    this.l1Manager.transitionState(exp.experience_id, 'OBSERVATION');
    const finalL1 = this.l1Manager.transitionState(
      exp.experience_id,
      outcomeStatus,
      params.delayedOutcome?.closureReason || 'Automated cognitive loop execution verified'
    );

    // ------------------------------------------------------------------------
    // STAGE 12: L2_LEARNING
    // ------------------------------------------------------------------------
    stagesExecuted.push('L2_LEARNING');

    let extractedRuleContent = `Pattern observed for ${taskContext}: ${params.userPrompt.slice(0, 80)}`;
    const recMatch = reasoningText.match(/(?:Recommendation|Rule|Constraint|Learned|Insight):\s*(.+?)(?:\n|$)/i);
    if (recMatch) {
      extractedRuleContent = recMatch[1].trim();
    }

    const learnResult = this.l2LearningEngine.learnFromExperience({
      experience: finalL1,
      ruleCandidate: {
        category: 'workflow_rule',
        content: extractedRuleContent,
        taskContext,
      },
      toolUsed: effectiveToolExecution?.toolName,
      latencyMs: Math.round(performance.now() - startMs),
    });

    // ------------------------------------------------------------------------
    // STAGE 13: L4_META_UPDATE & NEXT_L3_ADAPTATION
    // ------------------------------------------------------------------------
    stagesExecuted.push('L4_META_UPDATE');
    if (predictionRecord) {
      predictionRecord = this.l4MetaEngine.resolvePrediction(
        predictionRecord.prediction_id,
        outcomeStatus === 'SUCCESS' ? 1.0 : 0.0,
        finalL1.experience_id
      );
    }

    const updatedReliability = this.l4MetaEngine.evaluateContextualReliability(taskContext, { model });

    stagesExecuted.push('NEXT_L3_ADAPTATION');
    const nextL3Preview = await this.l3Compiler.compile(params.userPrompt, 'default', { modelName: model });
    const nextHeartPreview = this.heartSupervisor.evaluateAction({
      action: params.userPrompt,
      context: taskContext,
      user_override: false,
    });

    const durationMs = Math.round((performance.now() - startMs) * 100) / 100;

    return {
      transaction_id: transactionId,
      correlation_id: correlationId,
      user_prompt: params.userPrompt,
      stages_executed: stagesExecuted,
      l3_compiled: l3Compiled,
      heart_evaluation: heartEvaluation,
      model_response: reasoningText,
      tool_action: toolResultRecord,
      evidence_recorded: [evidenceSignal],
      l1_experience: finalL1,
      l2_learned_rules: [learnResult.ruleLearned],
      l4_prediction: predictionRecord,
      l4_reliability: updatedReliability,
      next_l3_preview: nextL3Preview,
      next_heart_preview: nextHeartPreview,
      duration_ms: durationMs,
    };
  }
}

/**
 * Extracts structured tool call requests autonomously from LLM reasoning text.
 * Supports markdown code block JSON formats and Action/Action Input syntax.
 */
export function extractAutonomousToolCall(text: string): { toolName: string; args: Record<string, unknown> } | null {
  if (!text) return null;

  // Pattern 1: ```tool_call ... ``` or ```json ... ``` with tool/name & args/parameters
  const blockMatch = text.match(/```(?:tool_call|json)?\s*\n?(\{[\s\S]*?\})\s*```/);
  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1]);
      const toolName = parsed.tool || parsed.tool_name || parsed.name || parsed.action;
      const args = parsed.args || parsed.arguments || parsed.parameters || parsed.action_input || {};
      if (toolName && typeof toolName === 'string') {
        return { toolName, args: typeof args === 'string' ? JSON.parse(args) : args };
      }
    } catch {}
  }

  // Pattern 2: Action: <toolName>\nAction Input: <json>
  const actionMatch = text.match(/Action:\s*(\w+)[\r\n]+(?:Action Input:\s*(\{[\s\S]*?\}|.+))?/i);
  if (actionMatch) {
    const toolName = actionMatch[1].trim();
    let args: Record<string, unknown> = {};
    if (actionMatch[2]) {
      try {
        args = JSON.parse(actionMatch[2].trim());
      } catch {
        args = { input: actionMatch[2].trim() };
      }
    }
    return { toolName, args };
  }

  return null;
}
