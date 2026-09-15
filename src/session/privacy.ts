/**
 * YODA — Session Privacy & Sensitive Data Redactor
 * Ensures that API keys, tokens, credentials, secrets, and private values
 * are automatically detected and redacted prior to storage or L3 compilation.
 */

export interface PrivacyConfig {
  redactSecrets?: boolean;
  customPatterns?: RegExp[];
  replacement?: string;
}

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  // Bearer / Token headers
  /(?:Bearer|Token)\s+([A-Za-z0-9_\-\.]{16,})/gi,
  // API Keys (OpenAI, Anthropic, generic)
  /(?:sk-[a-zA-Z0-9_\-]{20,}|anthropic-[a-zA-Z0-9_\-]{20,}|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{40,})/gi,
  // Key=Value patterns (password, secret, api_key, token, access_key, private_key)
  /(?:password|passwd|secret|api_key|apikey|access_key|private_key|token|auth_token)\s*[:=]\s*["']?([^\s"',;}{]+)["']?/gi,
  // Generic hex/base64 long secrets
  /(?:SECRET_KEY|AUTH_SECRET|DATABASE_URL|DATABASE_PASSWORD)\s*[:=]\s*["']?([^\s"',;}{]+)["']?/gi,
];

export class PrivacyRedactor {
  private patterns: RegExp[];
  private replacement: string;
  private enabled: boolean;

  constructor(config: PrivacyConfig = {}) {
    this.enabled = config.redactSecrets ?? true;
    this.replacement = config.replacement || '[REDACTED_SECRET]';
    this.patterns = [...DEFAULT_SECRET_PATTERNS, ...(config.customPatterns || [])];
  }

  public redactText(text: string): string {
    if (!this.enabled || !text) return text;
    let redacted = text;

    for (const pattern of this.patterns) {
      redacted = redacted.replace(pattern, (match, captured) => {
        if (captured) {
          return match.replace(captured, this.replacement);
        }
        return this.replacement;
      });
    }

    return redacted;
  }

  public redactObject<T>(obj: T): T {
    if (!this.enabled || obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return this.redactText(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('apikey') ||
          lowerKey.includes('api_key') ||
          lowerKey.includes('credential')
        ) {
          result[key] = this.replacement;
        } else {
          result[key] = this.redactObject(value);
        }
      }
      return result as T;
    }

    return obj;
  }
}
