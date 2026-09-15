import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';

export class OllamaReasoningProvider implements ReasoningProvider {
  public name = 'ollama';
  public providerType: 'ollama' = 'ollama';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:11434', defaultModel: string = 'neutral-reasoner') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultModel = defaultModel || 'neutral-reasoner';
  }

  public async listModels(): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`);
      if (!resp.ok) return [];
      const data = (await resp.json()) as { models?: Array<{ name: string; modified_at: string }> };
      return (data.models || []).map((m) => ({
        id: m.name,
        object: 'model',
        created: Math.floor(new Date(m.modified_at).getTime() / 1000),
        owned_by: 'ollama',
      }));
    } catch {
      return [];
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/version`);
      return resp.ok;
    } catch {
      return false;
    }
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    let model = request.model;
    if (!model || model === 'ollama' || model === 'neutral-reasoner' || model === 'brain-default' || model === 'yoda-default') {
      const models = await this.listModels();
      const reasoningModel = models.find((m) => !m.id.includes('embed')) || models[0];
      if (reasoningModel) {
        model = reasoningModel.id;
      }
    }

    const payload = {
      ...request,
      model,
      stream: false,
    };

    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Ollama provider error (${resp.status}): ${errText}`);
    }

    return (await resp.json()) as ChatCompletionResponse;
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    let model = request.model;
    if (!model || model === 'ollama' || model === 'neutral-reasoner' || model === 'brain-default' || model === 'yoda-default') {
      const models = await this.listModels();
      const reasoningModel = models.find((m) => !m.id.includes('embed')) || models[0];
      if (reasoningModel) {
        model = reasoningModel.id;
      }
    }

    const payload = {
      ...request,
      model,
      stream: true,
    };

    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text();
      throw new Error(`Ollama streaming error (${resp.status}): ${errText}`);
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
            // ignore malformed SSE line
          }
        }
      }
    }
  }
}
