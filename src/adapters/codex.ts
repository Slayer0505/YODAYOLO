import { UniversalYodaAdapter, type UniversalAdapterOptions } from './universal';

export class CodexAdapter extends UniversalYodaAdapter {
  constructor(options: Omit<UniversalAdapterOptions, 'clientType' | 'name'>) {
    super({
      ...options,
      name: 'codex-adapter',
      clientType: 'codex',
      description: 'OpenAI Codex, GPT & IDE Pair-Programming Cognitive Adapter',
    });
  }
}
