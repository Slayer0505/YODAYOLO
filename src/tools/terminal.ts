import { spawnSync } from 'child_process';

export interface TerminalExecutionResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export class TerminalAdapter {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  public execute(command: string, timeoutMs: number = 10000): TerminalExecutionResult {
    const start = performance.now();
    try {
      const proc = spawnSync('sh', ['-c', command], {
        cwd: this.cwd,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });

      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      const exitCode = proc.status ?? (proc.error ? 124 : 0);

      return {
        success: exitCode === 0,
        command,
        stdout: proc.stdout || '',
        stderr: proc.stderr || (proc.error ? proc.error.message : ''),
        exitCode,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        success: false,
        command,
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        durationMs,
      };
    }
  }
}
