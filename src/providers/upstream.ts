import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';

export interface UpstreamHttpProviderOptions {
  name?: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class UpstreamHttpProvider implements ReasoningProvider {
  public name: string;
  public providerType: 'upstream' = 'upstream';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options: UpstreamHttpProviderOptions) {
    this.name = options.name || 'upstream-http';
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.defaultModel = options.defaultModel || 'neutral-reasoner';
    this.timeoutMs = options.timeoutMs || 30000;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  public async listModels(): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!resp.ok) return [];
      const data = (await resp.json()) as { data?: ModelInfo[] };
      return data.data || [];
    } catch {
      return [];
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const payload = {
      ...request,
      stream: false,
    };

    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Upstream provider error (${resp.status}): ${errText}`);
    }

    return (await resp.json()) as ChatCompletionResponse;
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const payload = {
      ...request,
      stream: true,
    };

    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text();
      throw new Error(`Upstream streaming error (${resp.status}): ${errText}`);
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
            // ignore malformed line
          }
        }
      }
    }
  }
}
