export type L0EventType =
  | 'incoming_request'
  | 'outgoing_provider_request'
  | 'provider_response'
  | 'returned_response'
  | 'provider_error'
  | 'timeout'
  | 'system_error'
  | 'evidence_ingested';

export type L0Actor = 'client' | 'gateway' | 'provider' | 'system';

export interface L0Event {
  event_id: string;
  parent_event_id: string | null;
  correlation_id: string;
  session_id: string | null;
  project_id: string;
  actor: L0Actor;
  event_type: L0EventType;
  timestamp: string;
  timestamp_epoch_ms: number;
  schema_version: number;
  content_hash: string;
  payload: Record<string, unknown> | string;
  metadata?: Record<string, unknown> | null;
}

// ----------------------------------------------------------------------------
// PHASE 2: L1 EPISODIC EXPERIENCE TYPES
// ----------------------------------------------------------------------------

export type L1ExperienceStatus =
  | 'PROPOSED'
  | 'PROVISIONALLY_ACCEPTED'
  | 'OBSERVATION'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILURE'
  | 'UNKNOWN'
  | 'REOPENED_BY_EVIDENCE';

export type L1ClosureReason =
  | 'SUCCESS_SIGNAL'
  | 'FAILURE_SIGNAL'
  | 'USER_CLOSED'
  | 'TASK_SUPERSEDED'
  | 'TIMEOUT'
  | 'NO_FURTHER_ACTIVITY';

export interface L1Experience {
  experience_id: string;
  correlation_id: string;
  session_id: string | null;
  project_id: string;
  intent: string;
  model: string;
  status: L1ExperienceStatus;
  confidence: number;
  closure_reason: L1ClosureReason | null;
  observation_window_ms: number;
  opened_at: string;
  closed_at: string | null;
  reopened_at: string | null;
  reopen_count: number;
  affected_files: string[];
  supporting_l0_event_ids: string[];
  evidence_log: EvidenceSignal[];
  memory_tier?: MemoryTier;
  metadata?: Record<string, unknown> | null;
}

// ----------------------------------------------------------------------------
// PHASE 2: EVIDENCE BUS TYPES
// ----------------------------------------------------------------------------

export type EvidenceSource = 'test' | 'git' | 'compiler' | 'terminal' | 'user' | 'tool';

export type EvidenceType =
  | 'test_pass'
  | 'test_fail'
  | 'commit'
  | 'build_success'
  | 'build_fail'
  | 'user_accept'
  | 'user_reject'
  | 'user_correction'
  | 'tool_result';

export interface EvidenceSignal {
  signal_id: string;
  source: EvidenceSource;
  type: EvidenceType;
  correlation_id?: string;
  project_id: string;
  files: string[];
  payload: Record<string, unknown>;
  timestamp: string;
}

// ----------------------------------------------------------------------------
// PHASE 3: L2 LEARNED KNOWLEDGE & PROVENANCE TYPES
// ----------------------------------------------------------------------------

export type L2RuleCategory = 'user_preference' | 'project_constraint' | 'learned_rule' | 'project_fact';
export type L2RuleStatus = 'HYPOTHESIS' | 'CONFIRMED' | 'DEPRECATED';

export type TemporalRelation =
  | 'supersedes'
  | 'superseded_by'
  | 'caused_by'
  | 'refines'
  | 'depends_on'
  | 'contradicts';

