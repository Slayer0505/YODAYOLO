import { randomUUID } from 'crypto';
import type { L0EventLedger } from '../db/ledger';
import type { EvidenceBus } from '../evidence/bus';
import type { L1ExperienceManager } from '../l1/experience';
import type { L3ContextCompiler } from '../l3/compiler';
import { injectL3IntoRequest } from '../l3/envelope';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ReasoningProvider,
} from '../types';
import type { L2KnowledgeStore } from '../l2/store';
import type { ProvenanceService } from '../l2/provenance';
import type { L2LearningEngine } from '../l2/learning_engine';
import type { L4Store } from '../l4/store';
import type { L4MetaEngine } from '../l4/meta_engine';
import type { HeartSupervisor } from '../heart/supervisor';
import type { HeartEvaluation } from '../types';
import type { DreamingConsolidator } from '../consolidation/dreaming';
import type { CognitiveLoopOrchestrator } from '../orchestrator/cognitive_loop';
import { MockReasoningProvider } from '../providers/mock';
import { UpstreamHttpProvider } from '../providers/upstream';
import { OllamaReasoningProvider } from '../providers/ollama';
import { formatSseChunk, formatSseDone, reconstructResponseFromChunks } from './streaming';
import type { CodebaseCortex } from '../cortex/codebase_cortex';
import type { ToolRegistry } from '../tools/registry';
import type { DreamScheduler } from '../consolidation/scheduler';
import type { BeadsLiteManager } from '../beads/beads';
import type { SessionManager } from '../session/manager';
import type { SessionReplayEngine } from '../session/replay';
import { renderYodaGuiHtml } from '../gui/app';
import type { CausalityEngine } from '../causality/engine';

export interface GatewayContext {
  ledger: L0EventLedger;
  provider: ReasoningProvider;
  defaultModel?: string;
  experienceManager?: L1ExperienceManager;
  evidenceBus?: EvidenceBus;
  contextCompiler?: L3ContextCompiler;
  l2Store?: L2KnowledgeStore;
  provenanceService?: ProvenanceService;
  learningEngine?: L2LearningEngine;
  l4Store?: L4Store;
  metaEngine?: L4MetaEngine;
  heartSupervisor?: HeartSupervisor;
  consolidator?: DreamingConsolidator;
  cognitiveLoop?: CognitiveLoopOrchestrator;
  cortex?: CodebaseCortex;
  toolRegistry?: ToolRegistry;
  dreamScheduler?: DreamScheduler;
  beadsManager?: BeadsLiteManager;
  sessionManager?: SessionManager;
  replayEngine?: SessionReplayEngine;
  causalityEngine?: CausalityEngine;
  onSwitchProvider?: (provider: ReasoningProvider) => void;
}

