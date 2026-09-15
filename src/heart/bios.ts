import type { HeartBiosRule, HeartConsequence, HeartRiskLevel, HeartVerificationIntensity } from '../types';

export interface HeartBiosMatch {
  rule_id: string;
  category: HeartBiosRule['category'];
  description: string;
  matched_text: string;
  mandatory_risk: HeartRiskLevel;
  mandatory_consequence: HeartConsequence;
  mandatory_intensity: HeartVerificationIntensity;
}

export class HeartBios {
  private static RULES: Array<{
    rule_id: string;
    category: HeartBiosRule['category'];
    regex: RegExp;
    description: string;
    mandatory_risk: HeartRiskLevel;
    mandatory_consequence: HeartConsequence;
    mandatory_intensity: HeartVerificationIntensity;
  }> = [
    {
      rule_id: 'bios-fs-destruction',
      category: 'filesystem',
      regex: new RegExp('(rm\\s+-r?f\\s+(\\/|\\*|~|\\$HOME|\\.\\.|\\/home|\\/etc|\\/usr))|(del\\s+\\/[fF]\\s+\\/[sS]\\s+\\/[qQ])|(rmdir\\s+\\/[sS]\\s+\\/[qQ])', 'i'),
      description: 'Universal Safety Rule: Unconstrained recursive filesystem destruction is prohibited without explicit human confirmation.',
      mandatory_risk: 'CRITICAL',
      mandatory_consequence: 'IRREVERSIBLE',
      mandatory_intensity: 'MANDATORY_HUMAN_CONFIRMATION',
    },
    {
      rule_id: 'bios-db-destruction',
      category: 'database',
      regex: new RegExp('(DROP\\s+(DATABASE|SCHEMA))|(DROP\\s+TABLE\\s+(?!IF\\s+EXISTS\\s+temp_))|(TRUNCATE\\s+TABLE)|(DELETE\\s+FROM\\s+\\w+\\s*(?:;|$)(?!\\s*WHERE))', 'i'),
      description: 'Universal Safety Rule: Unbounded database schema or table destruction is prohibited without explicit confirmation.',
      mandatory_risk: 'CRITICAL',
      mandatory_consequence: 'IRREVERSIBLE',
      mandatory_intensity: 'MANDATORY_HUMAN_CONFIRMATION',
    },
    {
      rule_id: 'bios-credential-leak',
      category: 'credentials',
      regex: new RegExp('(BEGIN\\s+(?:RSA\\s+)?PRIVATE\\s+KEY)|(AKIA[0-9A-Z]{16})|(ghp_[0-9a-zA-Z]{36})|(sk-[a-zA-Z0-9]{32,})', 'i'),
      description: 'Universal Safety Rule: Exposing raw cryptographic private keys or service tokens in requests is prohibited.',
      mandatory_risk: 'HIGH',
      mandatory_consequence: 'IRREVERSIBLE',
      mandatory_intensity: 'MANDATORY_HUMAN_CONFIRMATION',
    },
    {
      rule_id: 'bios-git-destruction',
      category: 'git',
      regex: new RegExp('(git\\s+push\\s+(?:[^\\n]*\\s+)?(?:--force|-f)(?:\\s+[^\\n]*)?)|(git\\s+reset\\s+--hard\\s+HEAD~\\d+)|(git\\s+clean\\s+-fdx)', 'i'),
      description: 'Universal Safety Rule: Force pushing or hard resetting git history destroys unrecoverable commit lineage.',
      mandatory_risk: 'HIGH',
      mandatory_consequence: 'EXPENSIVE',
      mandatory_intensity: 'MANDATORY_HUMAN_CONFIRMATION',
    },
    {
      rule_id: 'bios-production-mutation',
      category: 'production',
      regex: new RegExp('(kubectl\\s+delete)|(terraform\\s+destroy)|(deploy\\s+--prod(?:uction)?)|(DROP.*PRODUCTION)', 'i'),
      description: 'Universal Safety Rule: Production infrastructure deletion or unverified deployment requires human confirmation.',
      mandatory_risk: 'CRITICAL',
      mandatory_consequence: 'IRREVERSIBLE',
      mandatory_intensity: 'MANDATORY_HUMAN_CONFIRMATION',
    },
  ];

  public checkViolations(text: string): HeartBiosMatch | null {
    if (!text) return null;
    for (const rule of HeartBios.RULES) {
      const match = rule.regex.exec(text);
      if (match) {
        return {
          rule_id: rule.rule_id,
          category: rule.category,
          description: rule.description,
          matched_text: match[0],
          mandatory_risk: rule.mandatory_risk,
          mandatory_consequence: rule.mandatory_consequence,
          mandatory_intensity: rule.mandatory_intensity,
        };
      }
    }
    return null;
  }

  public getRules(): HeartBiosRule[] {
    return HeartBios.RULES.map((r) => ({
      rule_id: r.rule_id,
      category: r.category,
      description: r.description,
      mandatory_risk: r.mandatory_risk,
      mandatory_consequence: r.mandatory_consequence,
      mandatory_intensity: r.mandatory_intensity,
    }));
  }
}