export interface TemporalEdge {
  target_id: string;
  relation: TemporalRelation;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface L2KnowledgeItem {
  rule_id: string;
  category: L2RuleCategory;
  content: string;
  task_context: string;
  confidence: number;
  evidence_count: number;
  contradiction_count: number;
  status: L2RuleStatus;
  tags: string[];
  provenance: string[]; // Supporting experience IDs
  created_at: string;
  updated_at: string;
  memory_tier?: MemoryTier;
  vector?: number[];
  valid_from?: string;
  valid_until?: string | null;
  superseded_by?: string | null;
  temporal_edges?: TemporalEdge[];
}

export interface L2Strategy {
  strategy_id: string;
  name: string;
  task_class: string;
  conditions: string;
  steps: string[];
  success_count: number;
  failure_count: number;
  confidence: number;
  provenance: string[]; // Supporting experience IDs
}

export interface L2ModelExperience {
  record_id: string;
  model: string;
  task_class: string;
  context: string;
  strategy_used?: string;
  sample_count: number;
  success_count: number;
  failure_count: number;
  avg_latency_ms: number;
  confidence: number;
}

export interface L2ToolExperience {
  record_id: string;
  tool_name: string;
  task_context: string;
  usage_count: number;
  success_count: number;
  failure_count: number;
  usefulness_score: number;
}

export interface BeliefProvenanceExplanation {
  rule: L2KnowledgeItem;
  supporting_experiences: Array<{
    experience_id: string;
    intent: string;
    model: string;
    status: string;
    closure_reason: string | null;
    l0_events: Array<{
      event_id: string;
      event_type: string;
      content_hash: string;
      actor: string;
    }>;
  }>;
}

export interface CodebaseCortexExcerpt {
  filePath: string;
  symbolName: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'export' | 'variable';
  signature?: string;
  cruxCode?: string;
  dependencies?: string[];
  relevanceScore: number;
}

export interface CodebaseCortexContext {
  workingDirectory: string;
  fingerprint: string;
  indexedFilesCount: number;
  totalSymbolsCount: number;
  relevantExcerpts: CodebaseCortexExcerpt[];
  fileWiringSummary: string[];
}

export interface L3TokenBudgetInfo {
  allocated_tokens: number;
  estimated_used_tokens: number;
  was_truncated: boolean;
}

export interface L3CompiledContext {
  state_markdown: string;
  retrieved_rules: L2KnowledgeItem[];
  retrieved_strategies?: L2Strategy[];
  codebase_cortex?: CodebaseCortexContext;
  token_budget?: L3TokenBudgetInfo;
  model_experience_hint?: string;
  heart_directive?: HeartEvaluation;
  compilation_latency_ms: number;
  timestamp: string;
}

// ----------------------------------------------------------------------------
// CHAT COMPLETION & PROVIDER TYPES
// ----------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: unknown[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    tool_calls?: unknown[];
  };
  finish_reason: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tool_calls: boolean;
  model_switching: boolean;
}

export interface ReasoningProvider {
  name: string;
  providerType?: 'upstream' | 'ollama' | 'mock' | 'custom';
  defaultModel?: string;
  capabilities?: ProviderCapabilities;
  listModels(): Promise<ModelInfo[]>;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown>;
  healthCheck(): Promise<boolean>;
}

// ----------------------------------------------------------------------------
// L4 META-LEARNING TYPES (PHASE 4)
// ----------------------------------------------------------------------------

export type L4PredictionOutcome = 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS' | 'UNKNOWN';

export interface L4Prediction {
  prediction_id: string;
  experience_id?: string | null;
  correlation_id?: string | null;
  task_context: string;
  prediction_text: string;
  predicted_outcome: 'SUCCESS' | 'FAILURE';
  confidence: number; // 0.0 to 1.0
  rationale?: string | null;
  actual_outcome: 'SUCCESS' | 'FAILURE' | 'UNKNOWN' | null;
  brier_score: number | null; // (confidence - actual)^2
  is_calibrated: boolean | null;
  created_at: string;
  resolved_at: string | null;
  evidence_id?: string | null;
}

export interface L4CalibrationMetrics {
  total_predictions: number;
  resolved_predictions: number;
  mean_brier_score: number;
  average_confidence: number;
  accuracy: number;
  calibration_bias: number; // average_confidence - accuracy
  calibration_status: 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' | 'INSUFFICIENT_DATA';
  contextual_breakdown: Record<
    string,
    {
      brier_score: number;
      accuracy: number;
      sample_count: number;
    }
  >;
}

export interface L4ContextualReliability {
  task_context: string;
  composite_reliability: number; // 0.0 to 1.0
  task_reliability: number;
  model_reliability: number;
  strategy_reliability: number;
  belief_reliability: number;
  brier_penalty: number;
  requires_human_verification: boolean;
  reasoning: string[];
}

export interface L4RetrievalFeedback {
  feedback_id: string;
  experience_id: string;
  rule_id: string;
  was_useful: boolean;
  created_at: string;
}

export interface L4SelfModel {
  synthesized_at: string;
  known_domains: string[];
  unknown_domains: string[];
  confirmed_beliefs_count: number;
  weak_beliefs: Array<{
    rule_id: string;
    content: string;
    confidence: number;
    task_context: string;
  }>;
  conflicting_beliefs: Array<{
    rule_id: string;
    content: string;
    contradiction_count: number;
    task_context: string;
  }>;
  failed_predictions_count: number;
  successful_strategies: string[];
  failed_strategies: string[];
  unreliable_tools: Array<{
    tool_name: string;
    usefulness_score: number;
    task_context: string;
  }>;
  calibration: L4CalibrationMetrics;
  situations_requiring_human_input: string[];
}

// ----------------------------------------------------------------------------
// HEART SUPERVISORY TYPES (PHASE 5)
// ----------------------------------------------------------------------------

