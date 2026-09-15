import { L0EventLedger } from './db/ledger';
import { EvidenceBus } from './evidence/bus';
import { GatewayServer } from './gateway/server';
import { L1ExperienceManager } from './l1/experience';
import { L3ContextCompiler } from './l3/compiler';
import { MockL2KnowledgeStore } from './l3/mock_l2';
import { MockReasoningProvider } from './providers/mock';
import { OllamaReasoningProvider } from './providers/ollama';
import { UpstreamHttpProvider } from './providers/upstream';
import { L2KnowledgeStore } from './l2/store';
import { ProvenanceService } from './l2/provenance';
import { L2LearningEngine } from './l2/learning_engine';
import { L4Store } from './l4/store';
import { L4MetaEngine } from './l4/meta_engine';
import { HeartBios } from './heart/bios';
import { HeartSupervisor } from './heart/supervisor';
import { DreamingConsolidator } from './consolidation/dreaming';
import { DreamScheduler } from './consolidation/scheduler';
import { CognitiveLoopOrchestrator } from './orchestrator/cognitive_loop';
import { HybridSemanticEmbedder } from './l3/embeddings';
import { CodebaseCortex } from './cortex/codebase_cortex';
import { BeadsLiteManager } from './beads/beads';
import { SessionManager } from './session/manager';
import { SessionReplayEngine } from './session/replay';
import { CausalityEngine } from './causality/engine';
import { ToolRegistry } from './tools/registry';
import type { ReasoningProvider } from './types';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || 'yoda_l0.db';
const PROVIDER_TYPE = process.env.PROVIDER_TYPE || 'auto'; // 'auto' | 'ollama' | 'mock' | 'upstream'
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || process.env.MODEL;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://127.0.0.1:11434';
const UPSTREAM_KEY = process.env.UPSTREAM_KEY;

async function selectProvider(defaultModel?: string): Promise<ReasoningProvider> {
  if (PROVIDER_TYPE === 'mock') {
    console.log('[Init] Using Mock Reasoning Provider');
    return new MockReasoningProvider({ name: 'mock-engine', defaultModel });
  }

  if (PROVIDER_TYPE === 'upstream') {
    console.log(`[Init] Using Upstream HTTP Provider at ${UPSTREAM_URL}`);
    return new UpstreamHttpProvider({ baseUrl: UPSTREAM_URL, apiKey: UPSTREAM_KEY, defaultModel });
  }

  if (PROVIDER_TYPE === 'ollama') {
    console.log(`[Init] Using Ollama Provider at ${UPSTREAM_URL}`);
    return new OllamaReasoningProvider(UPSTREAM_URL, defaultModel);
  }

  // Auto-detection: Ollama is an interchangeable reasoning provider, not the YODA system itself
  const ollama = new OllamaReasoningProvider(UPSTREAM_URL, defaultModel);
  const isOllamaUp = await ollama.healthCheck().catch(() => false);
  if (isOllamaUp) {
    console.log(`[Init] Detected live Ollama endpoint at ${UPSTREAM_URL} as interchangeable provider.`);
    return ollama;
  }

  console.log('[Init] No live upstream detected; using local Mock Reasoning Provider for local operations.');
  return new MockReasoningProvider({ name: 'yoda-mock-engine', defaultModel });
}

