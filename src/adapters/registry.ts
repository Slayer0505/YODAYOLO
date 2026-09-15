import type { YodaAdapter, ClientType } from './contract';
import type { L0EventLedger } from '../db/ledger';
import type { EvidenceBus } from '../evidence/bus';
import type { L1ExperienceManager } from '../l1/experience';
import type { L3ContextCompiler } from '../l3/compiler';
import type { HeartSupervisor } from '../heart/supervisor';
import { AntigravityAdapter } from './antigravity';
import { OpenCodeAdapter } from './opencode';
import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';
import { UniversalYodaAdapter } from './universal';

export interface AdapterRegistryOptions {
  ledger: L0EventLedger;
  evidenceBus: EvidenceBus;
  experienceManager: L1ExperienceManager;
  contextCompiler?: L3ContextCompiler;
  heartSupervisor?: HeartSupervisor;
}

export class AdapterRegistry {
  private adapters: Map<string, YodaAdapter> = new Map();
  private options: AdapterRegistryOptions;

  constructor(options: AdapterRegistryOptions) {
    this.options = options;

    // Initialize built-in standard adapters
    const antigravity = new AntigravityAdapter(options);
    antigravity.connect();
    this.registerAdapter('antigravity', antigravity);

    const opencode = new OpenCodeAdapter(options);
    opencode.connect();
    this.registerAdapter('opencode', opencode);

    const claude = new ClaudeAdapter(options);
    claude.connect();
    this.registerAdapter('claude', claude);

    const codex = new CodexAdapter(options);
    codex.connect();
    this.registerAdapter('codex', codex);

    const universal = new UniversalYodaAdapter({
      ...options,
      name: 'universal-conversation-adapter',
      clientType: 'universal',
    });
    universal.connect();
    this.registerAdapter('universal', universal);
  }

  public registerAdapter(id: string, adapter: YodaAdapter) {
    this.adapters.set(id.toLowerCase(), adapter);
  }

  public getAdapter(id: string): YodaAdapter | undefined {
    return this.adapters.get(id.toLowerCase());
  }

  public getAllAdapters(): YodaAdapter[] {
    return Array.from(this.adapters.values());
  }

  public async getAdaptersStatus(): Promise<Array<{
    id: string;
    name: string;
    clientType: ClientType;
    description: string;
    connected: boolean;
  }>> {
    const list = [];
    for (const [id, adapter] of this.adapters.entries()) {
      list.push({
        id,
        name: adapter.name,
        clientType: adapter.clientType,
        description: adapter.description,
        connected: adapter.isConnected(),
      });
    }
    return list;
  }
}
