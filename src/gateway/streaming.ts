import type { ChatCompletionChunk, ChatCompletionResponse } from '../types';

export function formatSseChunk(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function formatSseDone(): string {
  return 'data: [DONE]\n\n';
}

/**
 * Reconstructs a full ChatCompletionResponse from an array of streamed chunks
 * so the ground-truth provider response can be stored faithfully in L0.
 */
export function reconstructResponseFromChunks(
  chunks: ChatCompletionChunk[],
  model: string
): ChatCompletionResponse {
  let combinedContent = '';
  let finishReason = 'stop';
  let responseId = 'stream-reconstructed';
  let created = Math.floor(Date.now() / 1000);

  for (const chunk of chunks) {
    if (chunk.id) responseId = chunk.id;
    if (chunk.created) created = chunk.created;
    for (const choice of chunk.choices || []) {
      if (choice.delta?.content) {
        combinedContent += choice.delta.content;
      }
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }
  }

  return {
    id: responseId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: combinedContent,
        },
        finish_reason: finishReason,
      },
    ],
  };
}
