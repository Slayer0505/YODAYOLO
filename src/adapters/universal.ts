import { randomUUID } from 'crypto';
import type { L0EventLedger } from '../db/ledger';
import type { EvidenceBus } from '../evidence/bus';
import type { L1ExperienceManager } from '../l1/experience';
import type { L3ContextCompiler } from '../l3/compiler';
import type { HeartSupervisor } from '../heart/supervisor';
import { ConversationLearner } from '../session/conversation_learner';
import type {
  AdapterPromptOptions,
  AdapterPromptResult,
  ClientType,
  YodaAdapter,
} from './contract';
import type { EvidenceSignal, L0Event, L3CompiledContext } from '../types';

export interface UniversalAdapterOptions {
  name?: string;
  clientType?: ClientType;
  description?: string;
  ledger: L0EventLedger;
  evidenceBus: EvidenceBus;
  experienceManager: L1ExperienceManager;
  contextCompiler?: L3ContextCompiler;
  heartSupervisor?: HeartSupervisor;
}

export class UniversalYodaAdapter implements YodaAdapter {
  public readonly name: string;
  public readonly clientType: ClientType;
  public readonly description: string;
  protected connected: boolean = false;

  protected ledger: L0EventLedger;
  protected evidenceBus: EvidenceBus;
  protected experienceManager: L1ExperienceManager;
  protected contextCompiler?: L3ContextCompiler;
  protected heartSupervisor?: HeartSupervisor;
  protected activeCorrelations: Map<string, { experienceId?: string; projectId: string }> = new Map();

