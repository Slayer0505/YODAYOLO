import { randomUUID } from 'crypto';
import type { L2KnowledgeStore } from '../l2/store';
import type { L4MetaEngine } from '../l4/meta_engine';
import type {
  HeartConsequence,
  HeartEvaluation,
  HeartModality,
  HeartRiskLevel,
  HeartVerificationIntensity,
} from '../types';
import { HeartBios } from './bios';

export interface EvaluateActionParams {
  actionText?: string;
  action?: string;
  taskContext?: string;
  context?: string;
  intent?: string;
  userOverride?: boolean;
  user_override?: boolean;
  affectedFiles?: string[];
}

export class HeartSupervisor {
  private bios: HeartBios;
  private l2Store?: L2KnowledgeStore;
  private metaEngine?: L4MetaEngine;

  constructor(options?: {
    bios?: HeartBios;
    l2Store?: L2KnowledgeStore;
    metaEngine?: L4MetaEngine;
  }) {
    this.bios = options?.bios || new HeartBios();
    this.l2Store = options?.l2Store;
    this.metaEngine = options?.metaEngine;
  }

  public evaluateAction(params: EvaluateActionParams): HeartEvaluation {
    const evaluationId = `heart-eval-${randomUUID()}`;
    const taskContext = params.taskContext || params.context || 'general';
    const actionText = typeof params.actionText === 'string' ? params.actionText : (typeof params.action === 'string' ? params.action : (typeof params.intent === 'string' ? params.intent : String(params.actionText || '')));
    const now = new Date().toISOString();

    const activeModalities: HeartModality[] = [];
    const pushbackReasons: string[] = [];
    const warnings: string[] = [];
    const curiosityInquiries: string[] = [];

    let riskLevel: HeartRiskLevel = 'LOW';
    let consequence: HeartConsequence = 'REVERSIBLE';
    let verificationIntensity: HeartVerificationIntensity = 'STANDARD';
    let biosTriggered: string | null = null;
    let rationale = 'Standard low-risk interaction evaluated.';

    // ------------------------------------------------------------------------
    // STEP 1: UNIVERSAL BIOS RULES (NON-NEGOTIABLE SAFETY BASELINE)
    // ------------------------------------------------------------------------
    const biosMatch = this.bios.checkViolations(actionText);
    if (biosMatch) {
      biosTriggered = biosMatch.rule_id;
      riskLevel = biosMatch.mandatory_risk;
      consequence = biosMatch.mandatory_consequence;
      verificationIntensity = biosMatch.mandatory_intensity;
      activeModalities.push('CAUTION');
      warnings.push(biosMatch.description);

      const isOverridden = Boolean(params.userOverride ?? params.user_override);
      if (isOverridden) {
        warnings.push('OPERATOR OVERRIDE: Human confirmed execution of BIOS-restricted action.');
      }

      return {
        evaluation_id: evaluationId,
        task_context: taskContext,
        action_summary: actionText.slice(0, 120),
        risk_level: riskLevel,
        consequence: consequence,
        active_modalities: activeModalities,
        verification_intensity: verificationIntensity,
        bios_rule_triggered: biosTriggered,
        pushback_reasons: pushbackReasons,
        warnings,
        curiosity_inquiries: curiosityInquiries,
        requires_human_confirmation: !isOverridden,
        user_override_granted: isOverridden,
        rationale: `BIOS Safety Violation triggered [${biosMatch.rule_id}]. High-consequence safety protections active.`,
        evaluated_at: now,
      };
    }

    // ------------------------------------------------------------------------
    // STEP 2: L2 CONSTRAINTS & PUSHBACK MODALITY
    // ------------------------------------------------------------------------
    if (this.l2Store) {
      const lowerAction = actionText.toLowerCase();

      // Check test skipping constraint
      if (
        /(skip|bypass|ignore|without|no)\s+.*tests?/i.test(actionText)
      ) {
        const testRule = this.l2Store.getRule('rule-test-gate');
        if (testRule && testRule.status === 'CONFIRMED') {
          activeModalities.push('PUSHBACK');
          pushbackReasons.push(
            `Action conflicts with confirmed constraint [${testRule.rule_id}]: "${testRule.content}"`
          );
          riskLevel = 'MEDIUM';
          verificationIntensity = 'ELEVATED';
        }
      }

      // Check architectural rewrite constraint
      if (
        /(rewrite\s+completely|scrap\s+everything|total\s+rewrite|replace\s+entire\s+architecture|rewrite\s+from\s+scratch)/i.test(actionText)
      ) {
        const archRule = this.l2Store.getRule('rule-arch-minimal');
        if (archRule && archRule.status === 'CONFIRMED') {
          activeModalities.push('PUSHBACK');
          pushbackReasons.push(
            `Action conflicts with project constraint [${archRule.rule_id}]: "${archRule.content}"`
          );
          riskLevel = 'MEDIUM';
          verificationIntensity = 'ELEVATED';
        }
      }
    }

    // ------------------------------------------------------------------------
    // STEP 3: L4 META-LEARNING, UNCERTAINTY & CURIOSITY MODALITIES
    // ------------------------------------------------------------------------
    if (this.metaEngine) {
      const reliability = this.metaEngine.evaluateContextualReliability(taskContext);

      // Low reliability or uncalibrated domain -> CAUTION + UNCERTAINTY
      if (reliability.composite_reliability < 0.50) {
        if (!activeModalities.includes('CAUTION')) activeModalities.push('CAUTION');
        activeModalities.push('UNCERTAINTY');
        warnings.push(
          `Contextual reliability in '${taskContext}' is low (${Math.round(reliability.composite_reliability * 100)}%).`
        );
        verificationIntensity = 'ELEVATED';
      }

      // Check epistemic frontiers / unknown domains -> CURIOSITY
      const selfModel = this.metaEngine.synthesizeSelfModel();
      if (selfModel.unknown_domains.includes(taskContext)) {
        activeModalities.push('CURIOSITY');
        curiosityInquiries.push(
          `Domain '${taskContext}' is an unexplored epistemic frontier. Clarify validation requirements before executing.`
        );
        if (verificationIntensity === 'STANDARD') {
          verificationIntensity = 'ELEVATED';
        }
      }

      // Check contradictory beliefs in domain -> UNCERTAINTY
      const conflictingInDomain = selfModel.conflicting_beliefs.filter(
        (b) => b.task_context === taskContext
      );
      if (conflictingInDomain.length > 0) {
        if (!activeModalities.includes('UNCERTAINTY')) activeModalities.push('UNCERTAINTY');
        warnings.push(`Domain '${taskContext}' contains ${conflictingInDomain.length} contradictory belief(s).`);
        if (verificationIntensity === 'STANDARD') {
          verificationIntensity = 'ELEVATED';
        }
      }
    }

    // ------------------------------------------------------------------------
    // STEP 4: REPEATED SUCCESS & TRUST MODALITY
    // ------------------------------------------------------------------------
    if (activeModalities.length === 0) {
      activeModalities.push('TRUST');
      rationale = 'Low risk, confirmed alignment with rules, and validated track record. Standard friction applied.';
    } else {
      rationale = `Supervisory signals active: ${activeModalities.join(', ')}. Verification intensity: ${verificationIntensity}.`;
    }

    // ------------------------------------------------------------------------
    // STEP 5: HUMAN AUTHORITY OVERRIDE
    // ------------------------------------------------------------------------
    const isOverridden = Boolean(params.userOverride ?? params.user_override);
    if (isOverridden) {
      warnings.push('Operator override confirmed by human decision-maker.');
    }

    return {
      evaluation_id: evaluationId,
      task_context: taskContext,
      action_summary: actionText.slice(0, 120),
      risk_level: riskLevel,
      consequence: consequence,
      active_modalities: activeModalities,
      verification_intensity: verificationIntensity,
      bios_rule_triggered: biosTriggered,
      pushback_reasons: pushbackReasons,
      warnings,
      curiosity_inquiries: curiosityInquiries,
      requires_human_confirmation: !isOverridden && (verificationIntensity as string) === 'MANDATORY_HUMAN_CONFIRMATION',
      user_override_granted: isOverridden,
      rationale,
      evaluated_at: now,
    };
  }

  public getBios(): HeartBios {
    return this.bios;
  }
}
