import type { CodebaseCortexContext, L2KnowledgeItem, L3CompiledContext, L3TokenBudgetInfo } from '../types';
import { cosineSimilarity, DeterministicLocalEmbedder, type EmbeddingEngine } from './embeddings';
import { MockL2KnowledgeStore } from './mock_l2';
import type { CodebaseCortex } from '../cortex/codebase_cortex';
import type { BeadsLiteManager } from '../beads/beads';

export interface IL2KnowledgeStore {
  getAllRules(filter?: any): L2KnowledgeItem[];
  getRule?(ruleId: string): L2KnowledgeItem | null;
  getStrategiesByTaskClass?(taskClass: string): any[];
  getModelExperience?(model: string, taskClass: string): any;
  isTemporallyValid?(rule: L2KnowledgeItem, atTimestamp?: string): boolean;
}

export interface CompilerOptions {
  topK?: number;
  minSimilarity?: number;
  timeoutMs?: number;
  failOpenOnError?: boolean;
  modelName?: string;
  includeCold?: boolean;
  maxTokenBudget?: number;
  includeCodebaseCortex?: boolean;
  includeBeads?: boolean;
  includeSession?: boolean;
}

export class L3ContextCompiler {
  private l2Store: IL2KnowledgeStore;
  private embedder: EmbeddingEngine;
  private cortex?: CodebaseCortex;
  private beadsManager?: BeadsLiteManager;
  private sessionManager?: any;

  constructor(
    l2Store?: IL2KnowledgeStore,
    embedder?: EmbeddingEngine,
    cortex?: CodebaseCortex,
    beadsManager?: BeadsLiteManager,
    sessionManager?: any
  ) {
    this.l2Store = l2Store || new MockL2KnowledgeStore();
    this.embedder = embedder || new DeterministicLocalEmbedder();
    this.cortex = cortex;
    this.beadsManager = beadsManager;
    this.sessionManager = sessionManager;
  }

  public setCodebaseCortex(cortex: CodebaseCortex): void {
    this.cortex = cortex;
  }

  public setBeadsManager(beadsManager: BeadsLiteManager): void {
    this.beadsManager = beadsManager;
  }

  public setSessionManager(sessionManager: any): void {
    this.sessionManager = sessionManager;
  }

