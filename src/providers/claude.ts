import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class AnthropicProvider implements ReasoningProvider {
  public name = 'anthropic-claude';
  public providerType: 'upstream' = 'upstream';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };
  private apiKey?: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'claude-3-5-sonnet-20241022';
    this.timeoutMs = options.timeoutMs || 30000;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      // Light check using models endpoint or head request
      const resp = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(4000),
      });
      return resp.status < 500;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'claude-3-5-sonnet-20241022', object: 'model', created: 1729600000, owned_by: 'anthropic' },
      { id: 'claude-3-5-haiku-20241022', object: 'model', created: 1729600000, owned_by: 'anthropic' },
      { id: 'claude-3-opus-20240229', object: 'model', created: 1709200000, owned_by: 'anthropic' },
      { id: 'claude-3-sonnet-20240229', object: 'model', created: 1709200000, owned_by: 'anthropic' },
    ];
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY or configure in YODA.');
    }

    const messages = request.messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    const systemMsg = request.messages.find((m) => m.role === 'system')?.content || '';

    const payload: any = {
      model: request.model || this.defaultModel,
      max_tokens: request.max_tokens || 4096,
      messages,
      system: systemMsg || undefined,
    };

    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic API error (${resp.status}): ${errText}`);
    }

    const data = (await resp.json()) as any;
    const textContent = data.content?.[0]?.text || '';

    return {
      id: data.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model || request.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent,
          },
          finish_reason: data.stop_reason === 'end_turn' ? 'stop' : data.stop_reason || 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
    };
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY or configure in YODA.');
    }

    const messages = request.messages.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    const systemMsg = request.messages.find((m) => m.role === 'system')?.content || '';

    const payload: any = {
      model: request.model || this.defaultModel,
      max_tokens: request.max_tokens || 4096,
      stream: true,
      messages,
      system: systemMsg || undefined,
    };

    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text();
      throw new Error(`Anthropic streaming error (${resp.status}): ${errText}`);
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
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'content_block_delta' && event.delta?.text) {
              yield {
                id: `chunk-${Date.now()}`,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      content: event.delta.text,
                    },
                    finish_reason: null,
                  },
                ],
              };
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    }
  }
}
