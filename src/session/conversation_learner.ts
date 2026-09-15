import type { EvidenceBus } from '../evidence/bus';
import type { L1ExperienceManager } from '../l1/experience';
import type { L2RuleCategory } from '../types';

export interface ExtractedLearningSignal {
  type: 'user_preference' | 'user_correction' | 'user_approval' | 'tool_result';
  evidenceType: 'user_accept' | 'user_correction' | 'test_pass' | 'test_fail' | 'build_success' | 'build_fail';
  category: L2RuleCategory;
  content: string;
  confidence: number;
  tags: string[];
  rawText: string;
}

export class ConversationLearner {
  /**
   * Analyzes an array of conversation messages to extract explicit user rules,
   * constraints, preferences, corrections, and tool execution outcomes.
   */
  public static extractSignalsFromMessages(
    messages: Array<{ role: string; content?: any; tool_call_id?: string; name?: string }>,
    projectId: string = 'default'
  ): ExtractedLearningSignal[] {
    const signals: ExtractedLearningSignal[] = [];
    if (!messages || messages.length === 0) return signals;

    // Find the latest user message
    const userMessages = messages.filter((m) => m.role === 'user');
    const lastUserMsg = userMessages[userMessages.length - 1];

    if (lastUserMsg && typeof lastUserMsg.content === 'string') {
      const userText = lastUserMsg.content.trim();
      const lower = userText.toLowerCase();

      // 1. Explicit Rule / Preference Declarations
      // e.g. "Remember that for this project we use X instead of Y because Z"
      // e.g. "Always use tabs instead of spaces"
      // e.g. "For this project, I prefer concise commit messages"
      const rememberMatch = userText.match(/(?:please\s+)?remember(?:\s+that)?(?:\s+for\s+this\s+project)?[:,]?\s*(.+)/i);
      const preferMatch = userText.match(/(?:for\s+this\s+project,?\s*)?(?:i\s+prefer|we\s+prefer|preference:)\s*(.+)/i);
      const alwaysMatch = userText.match(/(?:always|never|make sure to)\s+([^.\n]+(?:because\s+[^.\n]+)?)/i);
      const useInsteadMatch = userText.match(/(?:we\s+use|use)\s+([A-Za-z0-9_.\-\s]+)\s+instead\s+of\s+([A-Za-z0-9_.\-\s]+)(?:\s+because\s+([^.\n]+))?/i);

      if (rememberMatch && rememberMatch[1]) {
        const cleanContent = rememberMatch[1].trim();
        signals.push({
          type: 'user_preference',
          evidenceType: 'user_accept',
          category: cleanContent.toLowerCase().includes('instead of') || cleanContent.toLowerCase().includes('because') ? 'architecture_constraint' : 'user_preference',
          content: cleanContent,
          confidence: 0.95,
          tags: ['user_rule', 'explicit_instruction', projectId],
          rawText: userText,
        });
      } else if (useInsteadMatch && useInsteadMatch[1] && useInsteadMatch[2]) {
        const x = useInsteadMatch[1].trim();
        const y = useInsteadMatch[2].trim();
        const because = useInsteadMatch[3] ? ` because ${useInsteadMatch[3].trim()}` : '';
        signals.push({
          type: 'user_preference',
          evidenceType: 'user_accept',
          category: 'architecture_constraint',
          content: `Use ${x} instead of ${y}${because}`,
          confidence: 0.92,
          tags: ['architecture_constraint', 'substitution', projectId],
          rawText: userText,
        });
      } else if (preferMatch && preferMatch[1]) {
        const pref = preferMatch[1].trim();
        signals.push({
          type: 'user_preference',
          evidenceType: 'user_accept',
          category: 'user_preference',
          content: `Preference: ${pref}`,
          confidence: 0.90,
          tags: ['user_preference', projectId],
          rawText: userText,
        });
      } else if (alwaysMatch && alwaysMatch[1] && (lower.includes('project') || lower.includes('because') || lower.includes('always') || lower.includes('never'))) {
        signals.push({
          type: 'user_preference',
          evidenceType: 'user_accept',
          category: 'learned_rule',
          content: alwaysMatch[0].trim(),
          confidence: 0.88,
          tags: ['workflow_rule', projectId],
          rawText: userText,
        });
      }

      // 2. User Corrections
      // e.g. "No. I specifically want A because B caused problem X."
      // e.g. "No, use approach A."
      // e.g. "That's wrong, don't do that."
      const isCorrection =
        /^(?:no[.,!]|no\s+,\s*|no\s+instead|that's\s+wrong|that\s+is\s+incorrect|don't\s+use|do\s+not\s+use)/i.test(userText) ||
        /(?:instead\s+of\s+that|specifically\s+want|caused\s+problem|caused\s+an\s+error|failed\s+because)/i.test(userText);

      if (isCorrection && !signals.some((s) => s.type === 'user_preference')) {
        signals.push({
          type: 'user_correction',
          evidenceType: 'user_correction',
          category: 'learned_rule',
          content: userText,
          confidence: 0.90,
          tags: ['user_correction', 'feedback', projectId],
          rawText: userText,
        });
      }

      // 3. Explicit User Approval / Task Success Confirmations
      // e.g. "that worked", "tests pass", "great, thanks"
      const isApproval = /^(?:that\s+worked|it\s+works|tests?\s+passed?|perfect[.,!]?|great[.,!]?|lgtm|approved|looks\s+good)/i.test(userText);
      if (isApproval) {
        signals.push({
          type: 'user_approval',
          evidenceType: 'user_accept',
          category: 'learned_rule',
          content: `User confirmed success: ${userText}`,
          confidence: 0.85,
          tags: ['confirmed_outcome', projectId],
          rawText: userText,
        });
      }
    }

    // 4. Tool Execution Results in Message History
    // Check for messages with role 'tool' or 'function'
    const toolMessages = messages.filter((m) => m.role === 'tool' || m.role === 'function');
    for (const toolMsg of toolMessages) {
      const toolContent = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content || '');
      const lowerTool = toolContent.toLowerCase();

      const isTestPass =
        /(\b\d+\s+passed\b|\b\d+\s+pass\b|all\s+\d+\s+tests\s+passed|test\s+suite\s+passed|exit\s+code\s+0)/i.test(toolContent) &&
        !/(\bfailed\b|\bfail\b|error:)/i.test(toolContent);

      const isTestFail =
        /(\b\d+\s+failed\b|\b\d+\s+fail\b|tests?\s+failed|test\s+suite\s+failed|assertion\s+error|exit\s+code\s+1)/i.test(toolContent);

      if (isTestPass) {
        signals.push({
          type: 'tool_result',
          evidenceType: 'test_pass',
          category: 'testing_gate',
          content: `Test suite verified passing: ${toolContent.slice(0, 120)}`,
          confidence: 0.95,
          tags: ['test_pass', 'verified_gate', projectId],
          rawText: toolContent,
        });
      } else if (isTestFail) {
        signals.push({
          type: 'tool_result',
          evidenceType: 'test_fail',
          category: 'testing_gate',
          content: `Test failure observed: ${toolContent.slice(0, 120)}`,
          confidence: 0.90,
          tags: ['test_fail', 'failure_gate', projectId],
          rawText: toolContent,
        });
      }
    }

    return signals;
  }

  /**
   * Processes extracted signals asynchronously against EvidenceBus and ExperienceManager.
   */
  public static async processSignals(
    signals: ExtractedLearningSignal[],
    evidenceBus: EvidenceBus,
    experienceManager?: L1ExperienceManager,
    correlationId?: string,
    projectId: string = 'default'
  ): Promise<void> {
    for (const sig of signals) {
      await evidenceBus.emit({
        source: sig.type === 'tool_result' ? 'tool' : 'user',
        type: sig.evidenceType,
        correlationId,
        projectId,
        payload: {
          rule_candidate: {
            category: sig.category,
            taskContext: projectId,
            content: sig.content,
            tags: sig.tags,
          },
          raw_text: sig.rawText,
        },
      });
    }
  }
}
