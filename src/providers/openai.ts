import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class OpenAIProvider implements ReasoningProvider {
  public name = 'openai-gpt';
  public providerType: 'upstream' = 'upstream';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };
  private apiKey?: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: OpenAIProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'gpt-4o';
    this.timeoutMs = options.timeoutMs || 30000;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      return resp.status < 500;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'gpt-4o', object: 'model', created: 1715000000, owned_by: 'openai' },
      { id: 'gpt-4o-mini', object: 'model', created: 1721000000, owned_by: 'openai' },
      { id: 'o1', object: 'model', created: 1726000000, owned_by: 'openai' },
      { id: 'o1-mini', object: 'model', created: 1726000000, owned_by: 'openai' },
      { id: 'gpt-4-turbo', object: 'model', created: 1712000000, owned_by: 'openai' },
    ];
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY or configure in YODA.');
    }

    const payload = {
      ...request,
      model: request.model || this.defaultModel,
      stream: false,
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`OpenAI API error (${resp.status}): ${errText}`);
    }

    return (await resp.json()) as ChatCompletionResponse;
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY or configure in YODA.');
    }

    const payload = {
      ...request,
      model: request.model || this.defaultModel,
      stream: true,
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text();
      throw new Error(`OpenAI streaming error (${resp.status}): ${errText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') return;
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const chunk = JSON.parse(jsonStr) as ChatCompletionChunk;
            yield chunk;
          } catch {
            // ignore malformed lines
          }
        }
      }
    }
  }
}
