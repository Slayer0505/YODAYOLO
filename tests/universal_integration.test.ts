import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { L0EventLedger } from '../src/db/ledger';
import { EvidenceBus } from '../src/evidence/bus';
import { L1ExperienceManager } from '../src/l1/experience';
import { L2KnowledgeStore } from '../src/l2/store';
import { L2LearningEngine } from '../src/l2/learning_engine';
import { L3ContextCompiler } from '../src/l3/compiler';
import { L4Store } from '../src/l4/store';
import { L4MetaEngine } from '../src/l4/meta_engine';
import { HeartBios } from '../src/heart/bios';
import { HeartSupervisor } from '../src/heart/supervisor';
import { CodebaseCortex } from '../src/cortex/codebase_cortex';
import { HybridSemanticEmbedder } from '../src/l3/embeddings';
import { BeadsLiteManager } from '../src/beads/beads';
import { SessionManager } from '../src/session/manager';
import { UniversalProviderRouter } from '../src/providers/router';
import { AdapterRegistry } from '../src/adapters/registry';
import { AntigravityAdapter } from '../src/adapters/antigravity';
import { OpenCodeAdapter } from '../src/adapters/opencode';
import { ClaudeAdapter } from '../src/adapters/claude';
import { CodexAdapter } from '../src/adapters/codex';
import { UniversalYodaAdapter } from '../src/adapters/universal';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = 'test_universal_yoda.db';

