import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ReasoningProvider,
} from '../types';
import { AnthropicProvider } from './claude';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { OllamaReasoningProvider } from './ollama';
import { UpstreamHttpProvider } from './upstream';
import { MockReasoningProvider } from './mock';

export interface UniversalRouterOptions {
  defaultModel?: string;
  upstreamUrl?: string;
  upstreamKey?: string;
  anthropicKey?: string;
  openaiKey?: string;
  geminiKey?: string;
}

export class UniversalProviderRouter implements ReasoningProvider {
  public name = 'universal-router';
  public providerType: 'upstream' = 'upstream';
  public defaultModel: string;
  public capabilities = { streaming: true, tool_calls: true, model_switching: true };

  private providers: Map<string, ReasoningProvider> = new Map();
  private defaultFallbackProvider: ReasoningProvider;

  constructor(options: UniversalRouterOptions = {}) {
    this.defaultModel = options.defaultModel || 'neutral-reasoner';

    // 1. Anthropic Claude Provider
    const claude = new AnthropicProvider({ apiKey: options.anthropicKey });
    this.providers.set('anthropic', claude);
    this.providers.set('claude', claude);

    // 2. OpenAI GPT Provider
    const openai = new OpenAIProvider({ apiKey: options.openaiKey });
    this.providers.set('openai', openai);
    this.providers.set('gpt', openai);

    // 3. Google Gemini Provider
    const gemini = new GeminiProvider({ apiKey: options.geminiKey });
    this.providers.set('google', gemini);
    this.providers.set('gemini', gemini);

    // 4. Optional Ollama Provider
    if (options.upstreamUrl) {
      const ollama = new OllamaReasoningProvider(options.upstreamUrl, this.defaultModel);
      this.providers.set('ollama', ollama);
    }

    // 5. Generic Upstream HTTP Provider
    if (options.upstreamUrl) {
      const upstream = new UpstreamHttpProvider({
        baseUrl: options.upstreamUrl,
        apiKey: options.upstreamKey,
        defaultModel: this.defaultModel,
      });
      this.providers.set('upstream', upstream);
    }

    // 6. Built-in Local / Mock Provider (zero external dependency)
    const mock = new MockReasoningProvider({
      name: 'yoda-local-reasoner',
      defaultModel: this.defaultModel,
      models: [
        'neutral-reasoner',
        'claude-3-5-sonnet',
        'gpt-4o',
        'gemini-1.5-pro',
        'qwen2.5:3b',
        'hermes-3',
      ],
    });
    this.providers.set('mock', mock);
    this.providers.set('local', mock);

    this.defaultFallbackProvider = mock;
  }

  public registerProvider(name: string, provider: ReasoningProvider) {
    this.providers.set(name.toLowerCase(), provider);
  }

  public setDefaultFallbackProvider(provider: ReasoningProvider) {
    this.defaultFallbackProvider = provider;
  }

  public getProvider(name: string): ReasoningProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  public getAllProviders(): Array<{ name: string; provider: ReasoningProvider }> {
    const list: Array<{ name: string; provider: ReasoningProvider }> = [];
    const seen = new Set<ReasoningProvider>();
    for (const [name, p] of this.providers.entries()) {
      if (!seen.has(p)) {
        seen.add(p);
        list.push({ name: p.name, provider: p });
      }
    }
    return list;
  }

  /**
   * Resolves the appropriate provider based on model naming and provider availability.
   * Explicit model requested ALWAYS wins.
   */
  public resolveProviderForModel(modelName?: string): ReasoningProvider {
    if (!modelName) {
      return this.defaultFallbackProvider;
    }

    let m = modelName.toLowerCase().trim();
    if (m.startsWith('yoda/')) {
      m = m.replace('yoda/', '');
    }

    // 0. Explicit local reasoner
    if (m === 'neutral-reasoner' || m === 'yoda-default' || m === 'brain-default' || m === 'local' || m.includes('mock')) {
      return this.defaultFallbackProvider;
    }

    // 1. Explicit provider prefix (e.g. claude/..., openai/..., ollama/...)
    if (m.startsWith('claude/') || m.startsWith('anthropic/')) {
      const p = this.providers.get('anthropic');
      if (p) return p;
    }
    if (m.startsWith('openai/') || m.startsWith('gpt/')) {
      const p = this.providers.get('openai');
      if (p) return p;
    }
    if (m.startsWith('gemini/') || m.startsWith('google/')) {
      const p = this.providers.get('google');
      if (p) return p;
    }
    if (m.startsWith('ollama/')) {
      const p = this.providers.get('ollama');
      if (p) return p;
    }

    // 2. Model Family Matching
    if (m.includes('claude') || m.includes('anthropic')) {
      const p = this.providers.get('anthropic');
      if (p) return p;
    }

    if (m.includes('gpt') || m.startsWith('o1') || m.includes('davinci') || m.includes('openai')) {
      const p = this.providers.get('openai');
      if (p) return p;
    }

    if (m.includes('gemini') || m.includes('google')) {
      const p = this.providers.get('google');
      if (p) return p;
    }

    if (m.includes('qwen') || m.includes('llama') || m.includes('mistral') || m.includes('deepseek')) {
      const p = this.providers.get('ollama');
      if (p) return p;
    }

    // 3. Check if an upstream or specific provider handles it
    const upstream = this.providers.get('upstream');
    if (upstream) {
      return upstream;
    }

    return this.defaultFallbackProvider;
  }

  public async listModels(): Promise<ModelInfo[]> {
    const allModels: ModelInfo[] = [];
    const seen = new Set<string>();

    for (const [, p] of this.providers.entries()) {
      try {
        const models = await p.listModels();
        for (const m of models) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            allModels.push(m);
          }
        }
      } catch {
        // continue gathering from other providers
      }
    }

    if (allModels.length === 0) {
      return [
        { id: 'claude-3-5-sonnet', object: 'model', created: Date.now(), owned_by: 'anthropic' },
        { id: 'gpt-4o', object: 'model', created: Date.now(), owned_by: 'openai' },
        { id: 'gemini-1.5-pro', object: 'model', created: Date.now(), owned_by: 'google' },
        { id: 'qwen2.5:3b', object: 'model', created: Date.now(), owned_by: 'local' },
        { id: 'neutral-reasoner', object: 'model', created: Date.now(), owned_by: 'yoda' },
      ];
    }

    return allModels;
  }

  public async healthCheck(): Promise<boolean> {
    return true;
  }

  public async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    let cleanModel = request.model ? request.model.replace(/^yoda\//, '') : undefined;
    const provider = this.resolveProviderForModel(cleanModel);
    return provider.chat({ ...request, model: cleanModel || request.model });
  }

  public async *chatStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    let cleanModel = request.model ? request.model.replace(/^yoda\//, '') : undefined;
    const provider = this.resolveProviderForModel(cleanModel);
    for await (const chunk of provider.chatStream({ ...request, model: cleanModel || request.model })) {
      yield chunk;
    }
  }
}