async function main() {
  console.log('================================================================');
  console.log('       YODA — PERSISTENT COGNITIVE OPERATING SYSTEM             ');
  console.log('       OpenCode Compatible Local Service                         ');
  console.log('   [L0] + [L1] + [L2] + [L3] + [L4 Meta-Learning] + [Heart BIOS] ');
  console.log('   [Dual-Cortex] + [Live Session Capture] + [Causality Engine]   ');
  console.log('   [Tool Registry] + [Dream Scheduler] + [Beads-Lite Continuity] ');
  console.log('================================================================');

  const ledger = new L0EventLedger(DB_PATH);
  console.log(`[Init] SQLite L0 Ledger initialized at: ${DB_PATH}`);
  console.log(`[Init] Current event count in L0: ${ledger.getEventCount()}`);

  const experienceManager = new L1ExperienceManager(ledger.getDatabase());
  console.log(`[Init] L1 Experience Manager initialized. Active experiences: ${experienceManager.getAllExperiences().length}`);

  const evidenceBus = new EvidenceBus(ledger, experienceManager);
  console.log(`[Init] Evidence Bus sensory system online.`);

  // Initialize Session Manager & Live Observation Layer
  const sessionManager = new SessionManager({
    db: ledger.getDatabase(),
    ledger,
    evidenceBus,
  });
  console.log(`[Init] Live Session Manager online (${sessionManager.getActiveSources().length} sensory sources active).`);

  const replayEngine = new SessionReplayEngine({
    sessionManager,
    ledger,
    expManager: experienceManager,
  });

  // Initialize Causality Engine
  const causalityEngine = new CausalityEngine(ledger.getDatabase(), ledger);
  console.log(`[Init] Causality Engine online (${causalityEngine.getAllHypotheses().length} hypotheses active).`);

  const l2Store = new L2KnowledgeStore(ledger.getDatabase());
  const provenanceService = new ProvenanceService(l2Store, experienceManager, ledger);
  const learningEngine = new L2LearningEngine(l2Store);

  // Initialize Hybrid Semantic Embedder (Ollama nomic-embed-text + Local Fallback)
  const embedder = new HybridSemanticEmbedder({ baseUrl: UPSTREAM_URL });
  
  // Initialize Codebase Cortex (ADR-020 Graft Integration)
  const cortex = new CodebaseCortex({ rootDir: process.cwd() });
  cortex.refreshIfStale();
  console.log(`[Init] Codebase Cortex online (${cortex.computeFingerprint().filePaths.length} source files indexed).`);

  // Initialize Beads-Lite (Cross-Agent Task Continuity)
  const beadsManager = new BeadsLiteManager(ledger.getDatabase(), ledger);

  const contextCompiler = new L3ContextCompiler(l2Store, embedder, cortex, beadsManager, sessionManager);
  console.log(`[Init] Persistent L2 Knowledge Store online (${l2Store.getAllRules().length} rules, ${l2Store.getAllStrategies().length} strategies).`);

  const l4Store = new L4Store(ledger.getDatabase());
  const metaEngine = new L4MetaEngine(l4Store, l2Store, experienceManager, ledger);
  evidenceBus.setLearningEngine(learningEngine);
  evidenceBus.setMetaEngine(metaEngine);
  console.log(`[Init] L4 Meta-Learning & Epistemic Self-Model Engine online (${l4Store.getAllPredictions().length} predictions recorded).`);

  const bios = new HeartBios();
  const heartSupervisor = new HeartSupervisor({ bios, l2Store, metaEngine });
  console.log(`[Init] Heart Supervisory Layer online (${bios.getRules().length} universal safety rules active).`);

  // Initialize Tool Registry
  const toolRegistry = new ToolRegistry({
    cwd: process.cwd(),
    heartSupervisor,
    evidenceBus,
  });
  console.log(`[Init] Tool Registry online (${toolRegistry.listTools().length} tools active).`);

  const consolidator = new DreamingConsolidator({
    l0Ledger: ledger,
    l1Manager: experienceManager,
    l2Store,
    l2LearningEngine: learningEngine,
    l4Store,
    l4MetaEngine: metaEngine,
  });

  // Initialize Dream Scheduler (periodic background consolidation)
  const dreamScheduler = new DreamScheduler(consolidator, ledger, {
    intervalMs: 60000,
    idleThresholdMs: 30000,
    settledThreshold: 5,
    autoStart: true,
  });
  evidenceBus.setDreamScheduler(dreamScheduler);
  console.log(`[Init] Dreaming Consolidation & Background Scheduler online.`);

  const provider = await selectProvider(DEFAULT_MODEL);
  const cognitiveLoop = new CognitiveLoopOrchestrator({
    l0Ledger: ledger,
    l1Manager: experienceManager,
    l2Store,
    l2LearningEngine: learningEngine,
    l3Compiler: contextCompiler,
    l4Store,
    l4MetaEngine: metaEngine,
    heartSupervisor,
    evidenceBus,
    provider,
    toolRegistry,
  });
  console.log(`[Init] Closed Cognitive Loop Orchestrator online.`);

  const gateway = new GatewayServer({
    port: PORT,
    hostname: HOST,
    ledger,
    provider,
    defaultModel: DEFAULT_MODEL || provider.defaultModel || 'neutral-reasoner',
    experienceManager,
    evidenceBus,
    contextCompiler,
    l2Store,
    provenanceService,
    learningEngine,
    l4Store,
    metaEngine,
    heartSupervisor,
    consolidator,
    cognitiveLoop,
    cortex,
    toolRegistry,
    dreamScheduler,
    beadsManager,
    sessionManager,
    replayEngine,
    causalityEngine,
  });

  gateway.start();

  const shutdown = () => {
    console.log('\n[Shutdown] Shutting down YODA Gateway...');
    dreamScheduler.stop();
    gateway.stop();
    ledger.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  });
}
