import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class GeminiProvider implements ReasoningProvider {
  public name = 'google-gemini';
  public providerType: 'upstream' = 'upstream';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };
  private apiKey?: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel || 'gemini-1.5-pro';
    this.timeoutMs = options.timeoutMs || 30000;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public async healthCheck(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`, {
        signal: AbortSignal.timeout(4000),
      });
      return resp.status < 500;
    } catch {
      return false;
    }
  }

  public async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'gemini-1.5-pro', object: 'model', created: 1715000000, owned_by: 'google' },
      { id: 'gemini-1.5-flash', object: 'model', created: 1715000000, owned_by: 'google' },
      { id: 'gemini-2.0-flash', object: 'model', created: 1734000000, owned_by: 'google' },
      { id: 'gemini-2.5-pro', object: 'model', created: 1740000000, owned_by: 'google' },
    ];
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is not configured. Set GEMINI_API_KEY or configure in YODA.');
    }

    const modelName = (request.model || this.defaultModel).replace(/^google\//, '');
    const contents = request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const payload = {
      contents,
    };

    const resp = await fetch(
      `${this.baseUrl}/models/${modelName}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini API error (${resp.status}): ${errText}`);
    }

    const data = (await resp.json()) as any;
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    // For Gemini, stream generateContent or fallback to chunking response
    const full = await this.chat(request);
    const content = full.choices[0]?.message.content || '';
    
    // Yield words as chunks
    const words = content.split(/(\s+)/);
    for (const w of words) {
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
              content: w,
            },
            finish_reason: null,
          },
        ],
      };
    }
  }
}
