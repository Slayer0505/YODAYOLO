import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type ClientConnectionStatus =
  | 'CONNECTED_REAL_CLIENT'
  | 'CONNECTED_API'
  | 'AVAILABLE'
  | 'NEEDS_SETUP'
  | 'UNAVAILABLE';

export interface DetectedAIClient {
  id: string;
  name: string;
  type: string;
  integrationType: 'REAL_CLIENT' | 'API_PATH' | 'UNIVERSAL_CONNECTOR' | 'LOCAL_ENGINE';
  detected: boolean;
  active: boolean;
  connectionStatus: ClientConnectionStatus;
  installPath?: string;
  authStatus: 'configured' | 'missing_key' | 'not_required' | 'unknown';
  recommendedModel: string;
  setupInstructions?: string;
  notes?: string;
}

export class AIClientDetector {
  public static async detectAll(): Promise<DetectedAIClient[]> {
    const home = homedir();
    const results: DetectedAIClient[] = [];

    // 1. Antigravity (Real Client Integration)
    const antigravityPath = join(home, '.gemini', 'antigravity-cli');
    const hasAntigravity = existsSync(antigravityPath) || existsSync(join(process.cwd(), 'GEMINI.md'));
    results.push({
      id: 'antigravity',
      name: 'Antigravity IDE & CLI',
      type: 'agent',
      integrationType: 'REAL_CLIENT',
      detected: hasAntigravity,
      active: hasAntigravity,
      connectionStatus: hasAntigravity ? 'CONNECTED_REAL_CLIENT' : 'UNAVAILABLE',
      installPath: hasAntigravity ? antigravityPath : undefined,
      authStatus: 'not_required',
      recommendedModel: 'Gemini 3.7 Flash / Pro',
      setupInstructions: 'Antigravity communicates with YODA via live Evidence Bus and L2 shared rules.',
      notes: 'Real native agent integration active.',
    });

    // 2. OpenCode (Real Client Integration)
    const opencodePath = join(home, '.config', 'opencode');
    const hasOpenCode = existsSync(opencodePath) || existsSync(join(home, '.opencode'));
    results.push({
      id: 'opencode',
      name: 'OpenCode',
      type: 'terminal_agent',
      integrationType: 'REAL_CLIENT',
      detected: hasOpenCode,
      active: hasOpenCode,
      connectionStatus: hasOpenCode ? 'CONNECTED_REAL_CLIENT' : 'AVAILABLE',
      installPath: hasOpenCode ? opencodePath : undefined,
      authStatus: 'not_required',
      recommendedModel: 'yoda/neutral-reasoner',
      setupInstructions: 'Set model to yoda/model-name or point provider to http://127.0.0.1:8080/v1',
      notes: 'Real terminal agent proxy integration active.',
    });

    // 3. Anthropic Claude / Claude Code (API Path)
    const hasClaudeKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const claudePath = join(home, '.claude');
    const hasClaude = existsSync(claudePath) || hasClaudeKey;
    results.push({
      id: 'claude',
      name: 'Claude / Claude Code',
      type: 'cloud_agent',
      integrationType: 'API_PATH',
      detected: hasClaude,
      active: hasClaudeKey,
      connectionStatus: hasClaudeKey ? 'CONNECTED_API' : 'NEEDS_SETUP',
      authStatus: hasClaudeKey ? 'configured' : 'missing_key',
      recommendedModel: 'claude-3-5-sonnet',
      setupInstructions: hasClaudeKey ? 'Ready for inference.' : 'Provide ANTHROPIC_API_KEY in environment or configure in YODA.',
      notes: 'API path integration. Browser web tabs require extension connector.',
    });

    // 4. OpenAI / Codex / GPT (API Path)
    const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
    results.push({
      id: 'codex',
      name: 'OpenAI GPT / Codex',
      type: 'cloud_model',
      integrationType: 'API_PATH',
      detected: hasOpenAIKey,
      active: hasOpenAIKey,
      connectionStatus: hasOpenAIKey ? 'CONNECTED_API' : 'NEEDS_SETUP',
      authStatus: hasOpenAIKey ? 'configured' : 'missing_key',
      recommendedModel: 'gpt-4o',
      setupInstructions: hasOpenAIKey ? 'Ready for inference.' : 'Provide OPENAI_API_KEY in environment or configure in YODA.',
      notes: 'API path integration. Browser web tabs require extension connector.',
    });

    // 5. Google Gemini (API Path)
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
    results.push({
      id: 'gemini',
      name: 'Google Gemini',
      type: 'cloud_model',
      integrationType: 'API_PATH',
      detected: hasGeminiKey,
      active: hasGeminiKey,
      connectionStatus: hasGeminiKey ? 'CONNECTED_API' : 'NEEDS_SETUP',
      authStatus: hasGeminiKey ? 'configured' : 'missing_key',
      recommendedModel: 'gemini-1.5-pro',
      setupInstructions: hasGeminiKey ? 'Ready for inference.' : 'Provide GEMINI_API_KEY in environment or configure in YODA.',
      notes: 'API path integration.',
    });

    // 6. Ollama (Optional Local Engine)
    let isOllamaRunning = false;
    try {
      const resp = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1000) });
      isOllamaRunning = resp.ok;
    } catch {}

    results.push({
      id: 'ollama',
      name: 'Ollama Local Engine (Optional)',
      type: 'local_engine',
      integrationType: 'LOCAL_ENGINE',
      detected: isOllamaRunning,
      active: isOllamaRunning,
      connectionStatus: isOllamaRunning ? 'AVAILABLE' : 'UNAVAILABLE',
      authStatus: 'not_required',
      recommendedModel: 'qwen2.5:3b',
      setupInstructions: isOllamaRunning ? 'Local inference ready' : 'Optional local runner (not required for YODA).',
      notes: 'Optional local inference substrate.',
    });

    // 7. Cursor / Aider / External IDEs (OpenAI Compatibility)
    results.push({
      id: 'external_ides',
      name: 'Cursor / Aider / External IDEs',
      type: 'ide_extension',
      integrationType: 'UNIVERSAL_CONNECTOR',
      detected: true,
      active: true,
      connectionStatus: 'AVAILABLE',
      authStatus: 'not_required',
      recommendedModel: 'Any OpenAI-compatible model',
      setupInstructions: 'Set OpenAI Base URL to http://127.0.0.1:8080/v1 in your IDE/CLI settings.',
      notes: 'Plug-and-play proxy support for any standard AI tool.',
    });

    // 8. Universal REST / SSE Adapter (Real Client Integration)
    results.push({
      id: 'universal',
      name: 'Universal AI Adapter (SDK / Scripts)',
      type: 'universal_stream',
      integrationType: 'UNIVERSAL_CONNECTOR',
      detected: true,
      active: true,
      connectionStatus: 'CONNECTED_REAL_CLIENT',
      authStatus: 'not_required',
      recommendedModel: 'Any selected model',
      setupInstructions: 'Use HTTP REST endpoints (/api/adapters/capture, /api/compile) to hook any custom AI pipeline.',
      notes: 'Universal connector for programmatic AI streams and custom agent runtimes.',
    });

    // 9. Closed Web Browser Chats (Honest Boundary)
    results.push({
      id: 'web_chats',
      name: 'ChatGPT / Claude / Gemini Web (Browser Tabs)',
      type: 'browser_tab',
      integrationType: 'API_PATH',
      detected: false,
      active: false,
      connectionStatus: 'UNAVAILABLE',
      authStatus: 'unknown',
      recommendedModel: 'N/A',
      setupInstructions: 'Browser tab DOM sandboxes cannot be hooked via localhost sockets. Requires a dedicated browser extension bridge.',
      notes: 'Honest boundary: standard browser web chats are not automatically intercepted without an extension.',
    });

    return results;
  }
}