  constructor(options: UniversalAdapterOptions) {
    this.name = options.name || 'universal-client-adapter';
    this.clientType = options.clientType || 'universal';
    this.description = options.description || 'Universal plug-and-play adapter for any AI conversation/agent';
    this.ledger = options.ledger;
    this.evidenceBus = options.evidenceBus;
    this.experienceManager = options.experienceManager;
    this.contextCompiler = options.contextCompiler;
    this.heartSupervisor = options.heartSupervisor;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<boolean> {
    this.connected = true;
    return true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.activeCorrelations.clear();
  }

  public async sendContext(projectId: string = 'default', taskContext?: string): Promise<L3CompiledContext> {
    if (!this.contextCompiler) {
      return {
        state_markdown: '### YODA PERSISTENT CONTEXT\n- Universal cognitive layer active.',
        retrieved_rules: [],
        compilation_latency_ms: 0,
        timestamp: new Date().toISOString(),
      };
    }
    return this.contextCompiler.compile(taskContext || 'context_query', projectId);
  }

  public async capturePrompt(prompt: string, options: AdapterPromptOptions = {}): Promise<AdapterPromptResult> {
    const correlationId = options.correlationId || `corr-${this.clientType}-${randomUUID()}`;
    const projectId = options.projectId || 'default';
    const sessionId = options.sessionId || null;

    // 1. Log incoming request to L0 Event Ledger
    const l0Event = this.ledger.appendEvent({
      correlationId,
      sessionId,
      projectId,
      actor: 'client',
      eventType: 'incoming_request',
      payload: { prompt, options },
      metadata: {
        client_type: this.clientType,
        adapter_name: this.name,
        model: options.model,
      },
    });

    // 2. Open L1 Experience Record
    const exp = this.experienceManager.createExperience({
      correlationId,
      sessionId,
      projectId,
      intent: prompt,
      model: options.model || 'neutral-reasoner',
      supportingL0EventIds: [l0Event.event_id],
      affectedFiles: options.affectedFiles || [],
      metadata: options.metadata || {},
    });

    this.activeCorrelations.set(correlationId, { experienceId: exp.experience_id, projectId });

    // 2b. Real-time Conversational Learning & Signal Extraction
    const extractedSignals = ConversationLearner.extractSignalsFromMessages(
      [{ role: 'user', content: prompt }],
      projectId
    );
    if (extractedSignals.length > 0 && this.evidenceBus) {
      await ConversationLearner.processSignals(
        extractedSignals,
        this.evidenceBus,
        this.experienceManager,
        correlationId,
        projectId
      );
    }

    // 3. Compile Dynamic L3 Context
    let compiledContext: L3CompiledContext;
    if (this.contextCompiler) {
      compiledContext = await this.contextCompiler.compile(prompt, projectId, { modelName: options.model });
    } else {
      compiledContext = await this.sendContext(projectId, prompt);
    }

    // 4. Heart Supervisory Safety Evaluation
    if (this.heartSupervisor) {
      const evalResult = this.heartSupervisor.evaluateAction({
        actionText: prompt,
        taskContext: projectId,
        intent: prompt,
        affectedFiles: options.affectedFiles || [],
      });
      compiledContext.heart_directive = evalResult;
    }

    return {
      correlationId,
      compiledContext,
      injectedSystemPrompt: compiledContext.state_markdown,
      experienceId: exp.experience_id,
    };
  }

  public async captureResponse(
    correlationId: string,
    response: string,
    metadata: Record<string, unknown> = {}
  ): Promise<L0Event> {
    const active = this.activeCorrelations.get(correlationId);
    const projectId = active?.projectId || 'default';

    const respEvent = this.ledger.appendEvent({
      correlationId,
      projectId,
      actor: 'provider',
      eventType: 'provider_response',
      payload: { response },
      metadata: {
        ...metadata,
        client_type: this.clientType,
        adapter_name: this.name,
        experience_id: active?.experienceId,
      },
    });

    if (active?.experienceId) {
      this.experienceManager.addSupportingL0Event(active.experienceId, respEvent.event_id);
      this.experienceManager.markProvisionallyAccepted(active.experienceId);
      this.experienceManager.startObservation(active.experienceId);
    }

    return respEvent;
  }

  public async captureToolCall(
    correlationId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<L0Event> {
    const active = this.activeCorrelations.get(correlationId);
    const projectId = active?.projectId || 'default';

    return this.ledger.appendEvent({
      correlationId,
      projectId,
      actor: 'gateway',
      eventType: 'outgoing_provider_request',
      payload: { toolName, args },
      metadata: {
        client_type: this.clientType,
        tool_name: toolName,
        experience_id: active?.experienceId,
      },
    });
  }

  public async captureToolResult(
    correlationId: string,
    toolName: string,
    result: unknown,
    success: boolean
  ): Promise<EvidenceSignal | null> {
    const active = this.activeCorrelations.get(correlationId);
    const projectId = active?.projectId || 'default';

    const signal = await this.evidenceBus.emit({
      source: 'tool',
      type: success ? 'build_success' : 'build_fail',
      correlationId,
      projectId,
      files: [],
      payload: { toolName, result, success },
    });

    return signal;
  }

  public async captureUserCorrection(
    correlationId: string,
    correction: string,
    tags: string[] = ['user_correction']
  ): Promise<EvidenceSignal> {
    const active = this.activeCorrelations.get(correlationId);
    const projectId = active?.projectId || 'default';

    const signal = await this.evidenceBus.emit({
      source: 'user',
      type: 'user_correction',
      correlationId,
      projectId,
      files: [],
      payload: {
        correction,
        rule_candidate: {
          category: 'user_preference',
          taskContext: projectId,
          content: correction,
          tags,
        },
      },
    });

    return signal;
  }

  public async captureOutcome(
    correlationId: string,
    outcome: 'SUCCESS' | 'FAILURE',
    confidence: number = 0.9,
    reason: string = 'TASK_COMPLETED'
  ): Promise<void> {
    const active = this.activeCorrelations.get(correlationId);
    if (active?.experienceId) {
      this.experienceManager.settleOutcome(
        active.experienceId,
        outcome,
        confidence,
        outcome === 'SUCCESS' ? 'SUCCESS_SIGNAL' : 'FAILURE_SIGNAL'
      );
    }
    this.activeCorrelations.delete(correlationId);
  }

  public async health(): Promise<{ connected: boolean; status: string; eventCount: number; metadata?: Record<string, unknown> }> {
    return {
      connected: this.connected,
      status: this.connected ? 'active' : 'disconnected',
      eventCount: this.ledger.getEventCount(),
      metadata: {
        client_type: this.clientType,
        active_sessions: this.activeCorrelations.size,
      },
    };
  }
}
