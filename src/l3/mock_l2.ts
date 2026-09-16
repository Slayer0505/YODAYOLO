import type { L2KnowledgeItem } from '../types';
import { DeterministicLocalEmbedder } from './embeddings';

export class MockL2KnowledgeStore {
  private rules: Map<string, L2KnowledgeItem> = new Map();
  private embedder: DeterministicLocalEmbedder;

  constructor(embedder?: DeterministicLocalEmbedder) {
    this.embedder = embedder || new DeterministicLocalEmbedder();
    this.seedDefaultKnowledge();
  }

  public async addRule(item: Omit<L2KnowledgeItem, 'vector'>): Promise<L2KnowledgeItem> {
    const vector = await this.embedder.embed(item.content);
    const rule: L2KnowledgeItem = {
      ...item,
      vector,
    };
    this.rules.set(rule.rule_id, rule);
    return rule;
  }

  public getRule(ruleId: string): L2KnowledgeItem | null {
    return this.rules.get(ruleId) || null;
  }

  public getAllRules(): L2KnowledgeItem[] {
    return Array.from(this.rules.values());
  }

  private seedDefaultKnowledge(): void {
    const now = new Date().toISOString();
    const defaults: Array<Omit<L2KnowledgeItem, 'vector'>> = [
      {
        rule_id: 'rule-arch-minimal',
        category: 'user_preference',
        content: 'User prefers minimal architectural changes, localized diffs, and evidence-first reasoning over large rewrites.',
        task_context: 'default',
        confidence: 0.94,
        evidence_count: 5,
        contradiction_count: 0,
        status: 'CONFIRMED',
        tags: ['architecture', 'minimal', 'refactor', 'diff'],
        provenance: ['exp-historical-41', 'exp-historical-73'],
        created_at: now,
        updated_at: now,
      },
      {
        rule_id: 'rule-test-gate',
        category: 'project_constraint',
        content: 'This project requires automated integration testing and verified test pass status before code modifications are marked complete.',
        task_context: 'default',
        confidence: 0.92,
        evidence_count: 4,
        contradiction_count: 0,
        status: 'CONFIRMED',
        tags: ['testing', 'integration', 'verification', 'tests'],
        provenance: ['exp-historical-12'],
        created_at: now,
        updated_at: now,
      },
      {
        rule_id: 'rule-streaming-sse',
        category: 'project_constraint',
        content: 'Always preserve real-time streaming Server-Sent Events (SSE) behavior for client responsiveness; never buffer stream output unnecessarily.',
        task_context: 'default',
        confidence: 0.89,
        evidence_count: 3,
        contradiction_count: 0,
        status: 'CONFIRMED',
        tags: ['streaming', 'sse', 'proxy', 'latency'],
        provenance: ['exp-historical-19'],
        created_at: now,
        updated_at: now,
      },
      {
        rule_id: 'rule-style-concise',
        category: 'user_preference',
        content: 'User prefers concise responses with bulleted points and explicit confidence metrics rather than conversational filler.',
        task_context: 'default',
        confidence: 0.87,
        evidence_count: 3,
        contradiction_count: 0,
        status: 'CONFIRMED',
        tags: ['communication', 'style', 'concise', 'brevity'],
        provenance: ['exp-historical-55'],
        created_at: now,
        updated_at: now,
      },
      {
        rule_id: 'rule-legacy-debug',
        category: 'learned_rule',
        content: 'When debugging legacy modules, inspect test boundaries and verify baseline exit codes before making modifications.',
        task_context: 'default',
        confidence: 0.83,
        evidence_count: 2,
        contradiction_count: 0,
        status: 'CONFIRMED',
        tags: ['legacy', 'debugging', 'boundary', 'inspect'],
        provenance: ['exp-historical-88'],
        created_at: now,
        updated_at: now,
      },
    ];

    for (const item of defaults) {
      const vector = this.embedder.embedSync(item.content);
      this.rules.set(item.rule_id, { ...item, vector });
    }
  }
}
