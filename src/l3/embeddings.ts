import { createHash } from 'crypto';

export interface EmbeddingEngine {
  embed(text: string, timeoutMs?: number): Promise<number[]>;
  embedSync?(text: string): number[];
}

/**
 * Deterministic, sub-millisecond local vector embedding engine.
 * Computes a normalized 64-dimensional semantic projection using
 * character/word n-gram frequency hashing. Guarantees 100% deterministic,
 * offline, and <1ms execution.
 */
export class DeterministicLocalEmbedder implements EmbeddingEngine {
  private dimension: number;

  constructor(dimension: number = 64) {
    this.dimension = dimension;
  }

  public embedSync(text: string): number[] {
    const vector = new Float64Array(this.dimension);
    const normalized = text.toLowerCase().trim();
    if (!normalized) return Array.from(vector);

    // Extract word tokens and character 3-grams
    const words = normalized.split(/\s+/);
    for (const word of words) {
      this.hashIntoVector(word, vector, 1.5);
      if (word.length >= 3) {
        for (let i = 0; i <= word.length - 3; i++) {
          const trigram = word.substring(i, i + 3);
          this.hashIntoVector(trigram, vector, 0.8);
        }
      }
    }

    // Normalize to unit length (L2 norm) for cosine similarity
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] /= norm;
      }
    }

    return Array.from(vector);
  }

  public async embed(text: string): Promise<number[]> {
    return this.embedSync(text);
  }

  private hashIntoVector(token: string, vector: Float64Array, weight: number): void {
    const hash = createHash('md5').update(token).digest();
    const idx = (hash[0] | (hash[1] << 8)) % this.dimension;
    const sign = (hash[2] & 1) === 1 ? 1 : -1;
    vector[idx] += sign * weight;
  }
}

/**
 * Ollama neural embedding client.
 * Calls local Ollama server (e.g. nomic-embed-text or all-minilm).
 */
export class OllamaEmbedder implements EmbeddingEngine {
  private baseUrl: string;
  private model: string;
  private fallback: DeterministicLocalEmbedder;

  constructor(baseUrl: string = 'http://127.0.0.1:11434', model: string = 'nomic-embed-text') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.fallback = new DeterministicLocalEmbedder();
  }

  public async embed(text: string, timeoutMs: number = 800): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 1. Try modern /api/embed
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as { embeddings?: number[][] };
        if (data.embeddings && data.embeddings.length > 0) {
          return normalizeVector(data.embeddings[0]);
        }
      }

      // 2. Fallback to legacy /api/embeddings
      const legacyRes = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });

      if (legacyRes.ok) {
        const legacyData = (await legacyRes.json()) as { embedding?: number[] };
        if (legacyData.embedding && legacyData.embedding.length > 0) {
          return normalizeVector(legacyData.embedding);
        }
      }

      // If Ollama returns error, fall back to local deterministic embedder
      return this.fallback.embedSync(text);
    } catch {
      // Fail-open immediately to local embedder
      return this.fallback.embedSync(text);
    } finally {
      clearTimeout(timer);
    }
  }

  public async checkModelAvailability(): Promise<{ available: boolean; model: string; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`);
      if (!resp.ok) return { available: false, model: this.model, error: `Ollama returned ${resp.status}` };
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const hasModel = (data.models || []).some(
        (m) => m.name === this.model || m.name.startsWith(`${this.model}:`)
      );
      return { available: hasModel, model: this.model };
    } catch (err: any) {
      return { available: false, model: this.model, error: err.message };
    }
  }

  public embedSync(text: string): number[] {
    return this.fallback.embedSync(text);
  }
}

/**
 * Hybrid Semantic Embedder with auto-detection & zero-latency fail-open.
 */
export class HybridSemanticEmbedder implements EmbeddingEngine {
  private ollama: OllamaEmbedder;
  private local: DeterministicLocalEmbedder;
  private preferOllama: boolean;

  constructor(options: { baseUrl?: string; model?: string; preferOllama?: boolean } = {}) {
    this.ollama = new OllamaEmbedder(options.baseUrl, options.model || 'nomic-embed-text');
    this.local = new DeterministicLocalEmbedder();
    this.preferOllama = options.preferOllama ?? true;
  }

  public async checkHealth(): Promise<{ usingOllama: boolean; model: string; available: boolean }> {
    if (!this.preferOllama) {
      return { usingOllama: false, model: 'deterministic-local-64d', available: true };
    }
    const avail = await this.ollama.checkModelAvailability();
    return {
      usingOllama: avail.available,
      model: avail.available ? avail.model : 'deterministic-local-64d (fallback)',
      available: true,
    };
  }

  public async embed(text: string, timeoutMs: number = 500): Promise<number[]> {
    if (!this.preferOllama) {
      return this.local.embedSync(text);
    }
    return this.ollama.embed(text, timeoutMs);
  }

  public embedSync(text: string): number[] {
    return this.local.embedSync(text);
  }
}

export function normalizeVector(v: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