describe('YODA Universal AI Routing & Plug-and-Play Integration Test Suite', () => {
  let ledger: L0EventLedger;
  let expManager: L1ExperienceManager;
  let evidenceBus: EvidenceBus;
  let l2Store: L2KnowledgeStore;
  let learningEngine: L2LearningEngine;
  let l4Store: L4Store;
  let metaEngine: L4MetaEngine;
  let bios: HeartBios;
  let supervisor: HeartSupervisor;
  let cortex: CodebaseCortex;
  let beads: BeadsLiteManager;
  let sessionMgr: SessionManager;
  let compiler: L3ContextCompiler;
  let router: UniversalProviderRouter;
  let adapters: AdapterRegistry;

  beforeAll(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

    ledger = new L0EventLedger(TEST_DB);
    expManager = new L1ExperienceManager(ledger.getDatabase());
    evidenceBus = new EvidenceBus(ledger, expManager);

    l2Store = new L2KnowledgeStore(ledger.getDatabase());
    learningEngine = new L2LearningEngine(l2Store);
    evidenceBus.setLearningEngine(learningEngine);

    l4Store = new L4Store(ledger.getDatabase());
    metaEngine = new L4MetaEngine(l4Store, l2Store, expManager, ledger);
    evidenceBus.setMetaEngine(metaEngine);

    bios = new HeartBios();
    supervisor = new HeartSupervisor({ bios, l2Store, metaEngine });

    const embedder = new HybridSemanticEmbedder();
    cortex = new CodebaseCortex({ rootDir: process.cwd() });
    beads = new BeadsLiteManager(ledger.getDatabase(), ledger);
    sessionMgr = new SessionManager({ db: ledger.getDatabase(), ledger, evidenceBus });

    compiler = new L3ContextCompiler(l2Store, embedder, cortex, beads, sessionMgr);

    router = new UniversalProviderRouter({
      defaultModel: 'neutral-reasoner',
    });

    adapters = new AdapterRegistry({
      ledger,
      evidenceBus,
      experienceManager: expManager,
      contextCompiler: compiler,
      heartSupervisor: supervisor,
    });
  });

  afterAll(() => {
    ledger.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('1. Verifies Model Independence (Operates completely without Ollama)', async () => {
    expect(router).toBeDefined();
    const providers = router.getAllProviders();
    expect(providers.length).toBeGreaterThanOrEqual(4);

    // List models works across all providers
    const models = await router.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id.includes('claude'))).toBe(true);
    expect(models.some(m => m.id.includes('gpt'))).toBe(true);
  });

  it('2. Verifies Explicit Model Selection Remains Authoritative', async () => {
    const claudeProvider = router.resolveProviderForModel('claude-3-5-sonnet');
    expect(claudeProvider.name).toContain('claude');

    const gptProvider = router.resolveProviderForModel('gpt-4o');
    expect(gptProvider.name).toContain('gpt');

    const geminiProvider = router.resolveProviderForModel('gemini-1.5-pro');
    expect(geminiProvider.name).toContain('gemini');

    const defaultProvider = router.resolveProviderForModel('neutral-reasoner');
    expect(defaultProvider).toBeDefined();
  });

  it('3. Verifies Standard Universal Adapter Contract across multiple clients', async () => {
    const antigravity = adapters.getAdapter('antigravity');
    const opencode = adapters.getAdapter('opencode');
    const claude = adapters.getAdapter('claude');
    const codex = adapters.getAdapter('codex');
    const universal = adapters.getAdapter('universal');

    expect(antigravity).toBeDefined();
    expect(opencode).toBeDefined();
    expect(claude).toBeDefined();
    expect(codex).toBeDefined();
    expect(universal).toBeDefined();

    expect(antigravity?.isConnected()).toBe(true);
    expect(opencode?.isConnected()).toBe(true);
  });

  it('4. Verifies Prompt Capture & Dynamic L3 Context Compilation for Client A (Antigravity)', async () => {
    const antigravity = adapters.getAdapter('antigravity') as AntigravityAdapter;
    const prompt = 'How do we configure database connection pooling for PostgreSQL?';

    const capture = await antigravity.capturePrompt(prompt, {
      projectId: 'backend-service',
      model: 'Gemini 3.7 Pro',
    });

    expect(capture.correlationId).toBeDefined();
    expect(capture.compiledContext).toBeDefined();
    expect(capture.injectedSystemPrompt).toContain('ACTIVE PROJECT CONTEXT');

    // Capture model response
    await antigravity.captureResponse(capture.correlationId, 'Use pg.Pool with max connections 20');
  });

  it('5. Verifies Evidence Capture, Outcome Settlement, and Real L2 Learning from Client A', async () => {
    const antigravity = adapters.getAdapter('antigravity') as AntigravityAdapter;
    const corrId = 'corr-antigravity-test-01';

    // 1. Antigravity captures prompt
    await antigravity.capturePrompt('Optimize query execution in payments module', {
      correlationId: corrId,
      projectId: 'payments-svc',
    });

    // 2. Antigravity runs test and emits real evidence signal
    await antigravity.captureTestResult(
      corrId,
      true,
      'PostgreSQL connection pool max_size=25 verified under load testing',
      ['db/pool.ts']
    );

    // 3. Antigravity settles outcome
    await antigravity.captureOutcome(corrId, 'SUCCESS', 0.95, 'TEST_PASSED');

    // Verify L2 rule was synthesized
    const rules = l2Store.getAllRules({ taskContext: 'payments-svc' });
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].content).toContain('PostgreSQL connection pool');
  });

  it('6. Verifies Cross-Agent Transfer: Client B (Claude/OpenCode) Receives Client A Learned Rules', async () => {
    const opencode = adapters.getAdapter('opencode') as OpenCodeAdapter;

    // OpenCode prompts YODA in the same project context
    const openCodeCapture = await opencode.capturePrompt('Refactor database query timeouts in payments module', {
      projectId: 'payments-svc',
      model: 'claude-3-5-sonnet',
    });

    // Verify that the L3 compiler injected the rule learned from Antigravity into OpenCode's prompt!
    expect(openCodeCapture.injectedSystemPrompt).toContain('PostgreSQL connection pool');
    expect(openCodeCapture.compiledContext.retrieved_rules.length).toBeGreaterThanOrEqual(1);
    expect(openCodeCapture.compiledContext.retrieved_rules[0].content).toContain('PostgreSQL connection pool');
  });

  it('7. Measures Performance and Compilation Overhead', async () => {
    const universal = adapters.getAdapter('universal') as UniversalYodaAdapter;

    const t0 = performance.now();
    const result = await universal.capturePrompt('Fast retrieval benchmark', { projectId: 'benchmark-proj' });
    const t1 = performance.now();

    const totalLatency = t1 - t0;
    const l3Latency = result.compiledContext.compilation_latency_ms;

    expect(totalLatency).toBeLessThan(100); // Sub-100ms local compilation
    expect(l3Latency).toBeDefined();
  });
});
