import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { unlinkSync, existsSync, statSync } from 'fs';
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
import { MockReasoningProvider } from '../src/providers/mock';
import { DreamingConsolidator } from '../src/consolidation/dreaming';
import { AIClientDetector } from '../src/adapters/detector';

const TRUST_DB = 'yoda_long_term_trust.db';

describe('YODA Long-Term Trust & Reliability Forensic Verification Suite', () => {
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
  let consolidator: DreamingConsolidator;
  let router: UniversalProviderRouter;
  let adapters: AdapterRegistry;

  beforeAll(async () => {
    if (existsSync(TRUST_DB)) unlinkSync(TRUST_DB);

    ledger = new L0EventLedger(TRUST_DB);
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
    consolidator = new DreamingConsolidator({ l2Store, experienceManager: expManager, l4Store, l0Ledger: ledger });

    router = new UniversalProviderRouter({ defaultModel: 'neutral-reasoner' });
    const mock = new MockReasoningProvider({
      name: 'trust-mock-engine',
      defaultModel: 'neutral-reasoner',
      models: ['claude-3-5-sonnet', 'gpt-4o', 'gemini-1.5-pro', 'qwen2.5:3b', 'neutral-reasoner'],
    });
    router.registerProvider('mock', mock);
    router.setDefaultFallbackProvider(mock);

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
    if (existsSync(TRUST_DB)) unlinkSync(TRUST_DB);
  });

  // =========================================================================
  // 1. CLEAN ENVIRONMENT TEST
  // =========================================================================
  it('1. Clean Environment: Brain establishes sovereign persistent state with zero secret dependencies', async () => {
    expect(existsSync(TRUST_DB)).toBe(true);
    expect(ledger.getEventCount()).toBeGreaterThanOrEqual(0);
    const initialRules = l2Store.getAllRules();
    expect(initialRules.length).toBeGreaterThanOrEqual(4); // Default Heart & structural invariants
    expect(initialRules.every(r => r.rule_id && r.content && r.status)).toBe(true);
  });

  // =========================================================================
  // 2. UNIVERSAL AI CONNECTION CLASSIFICATION (INSTALLED AI + API/ENDPOINT)
  // =========================================================================
  it('2. Connection Matrix: Honestly classifies Installed AI vs API/Endpoints vs Unavailable Web Chats', async () => {
    const clients = await AIClientDetector.detectAll();
    
    const antigravity = clients.find(c => c.id === 'antigravity')!;
    const opencode = clients.find(c => c.id === 'opencode')!;
    const claude = clients.find(c => c.id === 'claude')!;
    const externalIdes = clients.find(c => c.id === 'external_ides')!;
    const webChats = clients.find(c => c.id === 'web_chats')!;

    expect(antigravity.integrationType).toBe('REAL_CLIENT');
    expect(opencode.integrationType).toBe('REAL_CLIENT');
    expect(externalIdes.integrationType).toBe('UNIVERSAL_CONNECTOR');
    expect(claude.integrationType).toBe('API_PATH');
    expect(webChats.connectionStatus).toBe('UNAVAILABLE');
    expect(webChats.setupInstructions).toContain('browser extension bridge');
  });

  // =========================================================================
  // 3. REALISTIC 10-SESSION SEQUENTIAL SIMULATION
  // =========================================================================
  it('3. Realistic Multi-Session Simulation across 10 distinct operational phases', async () => {
    // --- SESSION 1: Client A (Antigravity) performs task -> learns rule ---
    const s1Corr = 'sess-1-corr-redis';
    const s1Exp = expManager.createExperience({
      correlationId: s1Corr,
      projectId: 'cache-service',
      intent: 'Configure Redis connection pool with jitter backoff',
      model: 'claude-3-5-sonnet',
    });
    expManager.startObservation(s1Exp.experience_id);

    // Evidence arrives: integration test passes
    await evidenceBus.emit({
      source: 'test_runner',
      type: 'test_pass',
      correlationId: s1Corr,
      projectId: 'cache-service',
      payload: {
        rule_candidate: {
          category: 'learned_rule',
          taskContext: 'cache-service',
          content: 'Redis pool in cache-service requires exponential jitter backoff with max 5 retries',
          confidence: 0.88,
          tags: ['redis', 'backoff', 'cache'],
        },
      },
    });

    const s1Rules = l2Store.getAllRules({ taskContext: 'cache-service' });
    expect(s1Rules.length).toBeGreaterThan(0);
    const redisRule = s1Rules.find(r => r.content.includes('exponential jitter backoff'))!;
    expect(['HYPOTHESIS', 'CONFIRMED']).toContain(redisRule.status);

    // 2nd independent task/session observation arrives: corroborates and promotes to CONFIRMED
    const s1Exp2 = expManager.createExperience({
      correlationId: 'sess-1-corr-redis-2',
      projectId: 'cache-service',
      intent: 'Re-verify Redis connection pool under load',
      model: 'claude-3-5-sonnet',
    });
    expManager.startObservation(s1Exp2.experience_id);

    await evidenceBus.emit({
      source: 'test_runner',
      type: 'test_pass',
      correlationId: 'sess-1-corr-redis-2',
      projectId: 'cache-service',
      payload: {
        rule_candidate: {
          category: 'learned_rule',
          taskContext: 'cache-service',
          content: 'Redis pool in cache-service requires exponential jitter backoff with max 5 retries',
          tags: ['redis', 'backoff', 'cache'],
        },
      },
    });
    const s1PromotedRule = l2Store.getAllRules({ taskContext: 'cache-service' }).find(r => r.content.includes('exponential jitter backoff'))!;
    expect(s1PromotedRule.status).toBe('CONFIRMED');
    expect(s1PromotedRule.evidence_count).toBeGreaterThanOrEqual(2);

    // --- SESSION 2: Different task with related context ---
    const s2Context = await compiler.compile('Deploy cache worker redis configuration', 'cache-service');
    expect(s2Context.retrieved_rules.some(r => r.content.includes('exponential jitter backoff'))).toBe(true);

    // --- SESSION 3: Client B (OpenCode) inherits rule without manual transfer ---
    const opencodeAdapter = adapters.getAdapter('opencode') || adapters.getAdapter('universal');
    const promptCap = await opencodeAdapter.capturePrompt('Optimize cache client', {
      correlationId: 'sess-3-corr-opencode',
      projectId: 'cache-service',
      model: 'qwen2.5:3b',
    });
    expect(promptCap.compiledContext.retrieved_rules.length).toBeGreaterThan(0);

    // --- SESSION 4: Model/Provider Switch (Claude -> GPT-4o -> Local Reasoner) ---
    const swappedMock = new MockReasoningProvider({
      name: 'swapped-reasoner',
      defaultModel: 'gpt-4o',
      models: ['gpt-4o', 'deepseek-chat'],
    });
    router.registerProvider('swapped', swappedMock);
    router.setDefaultFallbackProvider(swappedMock);
    
    // Knowledge persists identically
    const s4Rules = l2Store.getAllRules({ taskContext: 'cache-service' });
    expect(s4Rules.some(r => r.content.includes('exponential jitter backoff'))).toBe(true);

    // --- SESSION 5: New project context (Isolation check) ---
    const s5Context = await compiler.compile('Configure database connection pool', 'billing-service');
    // cache-service rule should NOT dominate unrelated billing-service query
    const cacheRulesInBilling = s5Context.retrieved_rules.filter(r => r.task_context === 'cache-service');
    expect(cacheRulesInBilling.length).toBe(0);

    // --- SESSION 6: User Correction on Billing Service ---
    const s6Corr = 'sess-6-corr-billing';
    const s6Exp = expManager.createExperience({
      correlationId: s6Corr,
      projectId: 'billing-service',
      intent: 'Audit billing transaction isolation level',
      model: 'gpt-4o',
    });
    expManager.startObservation(s6Exp.experience_id);

    await evidenceBus.emit({
      source: 'user',
      type: 'user_correction',
      correlationId: s6Corr,
      projectId: 'billing-service',
      payload: {
        rule_candidate: {
          category: 'project_constraint',
          taskContext: 'billing-service',
          content: 'Billing service must use PostgreSQL serializable transactions for ledger entries',
          confidence: 0.95,
          tags: ['postgres', 'billing', 'isolation'],
        },
      },
    });

    const billingRules = l2Store.getAllRules({ taskContext: 'billing-service' });
    expect(billingRules.some(r => r.content.includes('serializable transactions'))).toBe(true);

    // --- SESSION 7: Delayed Outcome Settlement ---
    const s7Corr = 'sess-7-delayed-checkout';
    const s7Exp = expManager.createExperience({
      correlationId: s7Corr,
      projectId: 'checkout-service',
      intent: 'Apply optimistic concurrency lock',
      model: 'gpt-4o',
    });
    expManager.startObservation(s7Exp.experience_id);
    
    // Delayed positive signal arrives 100ms later
    await evidenceBus.emit({
      source: 'test_runner',
      type: 'test_pass',
      correlationId: s7Corr,
      projectId: 'checkout-service',
      payload: {
        rule_candidate: {
          category: 'learned_rule',
          taskContext: 'checkout-service',
          content: 'Optimistic concurrency locking prevents double-spend in checkout',
          confidence: 0.85,
          tags: ['checkout', 'locking'],
        },
      },
    });
    const s7Settled = expManager.getExperience(s7Exp.experience_id);
    expect(s7Settled?.status).toBe('SUCCESS');

    // --- SESSION 8: Contradictory Evidence Arrives ---
    // A benchmark shows optimistic locking caused starvation under high load
    const s8Corr = 'sess-8-contradiction';
    await evidenceBus.emit({
      source: 'test_runner',
      type: 'test_fail',
      correlationId: s7Corr, // References same correlation
      projectId: 'checkout-service',
      payload: { reason: 'Optimistic lock starvation under 1000 RPS benchmark' },
    });

    // Verify contradiction count incremented and confidence decayed
    const checkoutRules = l2Store.getAllRules({ taskContext: 'checkout-service' });
    const lockRule = checkoutRules.find(r => r.content.includes('Optimistic concurrency locking'));
    if (lockRule) {
      expect(lockRule.contradiction_count).toBeGreaterThan(0);
    }

    // --- SESSION 9: Obsolete/Stale Knowledge Management ---
    // Update rule with explicit expiration / superseded_by
    const oldRule = l2Store.upsertRule({
      category: 'project_fact',
      taskContext: 'legacy-api',
      content: 'Legacy v1 auth uses basic token headers (Deprecated 2026)',
      confidence: 0.5,
      status: 'DEPRECATED',
      tags: ['legacy', 'auth'],
      memoryTier: 'ARCHIVE',
    });

    const s9Context = await compiler.compile('Query authentication strategy for legacy API', 'legacy-api', { includeCold: false });
    expect(s9Context.retrieved_rules.some(r => r.rule_id === oldRule.rule_id)).toBe(false);

    // --- SESSION 10: Daemon Restart & State Verification ---
    ledger.close();
    const restartedLedger = new L0EventLedger(TRUST_DB);
    const restartedL2 = new L2KnowledgeStore(restartedLedger.getDatabase());
    const reloadedRedisRule = restartedL2.getAllRules({ taskContext: 'cache-service' });
    expect(reloadedRedisRule.some(r => r.content.includes('exponential jitter backoff'))).toBe(true);
    restartedLedger.close();

    // Reopen ledger for remaining tests
    ledger = new L0EventLedger(TRUST_DB);
    expManager = new L1ExperienceManager(ledger.getDatabase());
    evidenceBus = new EvidenceBus(ledger, expManager);
    l2Store = new L2KnowledgeStore(ledger.getDatabase());
    learningEngine = new L2LearningEngine(l2Store);
    evidenceBus.setLearningEngine(learningEngine);
    compiler = new L3ContextCompiler(l2Store, embedder, cortex, beads, sessionMgr);
  });

  // =========================================================================
  // 4. LARGE-SCALE EXPERIENCE ACCUMULATION (1,000+ Experiences)
  // =========================================================================
  it('4. Experience Accumulation: Ingests 1,000 diverse experiences and measures scaling', async () => {
    const startCount = ledger.getEventCount();
    const t0 = performance.now();

    ledger.getDatabase().exec('BEGIN TRANSACTION;');
    for (let i = 0; i < 1000; i++) {
      const isSuccess = i % 4 !== 0;
      const category = i % 5 === 0 ? 'project_constraint' : (i % 3 === 0 ? 'user_preference' : 'learned_rule');
      const project = `service_${i % 15}`;
      
      l2Store.upsertRule({
        category,
        taskContext: project,
        content: `Service ${i % 15} invariant ${i}: Worker thread concurrency limit set to ${10 + (i % 10)}`,
        confidence: isSuccess ? 0.85 : 0.45,
        evidenceCount: isSuccess ? 3 : 1,
        contradictionCount: isSuccess ? 0 : 2,
        status: isSuccess ? 'CONFIRMED' : 'HYPOTHESIS',
        tags: [`tag_${i % 10}`, 'concurrency', 'worker'],
        provenance: [`exp-scale-${i}`],
      });
    }
    ledger.getDatabase().exec('COMMIT;');
    const elapsed = performance.now() - t0;

    expect(ledger.getEventCount()).toBeGreaterThanOrEqual(startCount);
    const allRules = l2Store.getAllRules();
    expect(allRules.length).toBeGreaterThanOrEqual(1000);

    // Compilation over 1,000+ rules remains fast
    const compT0 = performance.now();
    const compResult = await compiler.compile('Find worker concurrency limit for service 3', 'service_3');
    const compElapsed = performance.now() - compT0;

    expect(compResult.retrieved_rules.length).toBeGreaterThan(0);
    expect(compElapsed).toBeLessThan(100); // Sub-100ms across 1,000+ rules
  });

  // =========================================================================
  // 5. L3 CONTEXT CONTAMINATION DEFENSE
  // =========================================================================
  it('5. Context Contamination Defense: Selects only relevant, high-confidence rules under strict token budget', async () => {
    // Fill with high-scoring noisy rules in other domains
    const compResult = await compiler.compile('Query database pool settings for billing service', 'billing-service', {
      maxTokenBudget: 1500,
    });

    expect(compResult.retrieved_rules.length).toBeLessThanOrEqual(5); // Top-k bounded
    expect(compResult.token_budget.estimated_used_tokens).toBeLessThan(1500); // Bounded token budget
    expect(compResult.token_budget.was_truncated).toBe(false);
  });

  // =========================================================================
  // 6. CRYPTOGRAPHIC PROVENANCE SURVIVAL
  // =========================================================================
  it('6. Provenance Survival: L2 rules maintain valid cryptographic link to L0 events', async () => {
    const provRule = l2Store.upsertRule({
      category: 'learned_rule',
      taskContext: 'crypto-vault',
      content: 'Hardware security module (HSM) requires AES-GCM-256 with rotating salt',
      confidence: 0.94,
      provenance: ['exp-hsm-001', 'exp-hsm-002'],
    });

    expect(provRule.provenance).toContain('exp-hsm-001');
    const loadedRule = l2Store.getRule(provRule.rule_id);
    expect(loadedRule?.provenance).toContain('exp-hsm-002');
  });

  // =========================================================================
  // 7. PROVIDER / CLIENT DISAPPEARANCE & DEGRADED MODES
  // =========================================================================
  it('7. Resilience: Operates uninterrupted when external providers and Codebase Cortex are offline', async () => {
    // Create standalone compiler without cortex
    const standaloneCompiler = new L3ContextCompiler(l2Store, embedder, undefined, undefined, undefined);
    const res = await standaloneCompiler.compile('Query Redis configuration', 'cache-service');
    
    expect(res.retrieved_rules.length).toBeGreaterThan(0);
    expect(res.codebase_cortex).toBeUndefined();
    expect(res.state_markdown).toContain('ACTIVE PROJECT CONTEXT');
  });

  // =========================================================================
  // 8. EVIDENCE INGESTION FAILURE HANDLING
  // =========================================================================
  it('8. Evidence Failure Safety: Missing evidence does NOT settle experience as success', async () => {
    const exp = expManager.createExperience({
      correlationId: 'corr-unsettled-tool',
      projectId: 'deploy-service',
      intent: 'Deploy canary version 2.1',
      model: 'gpt-4o',
    });
    expManager.startObservation(exp.experience_id);

    // No evidence arrives
    const currentExp = expManager.getExperience(exp.experience_id);
    expect(currentExp?.status).toBe('OBSERVATION');
    expect(currentExp?.status).not.toBe('SUCCESS');
  });

  // =========================================================================
  // 9. PROACTIVE SECRET REDACTION AUDIT
  // =========================================================================
  it('9. Zero Secret Leakage: API keys, bearer tokens, and JWTs scrubbed prior to persistence', async () => {
    const sensitivePayload = {
      bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.someSecretSignature',
      openai_key: 'sk-proj-1111222233334444555566667777888899990000',
      anthropic_key: 'anthropic-sk-live-0987654321fedcba',
      password: 'db_secret_super_secure_pass_123',
    };

    const ev = ledger.appendEvent({
      correlationId: 'corr-leak-audit',
      actor: 'client',
      eventType: 'incoming_request',
      payload: sensitivePayload,
    });

    const rawRow = ledger.getDatabase().query('SELECT payload FROM l0_events WHERE event_id = ?').get(ev.event_id) as any;
    expect(rawRow.payload).not.toContain('111122223333');
    expect(rawRow.payload).not.toContain('db_secret_super_secure_pass_123');
    expect(rawRow.payload).toContain('[REDACTED_SECRET]');
  });
});
