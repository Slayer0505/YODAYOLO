import { spawnSync } from 'child_process';

export interface GitToolResult {
  success: boolean;
  command: string;
  output?: string;
  error?: string;
  exitCode: number;
}

export class GitAdapter {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  public status(): GitToolResult {
    return this.runGit(['status', '--short']);
  }

  public diff(options: { staged?: boolean; file?: string } = {}): GitToolResult {
    const args = ['diff'];
    if (options.staged) args.push('--staged');
    if (options.file) args.push(options.file);
    return this.runGit(args);
  }

  public log(limit: number = 5): GitToolResult {
    return this.runGit(['log', `-n`, limit.toString(), '--oneline']);
  }

  public commit(message: string, files: string[] = []): GitToolResult {
    if (files.length > 0) {
      const addRes = this.runGit(['add', ...files]);
      if (!addRes.success) return addRes;
    }
    return this.runGit(['commit', '-m', message]);
  }

  private runGit(args: string[]): GitToolResult {
    try {
      const proc = spawnSync('git', args, {
        cwd: this.cwd,
        encoding: 'utf8',
        timeout: 5000,
      });

      const exitCode = proc.status ?? (proc.error ? 1 : 0);
      return {
        success: exitCode === 0,
        command: `git ${args.join(' ')}`,
        output: proc.stdout?.trim() || '',
        error: proc.stderr?.trim() || (proc.error ? proc.error.message : undefined),
        exitCode,
      };
    } catch (err: any) {
      return {
        success: false,
        command: `git ${args.join(' ')}`,
        error: err.message,
        exitCode: 1,
      };
    }
  }
}
