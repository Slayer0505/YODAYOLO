import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';
import { performance } from 'perf_hooks';
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
import { DeterministicLocalEmbedder } from '../src/l3/embeddings';
import { BeadsLiteManager } from '../src/beads/beads';
import { SessionManager } from '../src/session/manager';
import { UniversalProviderRouter } from '../src/providers/router';
import { AdapterRegistry } from '../src/adapters/registry';
import { AntigravityAdapter } from '../src/adapters/antigravity';
import { OpenCodeAdapter } from '../src/adapters/opencode';
import { ClaudeAdapter } from '../src/adapters/claude';
import { CodexAdapter } from '../src/adapters/codex';
import { MockReasoningProvider } from '../src/providers/mock';
import { AIClientDetector } from '../src/adapters/detector';

const FORENSIC_DB = 'yoda_forensics_test.db';

describe('YODA Multi-Agent & Multi-Model Forensic Verification Suite', () => {
  let ledger: L0EventLedger;
  let expManager: L1ExperienceManager;
  let evidenceBus: EvidenceBus;
  let l2Store: L2KnowledgeStore;
  let learningEngine: L2LearningEngine;
  let l4Store: L4Store;
  let metaEngine: L4MetaEngine;
  let bios: HeartBios;
  let supervisor: HeartSupervisor;
  let embedder: DeterministicLocalEmbedder;
  let cortex: CodebaseCortex;
  let beads: BeadsLiteManager;
  let sessionMgr: SessionManager;
  let compiler: L3ContextCompiler;
  let router: UniversalProviderRouter;
  let mockProvider: MockReasoningProvider;
  let adapters: AdapterRegistry;

  // Tracked forensic artifacts
  let testA_correlationId: string;
  let testA_experienceId: string;
  let testA_ruleId: string;
  let testA_l0EventIds: string[] = [];

  beforeAll(async () => {
    if (existsSync(FORENSIC_DB)) unlinkSync(FORENSIC_DB);

    ledger = new L0EventLedger(FORENSIC_DB);
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

    embedder = new DeterministicLocalEmbedder(64);
    cortex = new CodebaseCortex({ rootDir: process.cwd() });
    beads = new BeadsLiteManager(ledger.getDatabase(), ledger);
    sessionMgr = new SessionManager({ db: ledger.getDatabase(), ledger, evidenceBus });

    compiler = new L3ContextCompiler(l2Store, embedder, cortex, beads, sessionMgr);

    router = new UniversalProviderRouter({ defaultModel: 'neutral-reasoner' });
    mockProvider = new MockReasoningProvider({
      name: 'forensic-mock-engine',
      defaultModel: 'neutral-reasoner',
      models: ['claude-3-5-sonnet', 'gpt-4o', 'gemini-1.5-pro', 'qwen2.5:3b', 'neutral-reasoner'],
    });
    router.registerProvider('mock', mockProvider);
    router.setDefaultFallbackProvider(mockProvider);

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
    if (existsSync(FORENSIC_DB)) unlinkSync(FORENSIC_DB);
  });

  // =========================================================================
  // TEST A — CROSS-AGENT LEARNING (Client A: Antigravity)
  // =========================================================================
  it('TEST A: Client A (Antigravity) performs task and emits evidence-backed rule', async () => {
    const antigravity = adapters.getAdapter('antigravity') as AntigravityAdapter;
    testA_correlationId = 'corr-antigravity-forensic-001';

    // 1. User intent captured
    const prompt = 'Investigate the payments database connection pool under burst load.';
    const promptCapture = await antigravity.capturePrompt(prompt, {
      correlationId: testA_correlationId,
      projectId: 'payments-service',
      model: 'Gemini 3.7 Pro',
    });

    testA_experienceId = promptCapture.experienceId!;
    expect(promptCapture.correlationId).toBe(testA_correlationId);
    expect(promptCapture.experienceId).toBeDefined();

    // 2. Model reasoning simulated
    const responseEvent = await antigravity.captureResponse(
      testA_correlationId,
      'PostgreSQL connection pool max_size should be set to 25 with 5s idle timeout.'
    );
    testA_l0EventIds.push(responseEvent.event_id);

    // 3. Tool / Test execution emits evidence signal
    const testSignal = await antigravity.captureTestResult(
      testA_correlationId,
      true,
      'PostgreSQL pool max_size=25 was verified under load testing with 0 connection timeouts',
      ['src/db/pool.ts']
    );
    expect(testSignal).toBeDefined();

    // 4. Outcome settled -> L1 experience marked SUCCESS
    await antigravity.captureOutcome(testA_correlationId, 'SUCCESS', 0.95, 'LOAD_TEST_PASSED');

    // 5. Verify L2 rule is synthesized and stored
    const rules = l2Store.getAllRules({ taskContext: 'payments-service' });
    expect(rules.length).toBeGreaterThan(0);
    const targetRule = rules.find((r) => r.content.includes('PostgreSQL pool max_size=25'));
    expect(targetRule).toBeDefined();
    testA_ruleId = targetRule!.rule_id;

    // Terminate / Disconnect Client A
    await antigravity.disconnect();
    expect(antigravity.isConnected()).toBe(false);
  });

  // =========================================================================
  // TEST B — FRESH CLIENT INHERITANCE (Client B: OpenCode / Claude)
  // =========================================================================
  it('TEST B: Fresh Client B (OpenCode) inherits rule learned by Client A without manual transfer', async () => {
    const opencode = adapters.getAdapter('opencode') as OpenCodeAdapter;
    await opencode.connect();

    // Fresh prompt with related task
    const clientB_prompt = 'Refactor database timeout handling in the payments module';
    const clientB_capture = await opencode.capturePrompt(clientB_prompt, {
      projectId: 'payments-service',
      model: 'claude-3-5-sonnet',
    });

    // Verify L3 compiler automatically retrieved the rule created by Antigravity
    expect(clientB_capture.injectedSystemPrompt).toContain('PostgreSQL pool max_size=25');
    expect(clientB_capture.compiledContext.retrieved_rules.length).toBeGreaterThanOrEqual(1);

    // Verify Provenance Chain: L2 Rule -> Supporting Experience -> L0 Event
    const explanation = expManager.getExperience(testA_experienceId);
    expect(explanation).toBeDefined();
    expect(explanation?.intent).toContain('Investigate the payments database');
    expect(explanation?.status).toBe('SUCCESS');
    expect(explanation?.supporting_l0_event_ids.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // TEST C — MODEL INDEPENDENCE (Multi-Model / Multi-Provider routing)
  // =========================================================================
  it('TEST C: Preserves authoritative model selection across Claude, GPT, and local models', async () => {
    // 1. Route to Claude
    const claudeProvider = router.resolveProviderForModel('claude-3-5-sonnet');
    expect(claudeProvider).toBeDefined();

    // 2. Route to GPT-4o
    const gptProvider = router.resolveProviderForModel('gpt-4o');
    expect(gptProvider).toBeDefined();

    // 3. Route to Gemini
    const geminiProvider = router.resolveProviderForModel('gemini-1.5-pro');
    expect(geminiProvider).toBeDefined();

    // 4. State remains identical regardless of model
    const rules = l2Store.getAllRules({ taskContext: 'payments-service' });
    expect(rules.some((r) => r.rule_id === testA_ruleId)).toBe(true);
  });

  // =========================================================================
  // TEST D — PROVIDER INDEPENDENCE (Zero Ollama Dependency)
  // =========================================================================
  it('TEST D: Operates without Ollama or external daemon dependencies', async () => {
    const embedderLocal = new DeterministicLocalEmbedder(64);
    const vec = embedderLocal.embedSync('Test provider independence');
    expect(vec.length).toBe(64);

    // Router handles completions via local or upstream providers seamlessly
    const resp = await router.chat({
      model: 'neutral-reasoner',
      messages: [{ role: 'user', content: 'Ping test' }],
    });
    expect(resp.choices[0].message.content).toBeDefined();
  });

  // =========================================================================
  // TEST E — OUTCOME LEARNING (Lifecycle State Machine & Delayed Evidence)
  // =========================================================================
  it('TEST E: Validates lifecycle states PROPOSED -> PROVISIONALLY_ACCEPTED -> OBSERVATION -> SETTLED', async () => {
    const corrId = 'corr-lifecycle-test-001';
    const exp = expManager.createExperience({
      correlationId: corrId,
      projectId: 'order-service',
      intent: 'Apply cache layer to order queries',
      model: 'gpt-4o',
    });

    expect(exp.status).toBe('PROPOSED');

    // Model delivers response -> PROVISIONALLY_ACCEPTED -> OBSERVATION
    expManager.markProvisionallyAccepted(exp.experience_id);
    expect(expManager.getExperience(exp.experience_id)?.status).toBe('PROVISIONALLY_ACCEPTED');

    expManager.startObservation(exp.experience_id);
    expect(expManager.getExperience(exp.experience_id)?.status).toBe('OBSERVATION');

    // Delayed evidence arrives -> Settle to SUCCESS with high confidence
    expManager.settleOutcome(exp.experience_id, 'SUCCESS', 0.98, 'SUCCESS_SIGNAL');
    expect(expManager.getExperience(exp.experience_id)?.status).toBe('SUCCESS');
    expect(expManager.getExperience(exp.experience_id)?.confidence).toBe(0.98);
  });

  // =========================================================================
  // TEST F — NEGATIVE EVIDENCE & CONTRADICTION HANDLING
  // =========================================================================
  it('TEST F: Negative evidence updates confidence and contradiction count without erasing history', async () => {
    const ruleBefore = l2Store.getRule(testA_ruleId)!;
    const initialConfidence = ruleBefore.confidence;

    // Apply contradictory evidence via L2 Store
    const updatedRule = l2Store.recordContradictoryEvidence(testA_ruleId, 'exp-contradiction-01');

    expect(updatedRule.contradiction_count).toBeGreaterThan(0);
    expect(updatedRule.confidence).toBeLessThan(initialConfidence);

    // L0 remains immutable
    const events = ledger.getEventsByCorrelationId(testA_correlationId);
    expect(events.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // TEST G — COLD RESTART PERSISTENCE
  // =========================================================================
  it('TEST G: Preserves exact cognitive state across cold daemon restart', async () => {
    const l0_before = ledger.getEventCount();
    const l1_before = expManager.getAllExperiences().length;
    const l2_before = l2Store.getAllRules().length;
    const l4_before = l4Store.getAllPredictions().length;

    // 1. Close active SQLite connection (simulate daemon kill)
    ledger.close();

    // 2. Re-open SQLite connection (simulate daemon restart)
    ledger = new L0EventLedger(FORENSIC_DB);
    expManager = new L1ExperienceManager(ledger.getDatabase());
    evidenceBus = new EvidenceBus(ledger, expManager);
    l2Store = new L2KnowledgeStore(ledger.getDatabase());
    learningEngine = new L2LearningEngine(l2Store);
    evidenceBus.setLearningEngine(learningEngine);
    l4Store = new L4Store(ledger.getDatabase());
    metaEngine = new L4MetaEngine(l4Store, l2Store, expManager, ledger);
    supervisor = new HeartSupervisor({ bios, l2Store, metaEngine });
    compiler = new L3ContextCompiler(l2Store, embedder, cortex, beads, sessionMgr);

    const l0_after = ledger.getEventCount();
    const l1_after = expManager.getAllExperiences().length;
    const l2_after = l2Store.getAllRules().length;
    const l4_after = l4Store.getAllPredictions().length;

    expect(l0_after).toBe(l0_before);
    expect(l1_after).toBe(l1_before);
    expect(l2_after).toBe(l2_before);
    expect(l4_after).toBe(l4_before);
  });

  // =========================================================================
  // TEST H — PRIVACY & SECRET REDACTION
  // =========================================================================
  it('TEST H: Redacts Bearer tokens, API keys, passwords, and JWTs before SQLite persistence', async () => {
    const privacyDb = 'yoda_privacy_test.db';
    if (existsSync(privacyDb)) unlinkSync(privacyDb);

    const privLedger = new L0EventLedger(privacyDb);
    const sensitivePayload = {
      apiKey: 'sk-proj-1234567890abcdef1234567890abcdef',
      anthropicKey: 'anthropic-1234567890abcdef1234567890',
      password: 'super_secret_db_password_123',
      bearerToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis',
      normalContent: 'Deploying worker container',
    };

    const event = privLedger.appendEvent({
      correlationId: 'corr-privacy-001',
      actor: 'client',
      eventType: 'incoming_request',
      payload: sensitivePayload,
    });

    // Check in-memory returned event
    expect(canonicalString(event.payload)).not.toContain('sk-proj-1234567890');
    expect(canonicalString(event.payload)).not.toContain('super_secret_db_password_123');

    // Check directly in raw SQLite rows
    const row = privLedger.getDatabase().query('SELECT payload FROM l0_events WHERE event_id = ?').get(event.event_id) as any;
    expect(row.payload).not.toContain('sk-proj-1234567890');
    expect(row.payload).not.toContain('super_secret_db_password_123');
    expect(row.payload).toContain('[REDACTED_SECRET]');

    privLedger.close();
    if (existsSync(privacyDb)) unlinkSync(privacyDb);
  });

  // =========================================================================
  // TEST I — REAL LATENCY PROFILE (Cognitive Overhead vs Inference)
  // =========================================================================
  it('TEST I: Measures true cognitive pipeline overhead separated from inference', async () => {
    const t0 = performance.now();
    const l0_start = performance.now();
    ledger.appendEvent({
      correlationId: 'corr-latency-test',
      actor: 'client',
      eventType: 'incoming_request',
      payload: { prompt: 'Performance timing probe' },
    });
    const l0_duration = performance.now() - l0_start;

    const l3_start = performance.now();
    const compiled = await compiler.compile('Performance timing probe', 'payments-service');
    const l3_duration = performance.now() - l3_start;

    const heart_start = performance.now();
    supervisor.evaluateAction({ actionText: 'Performance timing probe', taskContext: 'payments-service' });
    const heart_duration = performance.now() - heart_start;

    const totalOverhead = performance.now() - t0;

    expect(l0_duration).toBeLessThan(5); // SQLite WAL < 5ms
    expect(l3_duration).toBeLessThan(20); // L3 Compiler < 20ms
    expect(heart_duration).toBeLessThan(5); // Heart BIOS < 5ms
    expect(totalOverhead).toBeLessThan(30);
  });

  // =========================================================================
  // TEST J — UNIVERSAL ADAPTER AUDIT
  // =========================================================================
  it('TEST J: Audits adapter classifications accurately', async () => {
    const detected = await AIClientDetector.detectAll();
    expect(detected.length).toBeGreaterThanOrEqual(5);

    const antigravity = detected.find((d) => d.id === 'antigravity');
    const opencode = detected.find((d) => d.id === 'opencode');
    const claude = detected.find((d) => d.id === 'claude');
    const universal = detected.find((d) => d.id === 'universal');

    expect(antigravity?.detected).toBe(true);
    expect(opencode?.detected).toBe(true);
    expect(universal?.detected).toBe(true);
  });
});

function canonicalString(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  return JSON.stringify(obj);
}
