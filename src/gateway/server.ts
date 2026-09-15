import type { Server } from 'bun';
import type { L0EventLedger } from '../db/ledger';
import type { EvidenceBus } from '../evidence/bus';
import type { L1ExperienceManager } from '../l1/experience';
import type { L3ContextCompiler } from '../l3/compiler';
import type { ReasoningProvider } from '../types';
import type { L2KnowledgeStore } from '../l2/store';
import type { ProvenanceService } from '../l2/provenance';
import type { L2LearningEngine } from '../l2/learning_engine';
import type { L4Store } from '../l4/store';
import type { L4MetaEngine } from '../l4/meta_engine';
import type { HeartSupervisor } from '../heart/supervisor';
import type { DreamingConsolidator } from '../consolidation/dreaming';
import type { CognitiveLoopOrchestrator } from '../orchestrator/cognitive_loop';
import type { AdapterRegistry } from '../adapters/registry';
import { handleRequest } from './handlers';

export interface GatewayServerOptions {
  port?: number;
  hostname?: string;
  ledger: L0EventLedger;
  provider: ReasoningProvider;
  defaultModel?: string;
  experienceManager?: L1ExperienceManager;
  evidenceBus?: EvidenceBus;
  contextCompiler?: L3ContextCompiler;
  l2Store?: L2KnowledgeStore;
  provenanceService?: ProvenanceService;
  learningEngine?: L2LearningEngine;
  l4Store?: L4Store;
  metaEngine?: L4MetaEngine;
  heartSupervisor?: HeartSupervisor;
  consolidator?: DreamingConsolidator;
  cognitiveLoop?: CognitiveLoopOrchestrator;
  cortex?: any;
  toolRegistry?: any;
  dreamScheduler?: any;
  beadsManager?: any;
  sessionManager?: any;
  replayEngine?: any;
  causalityEngine?: any;
  adapterRegistry?: AdapterRegistry;
}

export class GatewayServer {
  private port: number;
  private hostname: string;
  private ledger: L0EventLedger;
  private provider: ReasoningProvider;
  private defaultModel?: string;
  private experienceManager?: L1ExperienceManager;
  private evidenceBus?: EvidenceBus;
  private contextCompiler?: L3ContextCompiler;
  private l2Store?: L2KnowledgeStore;
  private provenanceService?: ProvenanceService;
  private learningEngine?: L2LearningEngine;
  private l4Store?: L4Store;
  private metaEngine?: L4MetaEngine;
  private heartSupervisor?: HeartSupervisor;
  private consolidator?: DreamingConsolidator;
  private cognitiveLoop?: CognitiveLoopOrchestrator;
  private cortex?: any;
  private toolRegistry?: any;
  private dreamScheduler?: any;
  private beadsManager?: any;
  private sessionManager?: any;
  private replayEngine?: any;
  private causalityEngine?: any;
  private adapterRegistry?: AdapterRegistry;
  private server: Server<any> | null = null;

  constructor(options: GatewayServerOptions) {
    this.port = options.port || 8080;
    this.hostname = options.hostname || '127.0.0.1';
    this.ledger = options.ledger;
    this.provider = options.provider;
    this.defaultModel = options.defaultModel;
    this.experienceManager = options.experienceManager;
    this.evidenceBus = options.evidenceBus;
    this.contextCompiler = options.contextCompiler;
    this.l2Store = options.l2Store;
    this.provenanceService = options.provenanceService;
    this.learningEngine = options.learningEngine;
    this.l4Store = options.l4Store;
    this.metaEngine = options.metaEngine;
    this.heartSupervisor = options.heartSupervisor;
    this.consolidator = options.consolidator;
    this.cognitiveLoop = options.cognitiveLoop;
    this.cortex = options.cortex;
    this.toolRegistry = options.toolRegistry;
    this.dreamScheduler = options.dreamScheduler;
    this.beadsManager = options.beadsManager;
    this.sessionManager = options.sessionManager;
    this.replayEngine = options.replayEngine;
    this.causalityEngine = options.causalityEngine;
    this.adapterRegistry = options.adapterRegistry;

    if (this.evidenceBus && this.learningEngine) {
      this.evidenceBus.setLearningEngine(this.learningEngine);
    }
    if (this.evidenceBus && this.metaEngine) {
      this.evidenceBus.setMetaEngine(this.metaEngine);
    }
    if (this.evidenceBus && this.dreamScheduler) {
      this.evidenceBus.setDreamScheduler(this.dreamScheduler);
    }
  }

  private userSelectedModel?: string;
  private isUserSelected: boolean = false;

  public setProvider(provider: ReasoningProvider): void {
    this.provider = provider;
    if (this.cognitiveLoop) {
      this.cognitiveLoop.updateProvider(provider);
    }
    console.log(`[YODA Gateway] Provider hot-swapped to: ${provider.name}`);
  }

  public setDefaultModel(model: string, userSelected: boolean = true): void {
    this.defaultModel = model;
    this.userSelectedModel = model;
    this.isUserSelected = userSelected;
    if (this.provider) {
      this.provider.defaultModel = model;
    }
  }

  public getProvider(): ReasoningProvider {
    return this.provider;
  }

  public start(): Server<any> {
    if (this.server) {
      return this.server;
    }

    const self = this;

    this.server = Bun.serve({
      port: this.port,
      hostname: this.hostname,
      fetch(req: Request) {
        self.dreamScheduler?.recordActivity();
        return handleRequest(req, {
          ledger: self.ledger,
          provider: self.provider,
          defaultModel: self.defaultModel,
          userSelectedModel: self.userSelectedModel,
          isUserSelected: self.isUserSelected,
          experienceManager: self.experienceManager,
          evidenceBus: self.evidenceBus,
          contextCompiler: self.contextCompiler,
          l2Store: self.l2Store,
          provenanceService: self.provenanceService,
          learningEngine: self.learningEngine,
          l4Store: self.l4Store,
          metaEngine: self.metaEngine,
          heartSupervisor: self.heartSupervisor,
          consolidator: self.consolidator,
          cognitiveLoop: self.cognitiveLoop,
          cortex: self.cortex,
          toolRegistry: self.toolRegistry,
          dreamScheduler: self.dreamScheduler,
          beadsManager: self.beadsManager,
          sessionManager: self.sessionManager,
          replayEngine: self.replayEngine,
          causalityEngine: self.causalityEngine,
          adapterRegistry: self.adapterRegistry,
          onSwitchProvider: (p, model, userSelected) => {
            self.setProvider(p);
            if (model) self.setDefaultModel(model, userSelected ?? true);
          },
        });
      },
    });

    console.log(
      `[YODA Gateway] Listening on http://${this.hostname}:${this.port} (Provider: ${this.provider.name}, YODA Cognitive OS Active)`
    );
    return this.server;
  }

  public stop(): void {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
      console.log(`[YODA Gateway] Stopped`);
    }
  }

  public getPort(): number {
    return this.server?.port || this.port;
  }

  public getHostname(): string {
    return this.server?.hostname || this.hostname;
  }
}
