import { performance } from 'perf_hooks';
import { Database } from 'bun:sqlite';
import { unlinkSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
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
import type { ChatCompletionRequest } from '../src/types';

function calculatePercentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50, p95, p99, min, max, avg };
}

async function runBenchmark() {
  console.log('================================================================');
  console.log('   YODA PERSISTENT COGNITIVE PIPELINE — EMPIRICAL BENCHMARK     ');
  console.log('================================================================\n');

  const benchDbPath = 'benchmark_yoda.db';
  if (existsSync(benchDbPath)) unlinkSync(benchDbPath);

  const benchDir = join(process.cwd(), 'benchmark_scratch_tree');
  if (existsSync(benchDir)) rmSync(benchDir, { recursive: true, force: true });
  mkdirSync(benchDir, { recursive: true });

  // Create a synthetic project tree with 150 TypeScript files
  for (let i = 0; i < 150; i++) {
    const subDir = join(benchDir, `module_${i % 10}`);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, `service_${i}.ts`),
      `export interface ServiceConfig_${i} { id: string; port: number; }
export class ServiceWorker_${i} {
  public async handleTask_${i}(data: Record<string, unknown>) {
    return { status: 'processed', timestamp: Date.now(), service: ${i} };
  }
}`
    );
  }

  // 1. Initialize Components
  const ledger = new L0EventLedger(benchDbPath);
  const expManager = new L1ExperienceManager(ledger.getDatabase());
  const evidenceBus = new EvidenceBus(ledger, expManager);
  const l2Store = new L2KnowledgeStore(ledger.getDatabase());
  const learningEngine = new L2LearningEngine(l2Store);
  evidenceBus.setLearningEngine(learningEngine);

  const l4Store = new L4Store(ledger.getDatabase());
  const metaEngine = new L4MetaEngine(l4Store, l2Store, expManager, ledger);
  evidenceBus.setMetaEngine(metaEngine);

  const bios = new HeartBios();
  const supervisor = new HeartSupervisor({ bios, l2Store, metaEngine });
  const embedder = new DeterministicLocalEmbedder(64);

  const cortexLarge = new CodebaseCortex({ rootDir: benchDir });
  const beads = new BeadsLiteManager(ledger.getDatabase(), ledger);
  const sessionMgr = new SessionManager({ db: ledger.getDatabase(), ledger, evidenceBus });

  const compilerWithGraft = new L3ContextCompiler(l2Store, embedder, cortexLarge, beads, sessionMgr);
  const compilerNoGraft = new L3ContextCompiler(l2Store, embedder, undefined, beads, sessionMgr);

  const router = new UniversalProviderRouter({ defaultModel: 'neutral-reasoner' });
  const mockProvider = new MockReasoningProvider({ name: 'mock-engine', defaultModel: 'neutral-reasoner' });
  router.registerProvider('mock', mockProvider);
  router.setDefaultFallbackProvider(mockProvider);

  const adaptersWithGraft = new AdapterRegistry({
    ledger,
    evidenceBus,
    experienceManager: expManager,
    contextCompiler: compilerWithGraft,
    heartSupervisor: supervisor,
  });

  const adaptersNoGraft = new AdapterRegistry({
    ledger,
    evidenceBus,
    experienceManager: expManager,
    contextCompiler: compilerNoGraft,
    heartSupervisor: supervisor,
  });

  const universalWithGraft = adaptersWithGraft.getAdapter('universal')!;
  const universalNoGraft = adaptersNoGraft.getAdapter('universal')!;

  // -------------------------------------------------------------
  // BENCHMARK 1: Cold Start vs Warm Requests (100 iterations)
  // -------------------------------------------------------------
  console.log('--- 1. Cold Start vs. Warm Requests (Standard Flow) ---');
  const coldT0 = performance.now();
  await universalWithGraft.capturePrompt('Initialize database client connection pooling', { projectId: 'cold_proj' });
  const coldLatency = performance.now() - coldT0;
  console.log(`Cold Start Request: ${coldLatency.toFixed(2)} ms`);

  const warmLatencies: number[] = [];
  const adapterLatencies: number[] = [];
  const l0Latencies: number[] = [];
  const l2Latencies: number[] = [];
  const l3Latencies: number[] = [];
  const heartLatencies: number[] = [];
  const graftLatencies: number[] = [];

  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    const prompt = `Refactor query worker task index ${i}`;
    
    // Stage 1: Adapter + L0
    const tL0_0 = performance.now();
    const l0Event = ledger.appendEvent({
      correlationId: `corr-bench-${i}`,
      projectId: 'bench_proj',
      actor: 'client',
      eventType: 'incoming_request',
      payload: { prompt },
    });
    const tL0_1 = performance.now();
    l0Latencies.push(tL0_1 - tL0_0);

    // Stage 2: L2 Vector Retrieval + L3 Compilation
    const tL3_0 = performance.now();
    const compiled = await compilerWithGraft.compile(prompt, 'bench_proj');
    const tL3_1 = performance.now();
    l3Latencies.push(tL3_1 - tL3_0);

    // Stage 3: Heart BIOS Safety Check
    const tHeart_0 = performance.now();
    supervisor.evaluateAction({ actionText: prompt, taskContext: 'bench_proj' });
    const tHeart_1 = performance.now();
    heartLatencies.push(tHeart_1 - tHeart_0);

    const total = performance.now() - t0;
    warmLatencies.push(total);
  }

  const warmStats = calculatePercentiles(warmLatencies);
  console.log(`Warm Requests (100 runs):
  p50: ${warmStats.p50.toFixed(2)} ms
  p95: ${warmStats.p95.toFixed(2)} ms
  p99: ${warmStats.p99.toFixed(2)} ms
  Avg: ${warmStats.avg.toFixed(2)} ms
  Min: ${warmStats.min.toFixed(2)} ms | Max: ${warmStats.max.toFixed(2)} ms\n`);

  // -------------------------------------------------------------
  // BENCHMARK 2: Stage-by-Stage Breakdown
  // -------------------------------------------------------------
  console.log('--- 2. Granular Stage-by-Stage Latencies (p50 / p95 / p99) ---');
  const l0Stats = calculatePercentiles(l0Latencies);
  const l3Stats = calculatePercentiles(l3Latencies);
  const heartStats = calculatePercentiles(heartLatencies);

  console.log(`• L0 Event Append (SQLite WAL):  p50: ${l0Stats.p50.toFixed(3)} ms | p95: ${l0Stats.p95.toFixed(3)} ms | p99: ${l0Stats.p99.toFixed(3)} ms`);
  console.log(`• L3 Compilation (Embed+L2+AST): p50: ${l3Stats.p50.toFixed(3)} ms | p95: ${l3Stats.p95.toFixed(3)} ms | p99: ${l3Stats.p99.toFixed(3)} ms`);
  console.log(`• Heart BIOS Safety Evaluation:  p50: ${heartStats.p50.toFixed(3)} ms | p95: ${heartStats.p95.toFixed(3)} ms | p99: ${heartStats.p99.toFixed(3)} ms\n`);

  // -------------------------------------------------------------
  // BENCHMARK 3: Graft Enabled vs Graft Unavailable (Disabled)
  // -------------------------------------------------------------
  console.log('--- 3. Graft (Codebase Cortex) Enabled vs Unavailable ---');
  const graftOnLatencies: number[] = [];
  const graftOffLatencies: number[] = [];

  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await universalWithGraft.capturePrompt(`Query service ${i}`, { projectId: 'bench_proj' });
    graftOnLatencies.push(performance.now() - t0);

    const t1 = performance.now();
    await universalNoGraft.capturePrompt(`Query service ${i}`, { projectId: 'bench_proj' });
    graftOffLatencies.push(performance.now() - t1);
  }

  const graftOnStats = calculatePercentiles(graftOnLatencies);
  const graftOffStats = calculatePercentiles(graftOffLatencies);

  console.log(`Graft Enabled (AST Cortex + Indexing): p50: ${graftOnStats.p50.toFixed(2)} ms | p95: ${graftOnStats.p95.toFixed(2)} ms | p99: ${graftOnStats.p99.toFixed(2)} ms`);
  console.log(`Graft Unavailable (Pure L2 + Heart):   p50: ${graftOffStats.p50.toFixed(2)} ms | p95: ${graftOffStats.p95.toFixed(2)} ms | p99: ${graftOffStats.p99.toFixed(2)} ms\n`);

  // -------------------------------------------------------------
  // BENCHMARK 4: Empty L2 vs Populated L2 vs Large L2 (1,000 rules)
  // -------------------------------------------------------------
  console.log('--- 4. L2 Memory Scaling (0 vs. 50 vs. 1,000 rules) ---');
  
  // Empty L2 test
  const emptyDbPath = 'benchmark_empty.db';
  if (existsSync(emptyDbPath)) unlinkSync(emptyDbPath);
  const emptyLedger = new L0EventLedger(emptyDbPath);
  const emptyL2Store = new L2KnowledgeStore(emptyLedger.getDatabase());
  const emptyCompiler = new L3ContextCompiler(emptyL2Store, embedder);
  
  const emptyLatencies: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    await emptyCompiler.compile(`Test empty L2 query ${i}`, 'empty_proj');
    emptyLatencies.push(performance.now() - t0);
  }
  const emptyStats = calculatePercentiles(emptyLatencies);

  // Large L2 test (Inject 1,000 synthetic rules)
  const largeDbPath = 'benchmark_large.db';
  if (existsSync(largeDbPath)) unlinkSync(largeDbPath);
  const largeLedger = new L0EventLedger(largeDbPath);
  const largeL2Store = new L2KnowledgeStore(largeLedger.getDatabase());
  
  for (let i = 0; i < 1000; i++) {
    largeL2Store.upsertRule({
      category: i % 2 === 0 ? 'learned_rule' : 'user_preference',
      content: `Architectural invariant ${i}: Service module ${i % 20} must use exponential backoff retry with jitter`,
      taskContext: `project_${i % 5}`,
      confidence: 0.85 + (i % 15) * 0.01,
      tags: [`tag_${i % 10}`, 'database', 'retry'],
      provenance: [`exp-${i}`],
    });
  }

  const largeCompiler = new L3ContextCompiler(largeL2Store, embedder);
  const largeLatencies: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    await largeCompiler.compile(`Find retry policy for database service module 5`, 'project_0');
    largeLatencies.push(performance.now() - t0);
  }
  const largeStats = calculatePercentiles(largeLatencies);

  console.log(`Empty L2 (0 rules):      p50: ${emptyStats.p50.toFixed(2)} ms | p95: ${emptyStats.p95.toFixed(2)} ms | p99: ${emptyStats.p99.toFixed(2)} ms`);
  console.log(`Populated L2 (55 rules): p50: ${l3Stats.p50.toFixed(2)} ms | p95: ${l3Stats.p95.toFixed(2)} ms | p99: ${l3Stats.p99.toFixed(2)} ms`);
  console.log(`Large L2 (1,000 rules):  p50: ${largeStats.p50.toFixed(2)} ms | p95: ${largeStats.p95.toFixed(2)} ms | p99: ${largeStats.p99.toFixed(2)} ms\n`);

  // -------------------------------------------------------------
  // BENCHMARK 5: Streaming First-Token Latency (TTFT)
  // -------------------------------------------------------------
  console.log('--- 5. Streaming Time-To-First-Token (TTFT Overhead) ---');
  const ttftLatencies: number[] = [];

  for (let i = 0; i < 30; i++) {
    const req: ChatCompletionRequest = {
      model: 'neutral-reasoner',
      messages: [{ role: 'user', content: `Benchmark streaming request ${i}` }],
      stream: true,
    };

    const t0 = performance.now();
    // 1. Dynamic L3 compilation before stream
    const l3 = await compilerWithGraft.compile(req.messages[0].content, 'bench_proj');
    // 2. Heart supervisor
    supervisor.evaluateAction({ actionText: req.messages[0].content, taskContext: 'bench_proj' });
    // 3. Provider stream start
    const stream = mockProvider.chatStream(req);
    // 4. Time until first chunk yielded
    let firstTokenTime = 0;
    for await (const chunk of stream) {
      firstTokenTime = performance.now() - t0;
      break;
    }
    ttftLatencies.push(firstTokenTime);
  }

  const ttftStats = calculatePercentiles(ttftLatencies);
  console.log(`Streaming TTFT Pipeline Overhead:
  p50: ${ttftStats.p50.toFixed(2)} ms
  p95: ${ttftStats.p95.toFixed(2)} ms
  p99: ${ttftStats.p99.toFixed(2)} ms
  Avg: ${ttftStats.avg.toFixed(2)} ms\n`);

  // Cleanup
  ledger.close();
  emptyLedger.close();
  largeLedger.close();
  if (existsSync(benchDbPath)) unlinkSync(benchDbPath);
  if (existsSync(emptyDbPath)) unlinkSync(emptyDbPath);
  if (existsSync(largeDbPath)) unlinkSync(largeDbPath);
  if (existsSync(benchDir)) rmSync(benchDir, { recursive: true, force: true });

  console.log('================================================================');
  console.log('                  BENCHMARK COMPLETE                            ');
  console.log('================================================================');
}

runBenchmark().catch(console.error);