export async function handleRequest(
  req: Request,
  ctx: GatewayContext
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  // YODA Web GUI Interface
  if ((path === '/ui' || path.startsWith('/ui/') || (path === '/' && req.headers.get('accept')?.includes('text/html'))) && method === 'GET') {
    return new Response(renderYodaGuiHtml(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Health and Status check
  if ((path === '/' || path === '/health' || path === '/v1/health') && method === 'GET') {
    const isProviderHealthy = await ctx.provider.healthCheck().catch(() => false);
    return Response.json({
      status: 'ok',
      system: 'YODA',
      service: 'YODA Gateway (OpenCode Compatible)',
      version: '0.6.0',
      phase: 6,
      heart_active: Boolean(ctx.heartSupervisor),
      consolidation_active: Boolean(ctx.consolidator),
      cognitive_loop_active: Boolean(ctx.cognitiveLoop),
      session_active: Boolean(ctx.sessionManager?.getActiveSession()),
      provider: ctx.provider.name,
      provider_type: ctx.provider.providerType || 'unknown',
      default_model: ctx.defaultModel || ctx.provider.defaultModel || 'neutral-reasoner',
      provider_healthy: isProviderHealthy,
      l0_events_count: ctx.ledger.getEventCount(),
      l1_experiences_count: ctx.experienceManager?.getAllExperiences().length ?? 0,
      l2_rules_count: ctx.l2Store?.getAllRules().length ?? 0,
      l4_predictions_count: ctx.l4Store?.getAllPredictions().length ?? 0,
    });
  }

  // Models catalog endpoint (OpenCode & OpenAI compatibility)
  if ((path === '/v1/models' || path === '/models') && method === 'GET') {
    try {
      const providerModels = await ctx.provider.listModels();
      const modelSet = new Set(providerModels.map((m) => m.id));

      const standardAliases = [
        'brain-default',
        'neutral-reasoner',
        'gpt-4o',
        'claude-3-5-sonnet',
        'gemini-1.5-pro',
        'deepseek-chat',
        'qwen2.5:3b',
      ];

      const mergedList = [...providerModels];
      for (const alias of standardAliases) {
        if (!modelSet.has(alias)) {
          mergedList.push({
            id: alias,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'yoda',
          });
        }
      }

      return Response.json({
        object: 'list',
        data: mergedList,
      });
    } catch (err: any) {
      return Response.json(
        { error: { message: err.message || 'Failed to list models', type: 'provider_error' } },
        { status: 500 }
      );
    }
  }

  // L0 Ledger Inspection Endpoints
  if (path === '/api/l0/events' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const events = ctx.ledger.getAllEvents(limit, offset);
    return Response.json({ count: ctx.ledger.getEventCount(), events });
  }

  if (path.startsWith('/api/l0/events/') && method === 'GET') {
    const correlationId = path.replace('/api/l0/events/', '');
    const events = ctx.ledger.getEventsByCorrelationId(correlationId);
    return Response.json({ correlation_id: correlationId, count: events.length, events });
  }

  // Phase 2: L1 Experiences Inspection Endpoints
  if (path === '/api/l1/experiences' && method === 'GET') {
    const experiences = ctx.experienceManager?.getAllExperiences() ?? [];
    return Response.json({ count: experiences.length, experiences });
  }

  if (path.startsWith('/api/l1/experiences/') && method === 'GET') {
    const expId = path.replace('/api/l1/experiences/', '');
    const exp = ctx.experienceManager?.getExperience(expId);
    if (!exp) {
      return Response.json({ error: 'Experience not found' }, { status: 404 });
    }
    return Response.json(exp);
  }

  // Phase 2: Evidence Ingestion Endpoint (POST /api/evidence)
  if (path === '/api/evidence' && method === 'POST') {
    if (!ctx.evidenceBus) {
      return Response.json({ error: 'Evidence Bus not configured' }, { status: 500 });
    }
    try {
      const evidenceBody = (await req.json()) as any;
      const signal = await ctx.evidenceBus.emit({
        source: evidenceBody.source || 'tool',
        type: evidenceBody.type || 'tool_result',
        correlationId: evidenceBody.correlation_id,
        projectId: evidenceBody.project_id || 'default',
        files: evidenceBody.files || [],
        payload: evidenceBody.payload || {},
      });
      return Response.json({ status: 'ingested', signal });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  // Phase 3: L2 Knowledge, Provenance, Strategies, and Model Experience Endpoints
  if (path === '/api/l2/rules' && method === 'GET') {
    const status = url.searchParams.get('status') as any;
    const category = url.searchParams.get('category') || undefined;
    const taskContext = url.searchParams.get('context') || undefined;
    const rules = ctx.l2Store?.getAllRules({ status, category, taskContext }) || [];
    return Response.json({ count: rules.length, rules });
  }

  if (path.startsWith('/api/l2/rules/') && path.endsWith('/provenance') && method === 'GET') {
    const ruleId = path.replace('/api/l2/rules/', '').replace('/provenance', '');
    const explanation = ctx.provenanceService?.explainProvenance(ruleId);
    if (!explanation) {
      return Response.json({ error: `Rule ${ruleId} not found or has no provenance` }, { status: 404 });
    }
    return Response.json(explanation);
  }

  if (path.startsWith('/api/l2/rules/') && path.endsWith('/graph') && method === 'GET') {
    const ruleId = path.replace('/api/l2/rules/', '').replace('/graph', '');
    const graph = ctx.l2Store?.getRuleGraph(ruleId);
    if (!graph) {
      return Response.json({ error: `Rule ${ruleId} not found` }, { status: 404 });
    }
    return Response.json(graph);
  }

  if (path.startsWith('/api/l2/rules/') && method === 'GET') {
    const ruleId = path.replace('/api/l2/rules/', '');
    const rule = ctx.l2Store?.getRule(ruleId);
    if (!rule) {
      return Response.json({ error: `Rule ${ruleId} not found` }, { status: 404 });
    }
    return Response.json(rule);
  }

  if (path === '/api/l2/strategies' && method === 'GET') {
    const taskClass = url.searchParams.get('task_class');
    const strats = taskClass
      ? ctx.l2Store?.getStrategiesByTaskClass(taskClass) || []
      : ctx.l2Store?.getAllStrategies() || [];
    return Response.json({ count: strats.length, strategies: strats });
  }

  if (path === '/api/l2/models' && method === 'GET') {
    const modelExperiences = ctx.l2Store?.getAllModelExperiences() || [];
    return Response.json({ count: modelExperiences.length, models: modelExperiences });
  }

  if (path === '/api/l2/learn' && method === 'POST') {
    if (!ctx.learningEngine || !ctx.experienceManager) {
      return Response.json({ error: 'Learning Engine not configured' }, { status: 500 });
    }
    try {
      const body = (await req.json()) as any;
      const exp = ctx.experienceManager.getExperience(body.experience_id);
      if (!exp) {
        return Response.json({ error: `Experience ${body.experience_id} not found` }, { status: 404 });
      }
      const results = ctx.learningEngine.learnFromExperience({
        experience: exp,
        ruleCandidate: body.rule_candidate,
        strategyCandidate: body.strategy_candidate,
        toolUsed: body.tool_used,
        latencyMs: body.latency_ms,
      });
      return Response.json({ status: 'learned', results });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path === '/api/l2/reembed' && method === 'POST') {
    if (!ctx.l2Store) {
      return Response.json({ error: 'L2 Knowledge Store not configured' }, { status: 500 });
    }
    try {
      const res = await ctx.l2Store.reembedAll();
      return Response.json({
        status: 'ok',
        message: 'All L2 rules re-embedded successfully',
        rules_updated: res.rulesUpdated,
        vector_dimension: res.dimension,
      });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }


  // Phase 4: L4 Meta-Learning Endpoints
  if (path === '/api/l4/predictions' && method === 'POST') {
    if (!ctx.metaEngine) {
      return Response.json({ error: 'L4 Meta-Learning Engine not configured' }, { status: 500 });
    }
    try {
      const body = (await req.json()) as any;
      const prediction = ctx.metaEngine.recordPrediction({
        taskContext: body.task_context,
        predictionText: body.prediction_text,
        predictedOutcome: body.predicted_outcome,
        confidence: body.confidence,
        experienceId: body.experience_id,
        correlationId: body.correlation_id,
        rationale: body.rationale,
      });
      return Response.json({ status: 'recorded', prediction });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path.startsWith('/api/l4/predictions/') && path.endsWith('/outcome') && method === 'POST') {
    if (!ctx.metaEngine) {
      return Response.json({ error: 'L4 Meta-Learning Engine not configured' }, { status: 500 });
    }
    const predId = path.replace('/api/l4/predictions/', '').replace('/outcome', '');
    try {
      const body = (await req.json()) as any;
      const prediction = ctx.metaEngine.resolveOutcome({
        predictionId: predId,
        actualOutcome: body.actual_outcome,
        evidenceId: body.evidence_id,
      });
      return Response.json({ status: 'resolved', prediction });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path === '/api/l4/predictions' && method === 'GET') {
    const taskContext = url.searchParams.get('context') || undefined;
    const resolvedOnly = url.searchParams.get('resolved') === 'true';
    const preds = ctx.l4Store?.getAllPredictions({ taskContext, resolvedOnly }) || [];
    return Response.json({ count: preds.length, predictions: preds });
  }

  if (path === '/api/l4/calibration' && method === 'GET') {
    if (!ctx.metaEngine) {
      return Response.json({ error: 'L4 Meta-Learning Engine not configured' }, { status: 500 });
    }
    const taskContext = url.searchParams.get('context') || undefined;
    const cal = ctx.metaEngine.calculateCalibration({ taskContext });
    return Response.json(cal);
  }

  if (path === '/api/l4/reliability' && method === 'GET') {
    if (!ctx.metaEngine) {
      return Response.json({ error: 'L4 Meta-Learning Engine not configured' }, { status: 500 });
    }
    const taskContext = url.searchParams.get('context') || 'general';
    const model = url.searchParams.get('model') || undefined;
    const tool = url.searchParams.get('tool') || undefined;
    const strategyId = url.searchParams.get('strategy_id') || undefined;
    const rel = ctx.metaEngine.evaluateContextualReliability(taskContext, { model, tool, strategyId });
    return Response.json(rel);
  }

  if (path === '/api/l4/self-model' && method === 'GET') {
    if (!ctx.metaEngine) {
      return Response.json({ error: 'L4 Meta-Learning Engine not configured' }, { status: 500 });
    }
    const selfModel = ctx.metaEngine.synthesizeSelfModel();
    return Response.json(selfModel);
  }

  if (path === '/api/l4/feedback' && method === 'POST') {
    if (!ctx.metaEngine) {
      return Response.json({ error: 'L4 Meta-Learning Engine not configured' }, { status: 500 });
    }
    try {
      const body = (await req.json()) as any;
      const fb = ctx.metaEngine.recordRetrievalFeedback({
        experienceId: body.experience_id,
        ruleId: body.rule_id,
        wasUseful: Boolean(body.was_useful),
      });
      return Response.json({ status: 'recorded', feedback: fb });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }


  // Phase 5: Heart Supervisory Endpoints
  if (path === '/api/heart/evaluate' && method === 'POST') {
    if (!ctx.heartSupervisor) {
      return Response.json({ error: 'Heart Supervisor not configured' }, { status: 500 });
    }
    try {
      const body = (await req.json()) as any;
      const evaluation = ctx.heartSupervisor.evaluateAction({
        actionText: body.action_text || '',
        taskContext: body.task_context,
        userOverride: Boolean(body.user_override),
      });
      return Response.json(evaluation);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path === '/api/heart/bios' && method === 'GET') {
    if (!ctx.heartSupervisor) {
      return Response.json({ error: 'Heart Supervisor not configured' }, { status: 500 });
    }
    const rules = ctx.heartSupervisor.getBios().getRules();
    return Response.json({ count: rules.length, rules });
  }

  // Phase 6: Consolidation / Dreaming endpoints
  if (path === '/api/consolidation/dream' && method === 'POST') {
    if (!ctx.consolidator) {
      return Response.json({ error: 'Dreaming Consolidator not configured' }, { status: 500 });
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const report = await ctx.consolidator.consolidate(body);
    return Response.json(report);
  }

  if (path === '/api/consolidation/status' && method === 'GET') {
    const experiences = ctx.experienceManager?.getAllExperiences() || [];
    const rules = ctx.l2Store?.getAllRules() || [];
    let hotCount = 0;
    let warmCount = 0;
    let coldCount = 0;
    let archiveCount = 0;
    for (const exp of experiences) {
      if (exp.memory_tier === 'ARCHIVE') archiveCount++;
      else if (exp.memory_tier === 'COLD') coldCount++;
      else if (exp.memory_tier === 'WARM') warmCount++;
      else hotCount++;
    }
    for (const rule of rules) {
      if (rule.memory_tier === 'ARCHIVE') archiveCount++;
      else if (rule.memory_tier === 'COLD') coldCount++;
      else if (rule.memory_tier === 'WARM') warmCount++;
      else hotCount++;
    }
    return Response.json({
      status: 'ok',
      tier_distribution: {
        hot_count: hotCount,
        warm_count: warmCount,
        cold_count: coldCount,
        archive_count: archiveCount,
        total_records: experiences.length + rules.length,
      },
    });
  }

  // Provider Status endpoint
  if ((path === '/api/provider/status' || path === '/v1/provider/status') && method === 'GET') {
    return Response.json({
      provider_name: ctx.provider.name,
      provider_type: ctx.provider.providerType || 'unknown',
      default_model: ctx.defaultModel || ctx.provider.defaultModel || 'neutral-reasoner',
      capabilities: ctx.provider.capabilities || { streaming: true, tool_calls: true, model_switching: true },
      healthy: await ctx.provider.healthCheck().catch(() => false),
    });
  }

  // Phase 6: Model Swappability endpoint
  if (path === '/api/provider/switch' && method === 'POST') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const providerName = body.provider_name || body.providerName || 'swapped-reasoner';
    const providerType = body.provider_type || body.providerType || 'mock';
    const defaultModel = body.default_model || body.defaultModel || body.model || 'neutral-reasoner';
    const models = body.models || [defaultModel];

    let newProvider: ReasoningProvider;
    if (providerType === 'upstream') {
      newProvider = new UpstreamHttpProvider({
        name: providerName,
        baseUrl: body.base_url || 'http://127.0.0.1:8000',
        apiKey: body.api_key,
        defaultModel,
      });
    } else if (providerType === 'ollama') {
      newProvider = new OllamaReasoningProvider(
        body.base_url || 'http://127.0.0.1:11434',
        defaultModel
      );
    } else {
      newProvider = new MockReasoningProvider({
        name: providerName,
        models,
        defaultModel,
      });
    }

    if (ctx.onSwitchProvider) {
      ctx.onSwitchProvider(newProvider);
    }
    return Response.json({
      status: 'ok',
      message: 'Provider swapped successfully',
      active_provider: newProvider.name,
      provider_name: newProvider.name,
      provider_type: newProvider.providerType,
      default_model: newProvider.defaultModel,
      models: await newProvider.listModels(),
    });
  }

  // Phase 6: Full Cognitive Loop execution endpoint
  if (path === '/api/cognitive-loop/run' && method === 'POST') {
    if (!ctx.cognitiveLoop) {
      return Response.json({ error: 'Cognitive Loop Orchestrator not configured' }, { status: 500 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    try {
      const userPrompt = body.prompt ?? body.userPrompt ?? '';
      const taskContext = body.task_context ?? body.taskContext ?? 'general';
      const userConfirmation = body.user_confirmation ?? body.userConfirmation;
      const predictionWager = body.prediction_wager ?? body.predictionWager;
      const delayedOutcome = body.delayed_outcome ?? body.delayedOutcome;
      const toolExecution = body.tool_execution ?? body.toolExecution;

      const result = await ctx.cognitiveLoop.runFullLoop({
        userPrompt,
        model: body.model,
        taskContext,
        userConfirmation,
        predictionWager,
        delayedOutcome,
        toolExecution,
      });
      return Response.json(result);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  // Tools endpoints
  if (path === '/api/tools' && method === 'GET') {
    if (!ctx.toolRegistry) {
      return Response.json({ error: 'Tool Registry not configured' }, { status: 500 });
    }
    return Response.json({
      tools: ctx.toolRegistry.listTools(),
    });
  }

  if (path === '/api/tools/execute' && method === 'POST') {
    if (!ctx.toolRegistry) {
      return Response.json({ error: 'Tool Registry not configured' }, { status: 500 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const toolName = body.tool_name || body.toolName;
    const args = body.args || {};
    const userOverride = body.user_override ?? body.userOverride ?? false;
    const correlationId = body.correlation_id || body.correlationId;
    const taskContext = body.task_context || body.taskContext || 'api_tool';

    try {
      const execResult = await ctx.toolRegistry.executeTool({
        toolName,
        args,
        userOverride,
        correlationId,
        taskContext,
      });
      return Response.json(execResult);
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  // Codebase Cortex endpoints (ADR-020 Dual-Cortex)
  if (path === '/api/cortex/query' && (method === 'GET' || method === 'POST')) {
    if (!ctx.cortex) {
      return Response.json({ error: 'Codebase Cortex not configured' }, { status: 500 });
    }
    let query = url.searchParams.get('q') || url.searchParams.get('query') || '';
    if (method === 'POST') {
      try {
        const body = (await req.json()) as any;
        query = body.query || body.prompt || query;
      } catch {}
    }
    const result = ctx.cortex.queryCortex(query);
    return Response.json(result);
  }

  if (path === '/api/cortex/refresh' && method === 'POST') {
    if (!ctx.cortex) {
      return Response.json({ error: 'Codebase Cortex not configured' }, { status: 500 });
    }
    ctx.cortex.refreshIfStale();
    const fp = ctx.cortex.computeFingerprint();
    return Response.json({
      status: 'ok',
      fingerprint: fp.fingerprint,
      files_count: fp.filePaths.length,
    });
  }

  // Dream Scheduler endpoints
  if (path === '/api/consolidation/schedule/status' && method === 'GET') {
    if (!ctx.dreamScheduler) {
      return Response.json({ active: false, message: 'Dream Scheduler not configured' });
    }
    return Response.json(ctx.dreamScheduler.getStatus());
  }

  if (path === '/api/consolidation/schedule/start' && method === 'POST') {
    if (!ctx.dreamScheduler) {
      return Response.json({ error: 'Dream Scheduler not configured' }, { status: 500 });
    }
    ctx.dreamScheduler.start();
    return Response.json({ status: 'ok', scheduler: ctx.dreamScheduler.getStatus() });
  }

  if (path === '/api/consolidation/schedule/stop' && method === 'POST') {
    if (!ctx.dreamScheduler) {
      return Response.json({ error: 'Dream Scheduler not configured' }, { status: 500 });
    }
    ctx.dreamScheduler.stop();
    return Response.json({ status: 'ok', scheduler: ctx.dreamScheduler.getStatus() });
  }

  if (path === '/api/consolidation/schedule/trigger' && method === 'POST') {
    if (!ctx.dreamScheduler) {
      return Response.json({ error: 'Dream Scheduler not configured' }, { status: 500 });
    }
    try {
      const report = await ctx.dreamScheduler.triggerNow();
      return Response.json({ status: 'ok', report });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 409 });
    }
  }

  // Phase 4: Beads-Lite Cross-Agent Task Continuity Endpoints
  if (path === '/api/beads' && method === 'GET') {
    if (!ctx.beadsManager) {
      return Response.json({ count: 0, beads: [] });
    }
    const projectId = url.searchParams.get('project_id') || 'default';
    const agent = url.searchParams.get('agent') || undefined;
    const beads = ctx.beadsManager.getActiveBeads(projectId, agent);
    return Response.json({ count: beads.length, beads });
  }

  if (path === '/api/beads' && method === 'POST') {
    if (!ctx.beadsManager) {
      return Response.json({ error: 'Beads-Lite Manager not configured' }, { status: 500 });
    }
    try {
      const body = (await req.json()) as any;
      const bead = ctx.beadsManager.createBead({
        beadId: body.bead_id,
        title: body.title,
        description: body.description,
        assigneeAgent: body.assignee_agent,
        projectId: body.project_id,
        parentBeadId: body.parent_bead_id,
        correlationId: body.correlation_id,
        tags: body.tags,
      });
      return Response.json({ status: 'created', bead }, { status: 201 });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path.startsWith('/api/beads/') && path.endsWith('/status') && (method === 'PATCH' || method === 'POST')) {
    if (!ctx.beadsManager) {
      return Response.json({ error: 'Beads-Lite Manager not configured' }, { status: 500 });
    }
    const beadId = path.replace('/api/beads/', '').replace('/status', '');
    try {
      const body = (await req.json()) as any;
      const bead = ctx.beadsManager.updateBeadStatus(beadId, body.status, body.agent_id, body.comment);
      if (!bead) {
        return Response.json({ error: `Bead ${beadId} not found` }, { status: 404 });
      }
      return Response.json({ status: 'updated', bead });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path.startsWith('/api/beads/') && path.endsWith('/link-experience') && method === 'POST') {
    if (!ctx.beadsManager) {
      return Response.json({ error: 'Beads-Lite Manager not configured' }, { status: 500 });
    }
    const beadId = path.replace('/api/beads/', '').replace('/link-experience', '');
    try {
      const body = (await req.json()) as any;
      const bead = ctx.beadsManager.linkExperience(beadId, body.experience_id);
      if (!bead) {
        return Response.json({ error: `Bead ${beadId} not found` }, { status: 404 });
      }
      return Response.json({ status: 'linked', bead });
    } catch (err: any) {
      return Response.json({ error: err.message }, { status: 400 });
    }
  }

  if (path.startsWith('/api/beads/') && method === 'GET') {
    if (!ctx.beadsManager) {
      return Response.json({ error: 'Beads-Lite Manager not configured' }, { status: 500 });
    }
    const beadId = path.replace('/api/beads/', '');
    const bead = ctx.beadsManager.getBead(beadId);
    if (!bead) {
      return Response.json({ error: `Bead ${beadId} not found` }, { status: 404 });
    }
    return Response.json(bead);
  }

  // YODA Live Session Capture Endpoints
  if (path === '/api/session/active' && method === 'GET') {
    if (!ctx.sessionManager) {
      return Response.json({ active: false, session: null });
    }
    const session = ctx.sessionManager.getActiveSession();
    return Response.json({
      active: Boolean(session),
      observing: ctx.sessionManager.isObserving(),
      active_sources: ctx.sessionManager.getActiveSources(),
      session,
    });
  }

  if (path === '/api/session/start' && method === 'POST') {
    if (!ctx.sessionManager) {
      return Response.json({ error: 'Session Manager not configured' }, { status: 500 });
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const session = ctx.sessionManager.startSession(body);
    return Response.json({ status: 'started', session });
  }

  if (path === '/api/session/event' && method === 'POST') {
    if (!ctx.sessionManager) {
      return Response.json({ error: 'Session Manager not configured' }, { status: 500 });
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const event = ctx.sessionManager.recordEvent(body);
    return Response.json({ status: event ? 'recorded' : 'ignored', event });
  }

  if (path === '/api/session/pause' && method === 'POST') {
    if (!ctx.sessionManager) {
      return Response.json({ error: 'Session Manager not configured' }, { status: 500 });
    }
    ctx.sessionManager.pauseObservation();
    return Response.json({ status: 'paused', observing: false });
  }

  if (path === '/api/session/resume' && method === 'POST') {
    if (!ctx.sessionManager) {
      return Response.json({ error: 'Session Manager not configured' }, { status: 500 });
    }
    ctx.sessionManager.resumeObservation();
    return Response.json({ status: 'resumed', observing: true });
  }

  if (path === '/api/session/end' && method === 'POST') {
    if (!ctx.sessionManager) {
      return Response.json({ error: 'Session Manager not configured' }, { status: 500 });
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const session = ctx.sessionManager.endSession(body?.session_id);
    return Response.json({ status: 'ended', session });
  }

  if (path.startsWith('/api/session/') && path.endsWith('/replay') && method === 'GET') {
    if (!ctx.replayEngine) {
      return Response.json({ error: 'Session Replay Engine not configured' }, { status: 500 });
    }
    const sessionId = path.replace('/api/session/', '').replace('/replay', '');
    const replay = ctx.replayEngine.reconstructSession(sessionId);
    if (!replay) {
      return Response.json({ error: `Session ${sessionId} not found` }, { status: 404 });
    }
    return Response.json(replay);
  }

  // Causality Engine Endpoints
  if (path === '/api/causality/hypotheses' && method === 'GET') {
    if (!ctx.causalityEngine) {
      return Response.json({ count: 0, hypotheses: [] });
    }
    const contextParam = url.searchParams.get('context') || undefined;
    const hypotheses = ctx.causalityEngine.getAllHypotheses(contextParam);
    return Response.json({ count: hypotheses.length, hypotheses });
  }

  // Chat completions endpoint (OpenCode & OpenAI compatibility)
  if ((path === '/v1/chat/completions' || path === '/chat/completions') && method === 'POST') {
    return handleChatCompletions(req, ctx);
  }

  return Response.json({ error: { message: `Not Found: ${method} ${path}`, type: 'invalid_request_error' } }, { status: 404 });
}

async function handleChatCompletions(
  req: Request,
  ctx: GatewayContext
): Promise<Response> {
  const startTime = Date.now();
  const correlationId =
    req.headers.get('x-correlation-id') ||
    req.headers.get('x-request-id') ||
    `corr-${randomUUID()}`;
  const sessionId =
    req.headers.get('x-session-id') ||
    req.headers.get('opencode-session-id') ||
    null;

  let body: any;
  try {
    body = await req.json();
  } catch (parseErr: any) {
    ctx.ledger.appendEvent({
      correlationId,
      sessionId,
      actor: 'client',
      eventType: 'system_error',
      payload: { error: 'Malformed JSON in request body', raw: parseErr.message },
      metadata: { status_code: 400 },
    });
    return Response.json(
      { error: { message: 'Invalid JSON body in request', type: 'invalid_request_error' } },
      { status: 400 }
    );
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    ctx.ledger.appendEvent({
      correlationId,
      sessionId,
      actor: 'client',
      eventType: 'system_error',
      payload: { error: 'Missing or invalid messages array', body },
      metadata: { status_code: 400 },
    });
    return Response.json(
      { error: { message: 'Missing or invalid "messages" array', type: 'invalid_request_error' } },
      { status: 400 }
    );
  }

  // Model selection hierarchy:
  // 1. Explicit model requested by client in request body
  // 2. Explicit gateway default model configured at startup
  // 3. Provider default model
  // 4. Safe neutral fallback
  const explicitModel = body.model && typeof body.model === 'string' && body.model.trim().length > 0 ? body.model.trim() : undefined;
  const effectiveModel = explicitModel || ctx.defaultModel || ctx.provider.defaultModel || 'neutral-reasoner';

  const chatRequest: ChatCompletionRequest = {
    ...body,
    model: effectiveModel,
  };

  const projectId = (body.project_id as string) || 'default';
  const lastUserMsg = [...chatRequest.messages].reverse().find((m) => m.role === 'user');
  const userIntent = lastUserMsg?.content || 'Unspecified task';

  // 1. Log incoming client request to L0
  const incomingEvent = ctx.ledger.appendEvent({
    correlationId,
    sessionId,
    projectId,
    actor: 'client',
    eventType: 'incoming_request',
    payload: chatRequest,
    metadata: {
      client_ip: req.headers.get('x-forwarded-for') || '127.0.0.1',
      user_agent: req.headers.get('user-agent') || 'opencode',
      model_requested: effectiveModel,
      explicit_model_provided: Boolean(explicitModel),
      streaming_requested: Boolean(chatRequest.stream),
    },
  });

  // Phase 5: Heart Supervisory Evaluation
  let heartEval: HeartEvaluation | null = null;
  if (ctx.heartSupervisor) {
    heartEval = ctx.heartSupervisor.evaluateAction({
      actionText: userIntent,
      taskContext: projectId,
      intent: userIntent,
      userOverride: Boolean(body.user_override),
      affectedFiles: (body.affected_files as string[]) || [],
    });

    if (heartEval.requires_human_confirmation && !heartEval.user_override_granted) {
      ctx.ledger.appendEvent({
        parentEventId: incomingEvent.event_id,
        correlationId,
        sessionId,
        projectId,
        actor: 'heart',
        eventType: 'safety_violation',
        payload: {
          action: userIntent,
          violation: heartEval.bios_rule_triggered || 'mandatory_human_confirmation',
          evaluation: heartEval,
        },
        metadata: { status_code: 403 },
      });

      return Response.json(
        {
          error: {
            message: `Action blocked by Original Brain Heart BIOS: ${heartEval.warnings.join(' ')}`,
            type: 'heart_safety_violation',
            evaluation: heartEval,
          },
        },
        { status: 403 }
      );
    }
  }

  // Phase 2: Create L1 Experience record
  let experienceId: string | null = null;
  if (ctx.experienceManager) {
    const exp = ctx.experienceManager.createExperience({
      correlationId,
      sessionId,
      projectId,
      intent: userIntent,
      model: effectiveModel,
      supportingL0EventIds: [incomingEvent.event_id],
      affectedFiles: (body.affected_files as string[]) || [],
      metadata: {
        ...(body.metadata || {}),
        rule_candidate: body.rule_candidate || body.metadata?.rule_candidate,
        strategy_candidate: body.strategy_candidate || body.metadata?.strategy_candidate,
      },
    });
    experienceId = exp.experience_id;
  }

  // Phase 2: Compile L3 Context deterministically
  let compiledRequest = chatRequest;
  let l3LatencyMs = 0;
  let retrievedRuleCount = 0;

  if (ctx.contextCompiler) {
    const l3Context = await ctx.contextCompiler.compile(userIntent, projectId, { modelName: effectiveModel });
    if (heartEval) {
      l3Context.heart_directive = heartEval;
    }
    l3LatencyMs = l3Context.compilation_latency_ms;
    retrievedRuleCount = l3Context.retrieved_rules.length;
    compiledRequest = injectL3IntoRequest(chatRequest, l3Context);
  }

  // 2. Log outgoing provider request to L0 (causally linked to incoming request)
  const outgoingEvent = ctx.ledger.appendEvent({
    parentEventId: incomingEvent.event_id,
    correlationId,
    sessionId,
    projectId,
    actor: 'gateway',
    eventType: 'outgoing_provider_request',
    payload: {
      provider: ctx.provider.name,
      request: compiledRequest,
    },
    metadata: {
      provider: ctx.provider.name,
      l3_compilation_latency_ms: l3LatencyMs,
      l3_retrieved_rules_count: retrievedRuleCount,
      experience_id: experienceId,
      heart_risk_level: heartEval?.risk_level ?? 'LOW',
      heart_modalities: heartEval?.active_modalities ?? [],
    },
  });

  if (experienceId && ctx.experienceManager) {
    ctx.experienceManager.addSupportingL0Event(experienceId, outgoingEvent.event_id);
  }

  const isStreaming = Boolean(chatRequest.stream);

  if (isStreaming) {
    // STREAMING PIPELINE
    try {
      const streamGenerator = ctx.provider.chatStream(compiledRequest);
      const chunks: ChatCompletionChunk[] = [];

      const stream = new ReadableStream({
        async start(controller) {
          const textEncoder = new TextEncoder();
          try {
            for await (const chunk of streamGenerator) {
              chunks.push(chunk);
              const sseLine = formatSseChunk(chunk);
              controller.enqueue(textEncoder.encode(sseLine));
            }
            controller.enqueue(textEncoder.encode(formatSseDone()));
            controller.close();

            const fullResponse = reconstructResponseFromChunks(chunks, compiledRequest.model);
            const durationMs = Date.now() - startTime;

            // 3. Log provider response
            const providerRespEvent = ctx.ledger.appendEvent({
              parentEventId: outgoingEvent.event_id,
              correlationId,
              sessionId,
              projectId,
              actor: 'provider',
              eventType: 'provider_response',
              payload: fullResponse,
              metadata: {
                provider: ctx.provider.name,
                duration_ms: durationMs,
                chunks_count: chunks.length,
                streaming: true,
                experience_id: experienceId,
              },
            });

            // 4. Log returned response to client
            const returnedRespEvent = ctx.ledger.appendEvent({
              parentEventId: providerRespEvent.event_id,
              correlationId,
              sessionId,
              projectId,
              actor: 'gateway',
              eventType: 'returned_response',
              payload: {
                status: 'stream_completed',
                response_id: fullResponse.id,
                chunks_delivered: chunks.length,
              },
              metadata: {
                duration_ms: durationMs,
                status_code: 200,
                experience_id: experienceId,
              },
            });

            // Phase 2: Transition L1 Experience to PROVISIONALLY_ACCEPTED -> OBSERVATION
            if (experienceId && ctx.experienceManager) {
              ctx.experienceManager.addSupportingL0Event(experienceId, providerRespEvent.event_id);
              ctx.experienceManager.addSupportingL0Event(experienceId, returnedRespEvent.event_id);
              ctx.experienceManager.markProvisionallyAccepted(experienceId);
              ctx.experienceManager.startObservation(experienceId);
            }
          } catch (streamErr: any) {
            const durationMs = Date.now() - startTime;
            const isTimeout = streamErr.message?.toLowerCase().includes('timeout');
            const errorEventType = isTimeout ? 'timeout' : 'provider_error';

            ctx.ledger.appendEvent({
              parentEventId: outgoingEvent.event_id,
              correlationId,
              sessionId,
              projectId,
              actor: 'provider',
              eventType: errorEventType,
              payload: {
                error: streamErr.message || 'Stream processing failed',
                stack: streamErr.stack,
              },
              metadata: {
                duration_ms: durationMs,
                chunks_before_error: chunks.length,
                experience_id: experienceId,
              },
            });

            if (experienceId && ctx.experienceManager) {
              ctx.experienceManager.settleOutcome(
                experienceId,
                'FAILURE',
                0.95,
                'FAILURE_SIGNAL'
              );
            }

            controller.error(streamErr);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Correlation-Id': correlationId,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isTimeout = err.message?.toLowerCase().includes('timeout');
      const errorEventType = isTimeout ? 'timeout' : 'provider_error';

      ctx.ledger.appendEvent({
        parentEventId: outgoingEvent.event_id,
        correlationId,
        sessionId,
        projectId,
        actor: 'provider',
        eventType: errorEventType,
        payload: {
          error: err.message || 'Streaming initiation failed',
          stack: err.stack,
        },
        metadata: {
          duration_ms: durationMs,
          status_code: isTimeout ? 504 : 502,
          experience_id: experienceId,
        },
      });

      if (experienceId && ctx.experienceManager) {
        ctx.experienceManager.settleOutcome(
          experienceId,
          'FAILURE',
          0.95,
          'FAILURE_SIGNAL'
        );
      }

      return Response.json(
        { error: { message: err.message || 'Provider streaming failed', type: errorEventType } },
        { status: isTimeout ? 504 : 502, headers: { 'X-Correlation-Id': correlationId } }
      );
    }
  } else {
    // NON-STREAMING PIPELINE
    try {
      const response = await ctx.provider.chat(compiledRequest);
      const durationMs = Date.now() - startTime;

      // 3. Log provider response to L0
      const providerRespEvent = ctx.ledger.appendEvent({
        parentEventId: outgoingEvent.event_id,
        correlationId,
        sessionId,
        projectId,
        actor: 'provider',
        eventType: 'provider_response',
        payload: response,
        metadata: {
          provider: ctx.provider.name,
          duration_ms: durationMs,
          streaming: false,
          experience_id: experienceId,
        },
      });

      // 4. Log returned response to client
      const returnedRespEvent = ctx.ledger.appendEvent({
        parentEventId: providerRespEvent.event_id,
        correlationId,
        sessionId,
        projectId,
        actor: 'gateway',
        eventType: 'returned_response',
        payload: response,
        metadata: {
          duration_ms: durationMs,
          status_code: 200,
          experience_id: experienceId,
        },
      });

      // Phase 2: Transition L1 Experience to PROVISIONALLY_ACCEPTED -> OBSERVATION
      if (experienceId && ctx.experienceManager) {
        ctx.experienceManager.addSupportingL0Event(experienceId, providerRespEvent.event_id);
        ctx.experienceManager.addSupportingL0Event(experienceId, returnedRespEvent.event_id);
        ctx.experienceManager.markProvisionallyAccepted(experienceId);
        ctx.experienceManager.startObservation(experienceId);
      }

      return Response.json(response, {
        headers: {
          'X-Correlation-Id': correlationId,
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isTimeout = err.message?.toLowerCase().includes('timeout');
      const errorEventType = isTimeout ? 'timeout' : 'provider_error';

      ctx.ledger.appendEvent({
        parentEventId: outgoingEvent.event_id,
        correlationId,
        sessionId,
        projectId,
        actor: 'provider',
        eventType: errorEventType,
        payload: {
          error: err.message || 'Provider request failed',
          stack: err.stack,
        },
        metadata: {
          duration_ms: durationMs,
          status_code: isTimeout ? 504 : 502,
          experience_id: experienceId,
        },
      });

      if (experienceId && ctx.experienceManager) {
        ctx.experienceManager.settleOutcome(
          experienceId,
          'FAILURE',
          0.95,
          'FAILURE_SIGNAL'
        );
      }

      return Response.json(
        { error: { message: err.message || 'Provider request failed', type: errorEventType } },
        { status: isTimeout ? 504 : 502, headers: { 'X-Correlation-Id': correlationId } }
      );
    }
  }
}
