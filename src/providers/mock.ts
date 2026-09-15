import { randomUUID } from 'crypto';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';

export interface MockProviderOptions {
  name?: string;
  models?: string[];
  defaultModel?: string;
  latencyMs?: number;
  shouldFail?: boolean;
  failureError?: Error;
  shouldTimeout?: boolean;
  timeoutMs?: number;
  shouldReturnMalformed?: boolean;
  fixedResponseText?: string;
  responseHandler?: (request: ChatCompletionRequest) => string | Promise<string>;
}

export class MockReasoningProvider implements ReasoningProvider {
  public name: string;
  public providerType: 'mock' = 'mock';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };
  private models: string[];
  private latencyMs: number;
  private shouldFail: boolean;
  private failureError: Error;
  private shouldTimeout: boolean;
  private timeoutMs: number;
  private shouldReturnMalformed: boolean;
  private fixedResponseText: string | null;
  private responseHandler?: (request: ChatCompletionRequest) => string | Promise<string>;

  constructor(options: MockProviderOptions = {}) {
    this.name = options.name || 'mock-reasoning-engine';
    this.defaultModel = options.defaultModel || (options.models && options.models[0]) || 'neutral-reasoner';
    this.models = options.models || [
      'neutral-reasoner',
      'gpt-4o',
      'claude-3-5-sonnet',
      'gemini-1.5-pro',
      'deepseek-chat',
      'qwen2.5:3b',
      'brain-default',
    ];
    this.latencyMs = options.latencyMs || 0;
    this.shouldFail = options.shouldFail || false;
    this.failureError = options.failureError || new Error('Simulated upstream reasoning engine failure (503)');
    this.shouldTimeout = options.shouldTimeout || false;
    this.timeoutMs = options.timeoutMs || 2000;
    this.shouldReturnMalformed = options.shouldReturnMalformed || false;
    this.fixedResponseText = options.fixedResponseText || null;
    this.responseHandler = options.responseHandler;
  }

  public setShouldFail(fail: boolean, err?: Error): void {
    this.shouldFail = fail;
    if (err) this.failureError = err;
  }

  public setShouldTimeout(timeout: boolean, ms?: number): void {
    this.shouldTimeout = timeout;
    if (ms) this.timeoutMs = ms;
  }

  public setShouldReturnMalformed(malformed: boolean): void {
    this.shouldReturnMalformed = malformed;
  }

  public async listModels(): Promise<ModelInfo[]> {
    return this.models.map((id) => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'yoda',
    }));
  }

  public async healthCheck(): Promise<boolean> {
    return !this.shouldFail;
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (this.latencyMs > 0) {
      await Bun.sleep(this.latencyMs);
    }

    if (this.shouldTimeout) {
      await Bun.sleep(this.timeoutMs);
      throw new Error(`Upstream provider timeout after ${this.timeoutMs}ms`);
    }

    if (this.shouldFail) {
      throw this.failureError;
    }

    if (this.shouldReturnMalformed) {
      // Return invalid structure to trigger malformed response handling
      return {
        id: '',
        object: 'chat.completion',
        created: 0,
        model: request.model,
        choices: [] as any,
      };
    }

    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
    const userText = lastUserMsg?.content || 'no content';
    let replyText = this.fixedResponseText;
    if (this.responseHandler) {
      replyText = await this.responseHandler(request);
    } else if (!replyText) {
      replyText = `[Brain Cognition via ${this.name} (${request.model})]: Processed: "${userText}"`;
    }

    return {
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: replyText,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      },
    };
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (this.latencyMs > 0) {
      await Bun.sleep(this.latencyMs);
    }

    if (this.shouldTimeout) {
      await Bun.sleep(this.timeoutMs);
      throw new Error(`Upstream provider timeout after ${this.timeoutMs}ms`);
    }

    if (this.shouldFail) {
      throw this.failureError;
    }

    const responseId = `chatcmpl-chunk-${randomUUID()}`;
    const nowSec = Math.floor(Date.now() / 1000);

    // Initial chunk with role
    yield {
      id: responseId,
      object: 'chat.completion.chunk',
      created: nowSec,
      model: request.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };

    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === 'user');
    const userText = lastUserMsg?.content || 'no content';
    let replyText = this.fixedResponseText;
    if (this.responseHandler) {
      replyText = await this.responseHandler(request);
    } else if (!replyText) {
      replyText = `[Brain Cognition via ${this.name} (${request.model})]: Processed: "${userText}"`;
    }

    const words = replyText.split(' ');
    for (let i = 0; i < words.length; i++) {
      const token = (i === 0 ? '' : ' ') + words[i];
      yield {
        id: responseId,
        object: 'chat.completion.chunk',
        created: nowSec,
        model: request.model,
        choices: [
          {
            index: 0,
            delta: { content: token },
            finish_reason: null,
          },
        ],
      };
      if (this.latencyMs > 0) {
        await Bun.sleep(10);
      }
    }

    // Final chunk
    yield {
      id: responseId,
      object: 'chat.completion.chunk',
      created: nowSec,
      model: request.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop',
        },
      ],
    };
  }
}
