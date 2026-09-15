import { randomUUID } from 'crypto';
import type { EvidenceBus } from '../evidence/bus';
import type { HeartSupervisor } from '../heart/supervisor';
import type {
  EvidenceSignal,
  HeartEvaluation,
  ToolDefinition,
  ToolExecutionParams,
  ToolExecutionOutput,
} from '../types';
import { FileSystemAdapter } from './filesystem';
import { GitAdapter } from './git';
import { TerminalAdapter } from './terminal';

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export class ToolRegistry {
  private tools: Map<string, ToolHandler> = new Map();
  private heartSupervisor?: HeartSupervisor;
  private evidenceBus?: EvidenceBus;

  public fs: FileSystemAdapter;
  public git: GitAdapter;
  public terminal: TerminalAdapter;

  constructor(options: {
    cwd?: string;
    heartSupervisor?: HeartSupervisor;
    evidenceBus?: EvidenceBus;
  } = {}) {
    const cwd = options.cwd || process.cwd();
    this.fs = new FileSystemAdapter(cwd);
    this.git = new GitAdapter(cwd);
    this.terminal = new TerminalAdapter(cwd);
    this.heartSupervisor = options.heartSupervisor;
    this.evidenceBus = options.evidenceBus;

    this.registerBuiltinTools();
  }

  public registerTool(handler: ToolHandler): void {
    this.tools.set(handler.definition.name, handler);
  }

  public getTool(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Validates arguments against parameter definitions.
   */
  public validateArgs(definition: ToolDefinition, args: Record<string, unknown>): { valid: boolean; error?: string } {
    if (!definition.parameters) return { valid: true };

    for (const [paramName, paramDef] of Object.entries(definition.parameters as Record<string, any>)) {
      const val = args[paramName];
      if (paramDef.required && (val === undefined || val === null || val === '')) {
        return { valid: false, error: `Missing required argument: '${paramName}' for tool '${definition.name}'` };
      }

      if (val !== undefined && val !== null) {
        if (paramDef.type === 'string' && typeof val !== 'string') {
          return { valid: false, error: `Argument '${paramName}' must be a string, received ${typeof val}` };
        }
        if (paramDef.type === 'number' && typeof val !== 'number') {
          return { valid: false, error: `Argument '${paramName}' must be a number, received ${typeof val}` };
        }
        if (paramDef.type === 'boolean' && typeof val !== 'boolean') {
          return { valid: false, error: `Argument '${paramName}' must be a boolean, received ${typeof val}` };
        }
        if (paramDef.type === 'array' && !Array.isArray(val)) {
          return { valid: false, error: `Argument '${paramName}' must be an array, received ${typeof val}` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Executes a tool with mandatory Heart BIOS safety evaluation.
   */
  public async executeTool(params: ToolExecutionParams): Promise<ToolExecutionOutput> {
    const start = performance.now();
    const handler = this.tools.get(params.toolName);

    if (!handler) {
      return {
        success: false,
        toolName: params.toolName,
        error: `Tool not registered: ${params.toolName}`,
        latencyMs: performance.now() - start,
      };
    }

    const args = { ...(params.args || {}) };
    if (args.path && !args.filePath) args.filePath = args.path;
    if (args.path && !args.dirPath) args.dirPath = args.path;
    if (args.file && !args.filePath) args.filePath = args.file;
    params.args = args;

    // 0. Schema argument validation
    const validation = this.validateArgs(handler.definition, params.args);
    if (!validation.valid) {
      return {
        success: false,
        toolName: params.toolName,
        error: validation.error,
        latencyMs: performance.now() - start,
      };
    }

    const taskContext = params.taskContext || 'tool_execution';
    const actionSummary = `${params.toolName}(${JSON.stringify(params.args)})`;

    // 1. Mandatory Heart BIOS pre-execution evaluation
    let heartEval: HeartEvaluation | undefined;
    if (this.heartSupervisor) {
      heartEval = this.heartSupervisor.evaluateAction({
        action: actionSummary,
        context: taskContext,
        user_override: params.userOverride ?? false,
      });

      if (heartEval.requires_human_confirmation && !heartEval.user_override_granted) {
        return {
          success: false,
          toolName: params.toolName,
          heartEvaluation: heartEval,
          error: `Heart BIOS Blocked Execution: ${heartEval.rationale}`,
          latencyMs: performance.now() - start,
        };
      }
    }

    // 2. Tool Execution
    try {
      const output = await handler.execute(params.args);
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;

      // 3. Emit Sensory Evidence Signal if EvidenceBus is connected
      let evidenceSignalId: string | undefined;
      if (this.evidenceBus) {
        const signalId = `sig-tool-${randomUUID()}`;
        const signal: EvidenceSignal = {
          signal_id: signalId,
          source: 'tool',
          type: 'tool_result',
          correlation_id: params.correlationId,
          project_id: 'default',
          files: (params.args.filePath as string) ? [params.args.filePath as string] : [],
          payload: {
            tool_name: params.toolName,
            args: params.args,
            output,
            success: true,
          },
          timestamp: new Date().toISOString(),
        };
        this.evidenceBus.ingestSignal(signal);
        evidenceSignalId = signalId;
      }

      return {
        success: true,
        toolName: params.toolName,
        output,
        heartEvaluation: heartEval,
        evidenceSignalId,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;

      if (this.evidenceBus) {
        const signalId = `sig-tool-${randomUUID()}`;
        const signal: EvidenceSignal = {
          signal_id: signalId,
          source: 'tool',
          type: 'test_fail',
          correlation_id: params.correlationId,
          project_id: 'default',
          files: [],
          payload: {
            tool_name: params.toolName,
            error: err.message,
            success: false,
          },
          timestamp: new Date().toISOString(),
        };
        this.evidenceBus.ingestSignal(signal);
      }

      return {
        success: false,
        toolName: params.toolName,
        error: err.message,
        heartEvaluation: heartEval,
        latencyMs,
      };
    }
  }

  private registerBuiltinTools(): void {
    // Filesystem: Read
    this.registerTool({
      definition: {
        name: 'fs_read_file',
        description: 'Reads content of a file from the workspace filesystem',
        category: 'filesystem',
        parameters: { filePath: { type: 'string', required: true } },
      },
      execute: (args) => this.fs.readFile(args.filePath as string),
    });

    // Filesystem: Write
    this.registerTool({
      definition: {
        name: 'fs_write_file',
        description: 'Writes content to a file in the workspace filesystem',
        category: 'filesystem',
        parameters: {
          filePath: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      execute: (args) => this.fs.writeFile(args.filePath as string, args.content as string),
    });

    // Filesystem: List
    this.registerTool({
      definition: {
        name: 'fs_list_directory',
        description: 'Lists files and directories at a given path',
        category: 'filesystem',
        parameters: { dirPath: { type: 'string', default: '.' } },
      },
      execute: (args) => this.fs.listDirectory((args.dirPath as string) || '.'),
    });

    // Git: Status
    this.registerTool({
      definition: {
        name: 'git_status',
        description: 'Queries git working tree status',
        category: 'git',
        parameters: {},
      },
      execute: () => this.git.status(),
    });

    // Git: Diff
    this.registerTool({
      definition: {
        name: 'git_diff',
        description: 'Inspects git diff in working directory',
        category: 'git',
        parameters: { staged: { type: 'boolean' }, file: { type: 'string' } },
      },
      execute: (args) => this.git.diff({ staged: args.staged as boolean, file: args.file as string }),
    });

    // Terminal: Execute
    this.registerTool({
      definition: {
        name: 'terminal_exec',
        description: 'Executes a bash shell command in the workspace directory',
        category: 'terminal',
        parameters: { command: { type: 'string', required: true } },
      },
      execute: (args) => this.terminal.execute(args.command as string),
    });
  }
}