  public async compile(
    prompt: string,
    projectId: string = 'default',
    options: CompilerOptions = {}
  ): Promise<L3CompiledContext> {
    const startMs = performance.now();
    const topK = options.topK ?? 2;
    const minSim = options.minSimilarity ?? 0.25;  // raised: filter low-signal rules
    const failOpen = options.failOpenOnError ?? true;
    const includeCold = options.includeCold ?? false;
    const maxBudget = options.maxTokenBudget ?? 300;  // ~5% of typical context
    const includeCortex = options.includeCodebaseCortex ?? false;  // off by default

    try {
      // 1. Preprocess & Local/Ollama Hybrid Embedding
      const queryVector = await this.embedder.embed(prompt, options.timeoutMs);

      // 2. Vector Retrieval against L2 Candidates
      const allRules = this.l2Store.getAllRules();
      const scored: Array<{ rule: L2KnowledgeItem; score: number }> = [];

      for (const rule of allRules) {
        if (!rule.vector || rule.vector.length === 0) continue;
        if (!includeCold && (rule.memory_tier === 'ARCHIVE' || rule.memory_tier === 'COLD' || rule.status === 'DEPRECATED')) {
          continue;
        }
        if (this.l2Store.isTemporallyValid && !this.l2Store.isTemporallyValid(rule)) {
          continue;
        }

        let ruleVector = rule.vector;
        if (ruleVector.length !== queryVector.length) {
          // Automatic on-the-fly dimension alignment migration
          try {
            ruleVector = await this.embedder.embed(rule.content, options.timeoutMs);
            if ((this.l2Store as any).updateRuleVector) {
              (this.l2Store as any).updateRuleVector(rule.rule_id, ruleVector);
            }
          } catch {
            // If re-embedding fails, skip rather than crash
            continue;
          }
        }

        const sim = cosineSimilarity(queryVector, ruleVector);
        let effectiveScore = sim;
        // Project Scoping Boost: prioritize current project context
        if (rule.task_context && projectId && projectId !== 'default') {
          if (rule.task_context.toLowerCase() === projectId.toLowerCase()) {
            effectiveScore += 0.35; // direct workspace match
          } else if (rule.task_context.toLowerCase() !== 'global' && rule.task_context.toLowerCase() !== 'aathma-import' && rule.task_context.toLowerCase() !== 'architecture') {
            effectiveScore -= 0.15; // penalize mismatching foreign project rules
          }
        }
        if (effectiveScore >= minSim) {
          scored.push({ rule, score: effectiveScore });
        }
      }

      // 3. Deterministic Ranking (by score descending, tie-break by confidence, then rule_id)
      scored.sort((a, b) => {
        if (Math.abs(b.score - a.score) > 0.0001) {
          return b.score - a.score;
        }
        if (Math.abs(b.rule.confidence - a.rule.confidence) > 0.0001) {
          return b.rule.confidence - a.rule.confidence;
        }
        return a.rule.rule_id.localeCompare(b.rule.rule_id);
      });

      const selected = scored.slice(0, topK).map((s) => s.rule);

      // 4. Codebase Cortex Synthesis (ADR-020 Dual-Cortex)
      let cortexContext: CodebaseCortexContext | undefined;
      let cortexMarkdown = '';
      if (this.cortex && includeCortex) {
        try {
          cortexContext = this.cortex.queryCortex(prompt, { maxExcerpts: 4 });
          cortexMarkdown = this.cortex.formatCortexMarkdown(cortexContext);
        } catch (cortexErr) {
          console.warn('[L3Compiler] Codebase cortex query failed open:', cortexErr);
        }
      }

      // 4b. Beads-Lite Cross-Agent Task Continuity
      let beadsMarkdown = '';
      if (this.beadsManager && (options.includeBeads ?? true)) {
        try {
          const activeBeads = this.beadsManager.getActiveBeads(projectId, options.modelName);
          beadsMarkdown = this.beadsManager.formatBeadsMarkdown(activeBeads);
        } catch {}
      }

      // 4c. Real-Time Live Session State
      let sessionMarkdown = '';
      if (this.sessionManager && (options.includeSession ?? true)) {
        try {
          const active = this.sessionManager.getActiveSession();
          if (active) {
            const sLines: string[] = ['\n### ACTIVE LIVE SESSION'];
            sLines.push(`- Session ID: ${active.session_id}`);
            if (active.active_task) sLines.push(`- Current Task: ${active.active_task}`);
            sLines.push(`- Observation: ${this.sessionManager.isObserving() ? 'ACTIVE' : 'PAUSED'}`);
            sLines.push(`- Active Sources: ${this.sessionManager.getActiveSources().join(', ')}`);
            sessionMarkdown = sLines.join('\n');
          }
        } catch {}
      }

      // 5. Deterministic Assembly into Dual-Cortex & Task Envelope
      const rawMarkdown = this.assembleMarkdown(selected, projectId, cortexMarkdown, beadsMarkdown, sessionMarkdown);
      const estimatedTokens = estimateTokenCount(rawMarkdown);

      const tokenBudget: L3TokenBudgetInfo = {
        allocated_tokens: maxBudget,
        estimated_used_tokens: Math.min(estimatedTokens, maxBudget),
        was_truncated: estimatedTokens > maxBudget,
      };

      const finalMarkdown = tokenBudget.was_truncated
        ? rawMarkdown.substring(0, Math.floor(maxBudget * 3.5)) + '\n... [Context capped at token budget]'
        : rawMarkdown;

      const latencyMs = performance.now() - startMs;

      return {
        state_markdown: finalMarkdown,
        retrieved_rules: selected,
        codebase_cortex: cortexContext,
        token_budget: tokenBudget,
        compilation_latency_ms: Math.round(latencyMs * 100) / 100,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      const latencyMs = performance.now() - startMs;
      if (!failOpen) {
        throw err;
      }

      // Graceful degradation: fail-open with minimal state
      console.warn(`[L3Compiler] Retrieval error, failing open: ${err.message}`);
      return {
        state_markdown: `<!-- L3 Cognitive State: Default Baseline (Fail-open triggered) -->`,
        retrieved_rules: [],
        compilation_latency_ms: Math.round(latencyMs * 100) / 100,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private assembleMarkdown(
    rules: L2KnowledgeItem[],
    projectId: string,
    cortexMarkdown: string = '',
    beadsMarkdown: string = '',
    sessionMarkdown: string = ''
  ): string {
    const lines: string[] = [];

    if (sessionMarkdown) {
      lines.push(sessionMarkdown.trim());
    }

    if (rules.length === 0) {
      lines.push(`### ACTIVE PROJECT CONTEXT\n- Project ID: ${projectId}\n- No active historical constraints triggered.`);
    } else {
      lines.push(`### CTX:${projectId}`);

      const strategyMap = new Map<string, any>();

      for (const rule of rules) {
        const confPercent = Math.round(rule.confidence * 100);
        const cat = rule.category === 'user_preference' ? 'PREF' : rule.category === 'project_constraint' ? 'CONST' : 'RULE';
        const content = rule.content.replace(/\n/g, ' ').substring(0, 120);
        const truncated = rule.content.length > 120 ? '…' : '';
        lines.push(`- [${cat}|${confPercent}%] ${content}${truncated}`);

        if (this.l2Store.getStrategiesByTaskClass && rule.task_context) {
          const found = this.l2Store.getStrategiesByTaskClass(rule.task_context);
          for (const s of found) {
            strategyMap.set(s.strategy_id, s);
          }
        }
      }

      if (strategyMap.size > 0) {
        lines.push(`\n### RECOMMENDED PROCEDURAL WORKFLOWS:`);
        for (const s of strategyMap.values()) {
          lines.push(`- Workflow "${s.name}" (Confidence ${Math.round(s.confidence * 100)}%):`);
          for (const step of s.steps) {
            lines.push(`    ${step}`);
          }
        }
      }
    }

    // Attach Codebase Cortex block if present
    if (cortexMarkdown && cortexMarkdown.trim().length > 0) {
      lines.push(`\n${cortexMarkdown.trim()}`);
    }

    // Attach Beads-Lite Task Continuity block if present
    if (beadsMarkdown && beadsMarkdown.trim().length > 0) {
      lines.push(`\n${beadsMarkdown.trim()}`);
    }

    return lines.join('\n');
  }
}

/**
 * Estimates token count using word, punctuation, and code token heuristics.
 * Accurate within ~5-10% of GPT/Claude/Llama tokenizers without requiring large binary tables.
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const words = text.trim().split(/\s+/);
  let count = 0;
  for (const w of words) {
    if (w.length <= 4) {
      count += 1;
    } else {
      count += Math.ceil(w.length / 3.8);
    }
  }
  return Math.max(1, count);
}
