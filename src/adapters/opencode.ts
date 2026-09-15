import { UniversalYodaAdapter, type UniversalAdapterOptions } from './universal';

export class OpenCodeAdapter extends UniversalYodaAdapter {
  constructor(options: Omit<UniversalAdapterOptions, 'clientType' | 'name'>) {
    super({
      ...options,
      name: 'opencode-adapter',
      clientType: 'opencode',
      description: 'OpenCode CLI & Terminal Agent Cognitive Adapter',
    });
  }
}
