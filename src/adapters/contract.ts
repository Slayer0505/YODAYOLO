import type { L3CompiledContext, EvidenceSignal, L0Event } from '../types';

export type ClientType =
  | 'antigravity'
  | 'opencode'
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'hermes'
  | 'universal'
  | 'custom';

export interface AdapterPromptOptions {
  correlationId?: string;
  sessionId?: string;
  projectId?: string;
  model?: string;
  affectedFiles?: string[];
  metadata?: Record<string, unknown>;
}

export interface AdapterPromptResult {
  correlationId: string;
  compiledContext: L3CompiledContext;
  injectedSystemPrompt: string;
  experienceId?: string;
}

export interface YodaAdapter {
  readonly name: string;
  readonly clientType: ClientType;
  readonly description: string;
  isConnected(): boolean;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;

  /**
   * Retrieves compiled L3 cognitive context before sending to the model/agent.
   */
  sendContext(projectId: string, taskContext?: string): Promise<L3CompiledContext>;

  /**
   * Captures an incoming prompt, creates L0/L1 state, and injects L3 context.
   */
  capturePrompt(prompt: string, options?: AdapterPromptOptions): Promise<AdapterPromptResult>;

  /**
   * Captures the model's response after reasoning.
   */
  captureResponse(correlationId: string, response: string, metadata?: Record<string, unknown>): Promise<L0Event>;

  /**
   * Captures a tool call made during the interaction.
   */
  captureToolCall(correlationId: string, toolName: string, args: Record<string, unknown>): Promise<L0Event>;

  /**
   * Captures the execution result of a tool call.
   */
  captureToolResult(correlationId: string, toolName: string, result: unknown, success: boolean): Promise<EvidenceSignal | null>;

  /**
   * Captures explicit user feedback or correction.
   */
  captureUserCorrection(correlationId: string, correction: string, tags?: string[]): Promise<EvidenceSignal>;

  /**
   * Settles the outcome of the interaction (SUCCESS / FAILURE / etc).
   */
  captureOutcome(correlationId: string, outcome: 'SUCCESS' | 'FAILURE', confidence?: number, reason?: string): Promise<void>;

  /**
   * Returns current health and event statistics of this adapter.
   */
  health(): Promise<{ connected: boolean; status: string; eventCount: number; metadata?: Record<string, unknown> }>;
}
