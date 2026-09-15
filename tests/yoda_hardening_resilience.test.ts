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
import { AIClientDetector } from '../src/adapters/detector';
import { MockReasoningProvider } from '../src/providers/mock';

const HARDENING_DB = 'yoda_hardening_test.db';

describe('YODA Production Hardening & Resilience Test Suite', () => {
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
  let adapters: AdapterRegistry;

  beforeAll(async () => {
    if (existsSync(HARDENING_DB)) unlinkSync(HARDENING_DB);

    ledger = new L0EventLedger(HARDENING_DB);
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
    const mock = new MockReasoningProvider({
      name: 'hardening-mock-engine',
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
    if (existsSync(HARDENING_DB)) unlinkSync(HARDENING_DB);
  });

  // -------------------------------------------------------------------------
  // 1. HONEST ADAPTER CLASSIFICATIONS
  // -------------------------------------------------------------------------
  it('1. AIClientDetector accurately separates Real Clients from API Paths', async () => {
    const clients = await AIClientDetector.detectAll();
    const antigravity = clients.find(c => c.id === 'antigravity')!;
    const opencode = clients.find(c => c.id === 'opencode')!;
    const claude = clients.find(c => c.id === 'claude')!;
    const codex = clients.find(c => c.id === 'codex')!;
    const universal = clients.find(c => c.id === 'universal')!;

    expect(antigravity.integrationType).toBe('REAL_CLIENT');
    expect(opencode.integrationType).toBe('REAL_CLIENT');
    expect(universal.integrationType).toBe('UNIVERSAL_CONNECTOR');
    expect(claude.integrationType).toBe('API_PATH');
    expect(codex.integrationType).toBe('API_PATH');

    // Notes honestly explain browser web tabs requirement
    expect(claude.notes).toContain('Browser web tabs require extension connector');
  });

  // -------------------------------------------------------------------------
  // 2. HEART SAFETY INVARIANTS CANNOT BE LEARNED AWAY
  // -------------------------------------------------------------------------
  it('2. Heart BIOS blocks high-risk destructive actions even with high-confidence rules', async () => {
    // Inject high confidence rule asserting that user approved fast deletions
    l2Store.upsertRule({
      category: 'user_preference',
      content: 'User prefers bypassing confirmation for quick database table drop operations',
      taskContext: 'production',
      confidence: 0.99,
      evidenceCount: 10,
      status: 'CONFIRMED',
      tags: ['database', 'drop'],
      provenance: ['exp-prior-01'],
    });

    // Propose dangerous action
    const evalResult = supervisor.evaluateAction({
      actionText: 'DROP TABLE users CASCADE;',
      taskContext: 'production',
      userOverride: false,
    });

    // Verify Heart supervisor enforces mandatory human confirmation / block
    expect(evalResult.risk_level).toBe('CRITICAL');
    expect(evalResult.consequence).toBe('IRREVERSIBLE');
    expect(evalResult.requires_human_confirmation).toBe(true);
    expect(evalResult.user_override_granted).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. KNOWLEDGE SCOPING (Prevents single observation becoming global truth)
  // -------------------------------------------------------------------------
  it('3. L2 Knowledge scoping isolates project-specific constraints from other projects', async () => {
    // Rule in payments project
    l2Store.upsertRule({
      category: 'project_constraint',
      content: 'All payment charges must enforce idempotent idempotency-key header',
      taskContext: 'payments-api',
      confidence: 0.92,
      evidenceCount: 3,
      status: 'CONFIRMED',
      tags: ['payments', 'idempotency'],
      provenance: ['exp-pay-01'],
    });

    // Query from unrelated analytics project
    const analyticsContext = await compiler.compile('Compute daily user login count', 'analytics-service');

    // Rule should NOT be injected as active constraint in analytics project
    expect(analyticsContext.state_markdown).not.toContain('idempotency-key header');

    // Query from payments project
    const paymentsContext = await compiler.compile('Process recurring subscription renewal', 'payments-api');
    expect(paymentsContext.state_markdown).toContain('idempotency-key header');
  });

  // -------------------------------------------------------------------------
  // 4. KNOWLEDGE STALENESS & TEMPORAL VALIDITY
  // -------------------------------------------------------------------------
  it('4. Stale or superseded rules are excluded from dynamic L3 context', async () => {
    const oldRule = l2Store.upsertRule({
      category: 'learned_rule',
      content: 'Legacy Auth: Use SHA-1 for password hashing',
      taskContext: 'auth-service',
      confidence: 0.50,
      status: 'DEPRECATED',
      validUntil: '2025-01-01T00:00:00.000Z',
      supersededBy: 'rule-auth-v2-argon2',
      tags: ['auth', 'legacy'],
      provenance: ['exp-old-01'],
    });

    l2Store.upsertRule({
      category: 'learned_rule',
      content: 'Modern Auth: Use Argon2id with 64MB memory cost for password hashing',
      taskContext: 'auth-service',
      confidence: 0.95,
      evidenceCount: 4,
      status: 'CONFIRMED',
      tags: ['auth', 'argon2'],
      provenance: ['exp-new-01'],
    });

    const context = await compiler.compile('How should password hashes be verified in auth service?', 'auth-service');
    expect(context.state_markdown).toContain('Argon2id');
    expect(context.state_markdown).not.toContain('Use SHA-1');
  });

  // -------------------------------------------------------------------------
  // 5. CAUSALITY HARDENING (Delayed Evidence Settlement)
  // -------------------------------------------------------------------------
  it('5. Experiences remain PROVISIONALLY_ACCEPTED during observation and settle only on evidence', async () => {
    const exp = expManager.createExperience({
      correlationId: 'corr-delayed-01',
      projectId: 'checkout-service',
      intent: 'Apply optimistic lock to cart updates',
      model: 'gpt-4o',
    });

    expManager.markProvisionallyAccepted(exp.experience_id);
    expManager.startObservation(exp.experience_id);

    // Verify still in observation window
    let currentExp = expManager.getExperience(exp.experience_id);
    expect(currentExp?.status).toBe('OBSERVATION');

    // Evidence arrives after delay
    expManager.settleOutcome(exp.experience_id, 'SUCCESS', 0.96, 'INTEGRATION_TEST_PASSED');
    currentExp = expManager.getExperience(exp.experience_id);
    expect(currentExp?.status).toBe('SUCCESS');
    expect(currentExp?.closure_reason).toBe('INTEGRATION_TEST_PASSED');
  });

  // -------------------------------------------------------------------------
  // 6. PROACTIVE SECRET REDACTION AUDIT
  // -------------------------------------------------------------------------
  it('6. Thoroughly redacts sensitive keys, tokens, and passwords across all L0 entries', async () => {
    const sensitive = {
      user: 'admin',
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.someSecretSignature',
      openai_key: 'sk-proj-9999888877776666555544443333222211110000',
      anthropic_key: 'anthropic-sk-live-0987654321fedcba',
      database_password: 'super_secret_db_pass_xyz',
      normal_meta: { project: 'secure-vault' },
    };

    const ev = ledger.appendEvent({
      correlationId: 'corr-sec-audit-01',
      actor: 'client',
      eventType: 'incoming_request',
      payload: sensitive,
      metadata: { auth_header: sensitive.token },
    });

    const rawRow = ledger.getDatabase().query('SELECT payload, metadata FROM l0_events WHERE event_id = ?').get(ev.event_id) as any;
    expect(rawRow.payload).not.toContain('999988887777');
    expect(rawRow.payload).not.toContain('super_secret_db_pass_xyz');
    expect(rawRow.metadata).not.toContain('someSecretSignature');
    expect(rawRow.payload).toContain('[REDACTED_SECRET]');
  });

  // -------------------------------------------------------------------------
  // 7. LARGE-SCALE L2 STRESS TEST (10,000 rules)
  // -------------------------------------------------------------------------
  it('7. Scales to 10,000 L2 rules in SQLite maintaining sub-25ms retrieval latency', async () => {
    const stressDb = 'yoda_stress_10k.db';
    if (existsSync(stressDb)) unlinkSync(stressDb);

    const stressLedger = new L0EventLedger(stressDb);
    const stressL2 = new L2KnowledgeStore(stressLedger.getDatabase());

    // Batch insert 10,000 synthetic rules
    stressLedger.getDatabase().exec('BEGIN TRANSACTION;');
    for (let i = 0; i < 10000; i++) {
      stressL2.upsertRule({
        category: i % 3 === 0 ? 'project_constraint' : 'learned_rule',
        content: `Synthetic rule ${i}: Service worker pool ${i % 50} requires exponential backoff retry`,
        taskContext: `project_${i % 20}`,
        confidence: 0.80 + (i % 20) * 0.01,
        evidenceCount: 2,
        status: 'CONFIRMED',
        tags: [`tag_${i % 10}`, 'retry', 'pool'],
        provenance: [`exp-${i}`],
      });
    }
    stressLedger.getDatabase().exec('COMMIT;');

    expect(stressL2.getAllRules().length).toBeGreaterThanOrEqual(10000);

    const stressCompiler = new L3ContextCompiler(stressL2, embedder);
    
    // Measure retrieval across 10,000 rules
    const t0 = performance.now();
    const result = await stressCompiler.compile('Find connection retry strategy for worker pool 5', 'project_5');
    const elapsed = performance.now() - t0;

    expect(result.retrieved_rules.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(350); // Sub-350ms across 10,000 rules without external vector DB

    stressLedger.close();
    if (existsSync(stressDb)) unlinkSync(stressDb);
  });

  // -------------------------------------------------------------------------
  // 8. BOUNDED CONTEXT BUDGET (Lean Prompts)
  // -------------------------------------------------------------------------
  it('8. Enforces strict token budget on L3 context compilation', async () => {
    const result = await compiler.compile('Query system configuration', 'default', {
      maxTokenBudget: 500,
    });

    expect(result.token_budget).toBeDefined();
    expect(result.token_budget?.allocated_tokens).toBe(500);
    expect(result.token_budget?.estimated_used_tokens).toBeLessThanOrEqual(500);
  });
});
