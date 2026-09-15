import type { L0EventLedger } from '../db/ledger';
import type { L1ExperienceManager } from '../l1/experience';
import type { BeliefProvenanceExplanation } from '../types';
import type { L2KnowledgeStore } from './store';

export class ProvenanceService {
  private l2Store: L2KnowledgeStore;
  private expManager: L1ExperienceManager;
  private ledger: L0EventLedger;

  constructor(l2Store: L2KnowledgeStore, expManager: L1ExperienceManager, ledger: L0EventLedger) {
    this.l2Store = l2Store;
    this.expManager = expManager;
    this.ledger = ledger;
  }

  public explainProvenance(ruleId: string): BeliefProvenanceExplanation | null {
    const rule = this.l2Store.getRule(ruleId);
    if (!rule) return null;

    const supportingExperiences: BeliefProvenanceExplanation['supporting_experiences'] = [];

    for (const expId of rule.provenance) {
      const exp = this.expManager.getExperience(expId);
      if (!exp) {
        // If historical or mocked experience
        supportingExperiences.push({
          experience_id: expId,
          intent: 'Historical validated experience',
          model: 'unknown',
          status: 'SUCCESS',
          closure_reason: 'SUCCESS_SIGNAL',
          l0_events: [],
        });
        continue;
      }

      const l0Events = exp.supporting_l0_event_ids
        .map((id) => this.ledger.getEventById(id))
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => ({
          event_id: e.event_id,
          event_type: e.event_type,
          content_hash: e.content_hash,
          actor: e.actor,
        }));

      supportingExperiences.push({
        experience_id: exp.experience_id,
        intent: exp.intent,
        model: exp.model,
        status: exp.status,
        closure_reason: exp.closure_reason,
        l0_events: l0Events,
      });
    }

    return {
      rule,
      supporting_experiences: supportingExperiences,
    };
  }

  public formatExplanation(ruleId: string): string {
    const explanation = this.explainProvenance(ruleId);
    if (!explanation) return `Rule ${ruleId} not found in L2 knowledge store.`;

    const r = explanation.rule;
    const lines: string[] = [
      `================================================================`,
      `PROVENANCE AUDIT: WHY DOES THE BRAIN BELIEVE THIS?`,
      `================================================================`,
      `Rule ID:      ${r.rule_id}`,
      `Category:     ${r.category.toUpperCase()}`,
      `Context:      ${r.task_context}`,
      `Status:       ${r.status}`,
      `Confidence:   ${Math.round(r.confidence * 100)}% (Evidence count: ${r.evidence_count}, Contradictions: ${r.contradiction_count})`,
      `Belief:       "${r.content}"`,
      ``,
      `SUPPORTING EXPERIENCES (L1 -> L0 CHAIN):`,
    ];

    if (explanation.supporting_experiences.length === 0) {
      lines.push(`  (No direct experience records linked)`);
    } else {
      for (const exp of explanation.supporting_experiences) {
        lines.push(`  - [L1 Experience ${exp.experience_id}]`);
        lines.push(`      Task: "${exp.intent}" (Model: ${exp.model})`);
        lines.push(`      Status: ${exp.status} | Closure: ${exp.closure_reason || 'none'}`);
        if (exp.l0_events.length > 0) {
          lines.push(`      Ground-Truth L0 Events:`);
          for (const ev of exp.l0_events) {
            lines.push(`        • [${ev.actor}:${ev.event_type}] Hash: ${ev.content_hash.slice(0, 16)}...`);
          }
        }
      }
    }

    lines.push(`================================================================`);
    return lines.join('\n');
  }
}
