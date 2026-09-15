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
    const defaults: Array<Omit<L2KnowledgeItem, 'vector'>> = [
      {
        rule_id: 'rule-arch-minimal',
        category: 'user_preference',
        content: 'User prefers minimal architectural changes, localized diffs, and evidence-first reasoning over large rewrites.',
        confidence: 0.94,
        tags: ['architecture', 'minimal', 'refactor', 'diff'],
        provenance: ['exp-historical-41', 'exp-historical-73'],
      },
      {
        rule_id: 'rule-test-gate',
        category: 'project_constraint',
        content: 'This project requires automated integration testing and verified test pass status before code modifications are marked complete.',
        confidence: 0.92,
        tags: ['testing', 'integration', 'verification', 'tests'],
        provenance: ['exp-historical-12'],
      },
      {
        rule_id: 'rule-streaming-sse',
        category: 'project_constraint',
        content: 'Always preserve real-time streaming Server-Sent Events (SSE) behavior for client responsiveness; never buffer stream output unnecessarily.',
        confidence: 0.89,
        tags: ['streaming', 'sse', 'proxy', 'latency'],
        provenance: ['exp-historical-19'],
      },
      {
        rule_id: 'rule-style-concise',
        category: 'user_preference',
        content: 'User prefers concise responses with bulleted points and explicit confidence metrics rather than conversational filler.',
        confidence: 0.87,
        tags: ['communication', 'style', 'concise', 'brevity'],
        provenance: ['exp-historical-55'],
      },
      {
        rule_id: 'rule-legacy-debug',
        category: 'learned_rule',
        content: 'When debugging legacy modules, inspect test boundaries and verify baseline exit codes before making modifications.',
        confidence: 0.83,
        tags: ['legacy', 'debugging', 'boundary', 'inspect'],
        provenance: ['exp-historical-88'],
      },
    ];

    for (const item of defaults) {
      const vector = this.embedder.embedSync(item.content);
      this.rules.set(item.rule_id, { ...item, vector });
    }
  }
}