export type HeartRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type HeartConsequence = 'REVERSIBLE' | 'EXPENSIVE' | 'IRREVERSIBLE';
export type HeartModality = 'CAUTION' | 'CURIOSITY' | 'PUSHBACK' | 'TRUST' | 'UNCERTAINTY';
export type HeartVerificationIntensity = 'STANDARD' | 'ELEVATED' | 'MANDATORY_HUMAN_CONFIRMATION';

export interface HeartBiosRule {
  rule_id: string;
  category: 'filesystem' | 'database' | 'credentials' | 'git' | 'production';
  description: string;
  mandatory_risk: HeartRiskLevel;
  mandatory_consequence: HeartConsequence;
  mandatory_intensity: HeartVerificationIntensity;
}

export interface HeartEvaluation {
  evaluation_id: string;
  task_context: string;
  action_summary: string;
  risk_level: HeartRiskLevel;
  consequence: HeartConsequence;
  active_modalities: HeartModality[];
  verification_intensity: HeartVerificationIntensity;
  bios_rule_triggered?: string | null;
  pushback_reasons: string[];
  warnings: string[];
  curiosity_inquiries: string[];
  requires_human_confirmation: boolean;
  user_override_granted: boolean;
  rationale: string;
  evaluated_at: string;
}

// ----------------------------------------------------------------------------
// PHASE 6: FULL COGNITIVE LOOP, CONSOLIDATION & MEMORY LIFECYCLE TYPES
// ----------------------------------------------------------------------------

export type MemoryTier = 'HOT' | 'WARM' | 'COLD' | 'ARCHIVE';

export interface MemoryTierDistribution {
  hot_count: number;
  warm_count: number;
  cold_count: number;
  archive_count: number;
  total_records: number;
}

export interface ConsolidationReport {
  timestamp: string;
  experiences_scanned: number;
  clusters_detected: number;
  hypotheses_promoted: string[];
  rules_decayed: string[];
  rules_deprecated: string[];
  strategies_synthesized: string[];
  predictions_settled: number;
  tier_distribution: MemoryTierDistribution;
  duration_ms: number;
}

export type CognitiveLoopStage =
  | 'USER_REQUEST'
  | 'L3_COMPILATION'
  | 'HEART_SUPERVISION'
  | 'MODEL_REASONING'
  | 'TOOL_ACTION'
  | 'EVIDENCE_GENERATION'
  | 'VERIFICATION'
  | 'HUMAN_INTERACTION'
  | 'ACTION_EXECUTION'
  | 'OUTCOME_OBSERVATION'
  | 'L1_SETTLEMENT'
  | 'L2_LEARNING'
  | 'L4_META_UPDATE'
  | 'NEXT_L3_ADAPTATION';

export interface CognitiveLoopExecutionResult {
  transaction_id: string;
  correlation_id: string;
  user_prompt: string;
  stages_executed: CognitiveLoopStage[];
  l3_compiled: L3CompiledContext;
  heart_evaluation: HeartEvaluation;
  model_response: string;
  tool_action?: {
    tool_name: string;
    args: Record<string, unknown>;
    result: unknown;
  };
  evidence_recorded: any[];
  l1_experience: L1Experience;
  l2_learned_rules: L2KnowledgeItem[];
  l4_prediction?: L4Prediction;
  l4_reliability: L4ContextualReliability;
  next_l3_preview?: L3CompiledContext;
  next_heart_preview?: HeartEvaluation;
  duration_ms: number;
}

// ----------------------------------------------------------------------------
// TOOL SYSTEM & ADAPTER TYPES
// ----------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'filesystem' | 'git' | 'terminal' | 'system';
  parameters: Record<string, unknown>;
}

export interface ToolExecutionParams {
  toolName: string;
  args: Record<string, unknown>;
  userOverride?: boolean;
  correlationId?: string;
  taskContext?: string;
}

export interface ToolExecutionOutput {
  success: boolean;
  toolName: string;
  output?: unknown;
  error?: string;
  heartEvaluation?: HeartEvaluation;
  evidenceSignalId?: string;
  latencyMs: number;
}

// ----------------------------------------------------------------------------
// DREAM SCHEDULER TYPES
// ----------------------------------------------------------------------------

export interface DreamSchedulerConfig {
  intervalMs?: number;
  idleThresholdMs?: number;
  autoStart?: boolean;
  coldOlderThanDays?: number;
  archiveOlderThanDays?: number;
  settledThreshold?: number;
}

export interface DreamSchedulerStatus {
  active: boolean;
  intervalMs: number;
  idleThresholdMs: number;
  lastRunTimestamp: string | null;
  totalRuns: number;
  isIdle: boolean;
  nextRunEstimatedMs?: number;
  lastError?: string | null;
  settledEventCount?: number;
}
