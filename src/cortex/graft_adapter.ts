import { spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { CodebaseCortexContext, CodebaseCortexExcerpt } from '../types';

export interface GraftAdapterOptions {
  graftPath?: string;
  timeoutMs?: number;
  enabled?: boolean;
}

/**
 * Graft Codebase Context Graph Adapter.
 * Integrates with Graft repositories (.graft markdown context graphs / graft CLI)
 * while providing zero-downtime, fail-open fallback if Graft is unbuilt or unavailable.
 */
export class GraftAdapter {
  private graftPath: string;
  private timeoutMs: number;
  private enabled: boolean;

  constructor(options: GraftAdapterOptions = {}) {
    this.graftPath =
      options.graftPath ||
      process.env.GRAFT_PATH ||
      join(process.cwd(), '..', 'boom', 'Graft');
    this.timeoutMs = options.timeoutMs || 2500;
    this.enabled = options.enabled ?? true;
  }

  /**
   * Checks if Graft CLI or pre-indexed .graft cache is accessible.
   */
  public isAvailable(rootDir: string): boolean {
    if (!this.enabled) return false;

    // 1. Check if .graft directory exists in workspace
    const localGraftDir = join(rootDir, '.graft');
    if (existsSync(localGraftDir)) return true;

    // 2. Check if graft CLI or dist exists in graftPath
    const graftCliJs = join(this.graftPath, 'dist', 'cli.js');
    if (existsSync(graftCliJs)) return true;

    return false;
  }

  /**
   * Queries Graft for codebase context.
   * Fails open (returns null) on any error so the native regex extractor takes over.
   */
  public async queryContext(prompt: string, rootDir: string): Promise<CodebaseCortexContext | null> {
    if (!this.enabled) return null;

    try {
      // 1. First priority: Try reading pre-generated .graft markdown graph files
      const graphContext = this.readGraftMarkdownGraph(rootDir, prompt);
      if (graphContext) return graphContext;

      // 2. Second priority: Try running Graft CLI if built
      const cliContext = await this.spawnGraftCli(rootDir, prompt);
      if (cliContext) return cliContext;

      return null;
    } catch (err) {
      // Fail-open contract: never crash the Brain if Graft fails
      return null;
    }
  }

  /**
   * Reads .graft/ context files (e.g. index.md, graph.md) if present in workspace.
   */
  public readGraftMarkdownGraph(rootDir: string, query: string): CodebaseCortexContext | null {
    const graftDir = join(rootDir, '.graft');
    if (!existsSync(graftDir)) return null;

    try {
      const files = readdirSync(graftDir).filter((f) => f.endsWith('.md'));
      if (files.length === 0) return null;

      const excerpts: CodebaseCortexExcerpt[] = [];
      const queryLower = query.toLowerCase();
      const queryWords = queryLower.split(/\W+/).filter((w) => w.length > 2);

      for (const f of files) {
        const fullPath = join(graftDir, f);
        const content = readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        // Score file relevance to query
        let matchCount = 0;
        for (const word of queryWords) {
          if (content.toLowerCase().includes(word)) matchCount++;
        }

        if (matchCount > 0 || files.length <= 3) {
          excerpts.push({
            filePath: `.graft/${f}`,
            line: 1,
            symbolName: f.replace('.md', ''),
            kind: 'graft_markdown_graph',
            snippet: lines.slice(0, 20).join('\n'),
            relevanceScore: Math.min(1.0, 0.5 + matchCount * 0.15),
          });
        }
      }

      if (excerpts.length === 0) return null;

      excerpts.sort((a, b) => b.relevanceScore - a.relevanceScore);

      return {
        fingerprint: `graft-${files.length}`,
        filesIndexed: files.length,
        totalSymbols: excerpts.length,
        relevantExcerpts: excerpts.slice(0, 5),
        fileWiringSummary: `Graft Context Graph (.graft/): ${files.length} linked markdown nodes active.`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Spawns node dist/cli.js context if built.
   */
  private async spawnGraftCli(rootDir: string, query: string): Promise<CodebaseCortexContext | null> {
    const graftCliJs = join(this.graftPath, 'dist', 'cli.js');
    if (!existsSync(graftCliJs)) return null;

    try {
      const proc = spawnSync('node', [graftCliJs, 'context', query, '--cwd', rootDir], {
        timeout: this.timeoutMs,
        encoding: 'utf8',
      });

      if (proc.status !== 0 || !proc.stdout) return null;

      const output = proc.stdout.trim();
      if (!output) return null;

      return {
        fingerprint: 'graft-cli-live',
        filesIndexed: 1,
        totalSymbols: 1,
        relevantExcerpts: [
          {
            filePath: 'graft://context',
            line: 1,
            symbolName: 'graft_context_graph',
            kind: 'graft_markdown_graph',
            snippet: output.substring(0, 1500),
            relevanceScore: 0.95,
          },
        ],
        fileWiringSummary: 'Graft Knowledge Graph Engine (CLI Live)',
      };
    } catch {
      return null;
    }
  }
}
