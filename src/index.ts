import { L0EventLedger } from './db/ledger';
import { EvidenceBus } from './evidence/bus';
import { GatewayServer } from './gateway/server';
import { L1ExperienceManager } from './l1/experience';
import { L3ContextCompiler } from './l3/compiler';
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
import { UniversalProviderRouter } from './providers/router';
import { AdapterRegistry } from './adapters/registry';
import type { ReasoningProvider } from './types';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || 'yoda_l0.db';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || process.env.MODEL || 'neutral-reasoner';
const UPSTREAM_URL = process.env.UPSTREAM_URL;
const UPSTREAM_KEY = process.env.UPSTREAM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

async function createUniversalRouter(defaultModel: string): Promise<UniversalProviderRouter> {
  const router = new UniversalProviderRouter({
    defaultModel,
    upstreamUrl: UPSTREAM_URL,
    upstreamKey: UPSTREAM_KEY,
    anthropicKey: ANTHROPIC_KEY,
    openaiKey: OPENAI_KEY,
    geminiKey: GEMINI_KEY,
  });

  console.log(`[Init] Universal Provider Router online (Providers: ${router.getAllProviders().map(p => p.name).join(', ')})`);
  return router;
}

async function main() {
  console.log('================================================================');
  console.log('       YODA — UNIVERSAL PERSISTENT COGNITIVE OPERATING SYSTEM   ');
  console.log('       Model-Independent • Agent-Independent • Plug-and-Play    ');
  console.log('   [L0] + [L1] + [L2] + [L3] + [L4 Meta-Learning] + [Heart BIOS] ');
  console.log('   [Universal Adapters] + [Evidence Bus] + [Dual-Cortex Engine] ');
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

  // Initialize Hybrid Semantic Embedder
  const embedder = new HybridSemanticEmbedder({ baseUrl: UPSTREAM_URL });
  
  // Initialize Codebase Cortex
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

  // Initialize Dream Scheduler
  const dreamScheduler = new DreamScheduler(consolidator, ledger, {
    intervalMs: 60000,
    idleThresholdMs: 30000,
    settledThreshold: 5,
    autoStart: true,
  });
  evidenceBus.setDreamScheduler(dreamScheduler);
  console.log(`[Init] Dreaming Consolidation & Background Scheduler online.`);

  // Initialize Universal Multi-Provider Router
  const provider = await createUniversalRouter(DEFAULT_MODEL);

  // Initialize Universal Client Adapter Registry
  const adapterRegistry = new AdapterRegistry({
    ledger,
    evidenceBus,
    experienceManager,
    contextCompiler,
    heartSupervisor,
  });
  console.log(`[Init] Universal AI Adapter Registry online (${adapterRegistry.getAllAdapters().length} standard adapters registered).`);

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
    defaultModel: DEFAULT_MODEL,
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
    adapterRegistry,
  });

  gateway.start();

  // Automatic Background Unified Transcript Syncer (Antigravity + OpenCode)
  const { syncAllClientTranscripts } = await import('./adapters/transcript_syncer');
  syncAllClientTranscripts({ verbose: false }).catch(() => {});
  const syncInterval = setInterval(() => {
    syncAllClientTranscripts({ verbose: false }).catch(() => {});
  }, 15000);

  const shutdown = () => {
    console.log('\n[Shutdown] Shutting down YODA Gateway...');
    clearInterval(syncInterval);
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
