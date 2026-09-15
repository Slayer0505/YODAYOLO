import { UniversalYodaAdapter, type UniversalAdapterOptions } from './universal';

export class ClaudeAdapter extends UniversalYodaAdapter {
  constructor(options: Omit<UniversalAdapterOptions, 'clientType' | 'name'>) {
    super({
      ...options,
      name: 'claude-adapter',
      clientType: 'claude',
      description: 'Anthropic Claude & Claude Code Terminal Adapter',
    });
  }
}
