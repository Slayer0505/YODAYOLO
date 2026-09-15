import type { ChatCompletionRequest, ChatMessage, L3CompiledContext } from '../types';

/**
 * Builds the formal Brain Context Envelope separating:
 * 1. Base System Instructions
 * 2. Original Brain Working State (L3)
 * 3. Model-Specific Instructions
 * 4. User Request
 */
export function buildBrainContextEnvelope(
  originalSystemPrompt: string | undefined,
  l3Context: L3CompiledContext
): string {
  const parts: string[] = [];

  parts.push('<!-- ============================================================ -->');
  parts.push('<!--                  YODA COGNITIVE CONTEXT (L3)                -->');
  parts.push('<!-- ============================================================ -->');
  parts.push(l3Context.state_markdown.trim());

  if (l3Context.heart_directive) {
    const hd = l3Context.heart_directive;
    parts.push('\n### HEART SUPERVISORY DIRECTIVES');
    parts.push(`- Risk Level: ${hd.risk_level}`);
    parts.push(`- Verification Intensity: ${hd.verification_intensity}`);
    parts.push(`- Active Modalities: ${hd.active_modalities.join(', ')}`);
    if (hd.warnings.length > 0) {
      for (const w of hd.warnings) parts.push(`- WARNING: ${w}`);
    }
    if (hd.pushback_reasons.length > 0) {
      for (const pb of hd.pushback_reasons) parts.push(`- PUSHBACK: ${pb}`);
    }
    if (hd.curiosity_inquiries.length > 0) {
      for (const ci of hd.curiosity_inquiries) parts.push(`- INQUIRY: ${ci}`);
    }
    if (hd.requires_human_confirmation) {
      parts.push('- ACTION BLOCKED: Requires explicit human confirmation prior to tool execution.');
    }
  }

  parts.push('<!-- ============================================================ -->');
  parts.push('<!--             END YODA CONTEXT — PROCEED TO TASK              -->');
  parts.push('<!-- ============================================================ -->\n');

  if (originalSystemPrompt && originalSystemPrompt.trim().length > 0) {
    parts.push(originalSystemPrompt.trim());
  }

  return parts.join('\n');
}

/**
 * Injects the compiled L3 Context Envelope into the outgoing ChatCompletionRequest.
 * Leaves the original client messages intact while ensuring the reasoning engine
 * receives the Brain working state deterministically.
 */
export function injectL3IntoRequest(
  request: ChatCompletionRequest,
  l3Context: L3CompiledContext
): ChatCompletionRequest {
  const updatedMessages: ChatMessage[] = [];
  let systemMessageInjected = false;

  for (const msg of request.messages) {
    if (msg.role === 'system' && !systemMessageInjected) {
      const enhancedContent = buildBrainContextEnvelope(msg.content, l3Context);
      updatedMessages.push({
        ...msg,
        content: enhancedContent,
      });
      systemMessageInjected = true;
    } else {
      updatedMessages.push(msg);
    }
  }

  // If no system message existed, prepend a new system message with the envelope
  if (!systemMessageInjected) {
    const newSystemContent = buildBrainContextEnvelope(undefined, l3Context);
    updatedMessages.unshift({
      role: 'system',
      content: newSystemContent,
    });
  }

    return {
    ...request,
    messages: updatedMessages,
  };
}

export const BrainContextEnvelope = {
  build: buildBrainContextEnvelope,
  wrap: (userPrompt: string, l3Context: L3CompiledContext): string => {
    return `${buildBrainContextEnvelope(undefined, l3Context)}\n\nUser Request: ${userPrompt}`;
  },
  inject: injectL3IntoRequest,
};

export const YodaContextEnvelope = BrainContextEnvelope;
