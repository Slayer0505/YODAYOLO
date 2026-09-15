import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import type { CodebaseCortexContext, CodebaseCortexExcerpt } from '../types';
import { GraftAdapter } from './graft_adapter';

export interface CodebaseSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'export' | 'variable';
  filePath: string;
  signature?: string;
  cruxCode: string;
  dependencies: string[];
  line: number;
}

export interface CodebaseFileNode {
  relativePath: string;
  mtimeMs: number;
  sizeBytes: number;
  symbols: CodebaseSymbol[];
  imports: string[];
  exports: string[];
}

export interface CodebaseCortexOptions {
  rootDir?: string;
  includeExtensions?: string[];
  excludeDirs?: string[];
  maxFilesToScan?: number;
  graftAdapter?: GraftAdapter;
}

export class CodebaseCortex {
  private rootDir: string;
  private includeExtensions: Set<string>;
  private excludeDirs: Set<string>;
  private maxFilesToScan: number;
  private graftAdapter: GraftAdapter;

  private fileNodes: Map<string, CodebaseFileNode> = new Map();
  private lastFingerprint: string = '';
  private lastIndexTime: number = 0;

  constructor(options: CodebaseCortexOptions = {}) {
    this.rootDir = options.rootDir || process.env.WORKSPACE_ROOT || process.env.CORTEX_ROOT || process.cwd();
    this.includeExtensions = new Set(
      options.includeExtensions || ['.ts', '.js', '.mjs', '.cjs', '.py', '.go', '.rs', '.json', '.sql']
    );
    this.excludeDirs = new Set(
      options.excludeDirs || ['node_modules', '.git', 'dist', 'build', '.gbrain-data', '.gbrain-lock']
    );
    this.maxFilesToScan = options.maxFilesToScan || 300;
    this.graftAdapter = options.graftAdapter || new GraftAdapter();
  }

  public getGraftAdapter(): GraftAdapter {
    return this.graftAdapter;
  }

  public getRootDir(): string {
    return this.rootDir;
  }

  public setRootDir(rootDir: string): void {
    this.rootDir = rootDir;
    this.lastFingerprint = ''; // Invalidate cache
    this.fileNodes.clear();
  }

  /**
   * Computes a fast working-tree fingerprint from file paths, modification times and sizes.
   */
  public computeFingerprint(): { fingerprint: string; filePaths: string[] } {
    const filePaths: string[] = [];
    this.walkDirectory(this.rootDir, filePaths);

    const hash = createHash('sha256');
    for (const fp of filePaths) {
      try {
        const st = statSync(fp);
        hash.update(`${fp}:${st.mtimeMs}:${st.size}`);
      } catch {}
    }

    return {
      fingerprint: hash.digest('hex').substring(0, 16),
      filePaths,
    };
  }

  /**
   * Refreshes the codebase symbol graph if working tree is modified.
   */
  public refreshIfStale(): void {
    const { fingerprint, filePaths } = this.computeFingerprint();
    if (fingerprint === this.lastFingerprint && this.fileNodes.size > 0) {
      return; // Cache is fresh!
    }

    const newNodes = new Map<string, CodebaseFileNode>();

    for (const fullPath of filePaths) {
      try {
        const st = statSync(fullPath);
        const relPath = relative(this.rootDir, fullPath);
        const content = readFileSync(fullPath, 'utf8');
        const node = this.parseFileContent(relPath, content, st.mtimeMs, st.size);
        newNodes.set(relPath, node);
      } catch {}
    }

    this.fileNodes = newNodes;
    this.lastFingerprint = fingerprint;
    this.lastIndexTime = Date.now();
  }

  /**
   * Queries the Codebase Cortex for relevant symbols, call hierarchies, and crux excerpts.
   */
  public queryCortex(
    prompt: string,
    options: { maxExcerpts?: number; maxTokensEstimate?: number } = {}
  ): CodebaseCortexContext {
    this.refreshIfStale();

    const maxExcerpts = options.maxExcerpts ?? 5;
    const searchTerms = prompt
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const termSet = new Set(searchTerms);
    const candidateExcerpts: CodebaseCortexExcerpt[] = [];
    const wiringSummary: string[] = [];

    // 0. Check Graft Context Graph if available (.graft/ or graft CLI)
    try {
      const graftGraph = this.graftAdapter.readGraftMarkdownGraph(this.rootDir, prompt);
      if (graftGraph && graftGraph.relevantExcerpts.length > 0) {
        for (const ge of graftGraph.relevantExcerpts) {
          candidateExcerpts.push(ge);
        }
        if (typeof graftGraph.fileWiringSummary === 'string' && graftGraph.fileWiringSummary) {
          wiringSummary.push(graftGraph.fileWiringSummary);
        }
      }
    } catch {}

    let totalSymbols = 0;

    for (const [relPath, node] of this.fileNodes.entries()) {
      totalSymbols += node.symbols.length;

      // Check file level match
      const pathMatches = searchTerms.filter((term) => relPath.toLowerCase().includes(term)).length;

      for (const sym of node.symbols) {
        let score = pathMatches * 1.5;
        const symNameLower = sym.name.toLowerCase();

        // Exact name hit
        if (termSet.has(symNameLower)) {
          score += 5.0;
        } else {
          // Partial token hit
          for (const term of termSet) {
            if (symNameLower.includes(term)) {
              score += 2.0;
            }
          }
        }

        // Check crux code for keyword occurrences
        const cruxLower = sym.cruxCode.toLowerCase();
        for (const term of termSet) {
          if (cruxLower.includes(term)) {
            score += 0.5;
          }
        }

        if (score > 1.0) {
          candidateExcerpts.push({
            filePath: sym.filePath,
            symbolName: sym.name,
            kind: sym.kind,
            signature: sym.signature,
            cruxCode: sym.cruxCode,
            dependencies: sym.dependencies,
            relevanceScore: Math.round(score * 100) / 100,
          });
        }
      }

      // Record wiring summary for matched files
      if (pathMatches > 0 && node.exports.length > 0) {
        wiringSummary.push(
          `${relPath}: exports [${node.exports.slice(0, 5).join(', ')}] | imports [${node.imports.slice(0, 4).join(', ')}]`
        );
      }
    }

    // Sort excerpts by relevance score descending
    candidateExcerpts.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topExcerpts = candidateExcerpts.slice(0, maxExcerpts);

    return {
      workingDirectory: this.rootDir,
      fingerprint: this.lastFingerprint,
      indexedFilesCount: this.fileNodes.size,
      totalSymbolsCount: totalSymbols,
      relevantExcerpts: topExcerpts,
      fileWiringSummary: wiringSummary.slice(0, 4),
    };
  }

  /**
   * Formats a Codebase Cortex query result into a clean Markdown block for L3 context.
   */
  public formatCortexMarkdown(cortexContext: CodebaseCortexContext): string {
    if (cortexContext.relevantExcerpts.length === 0 && cortexContext.fileWiringSummary.length === 0) {
      return `### CODEBASE CORTEX (WORKING TREE)\n- Indexed files: ${cortexContext.indexedFilesCount} | Symbols: ${cortexContext.totalSymbolsCount} | Fingerprint: ${cortexContext.fingerprint}\n- No high-relevance symbol matches for active query.`;
    }

    const lines: string[] = [
      `### CODEBASE CORTEX (STRUCTURAL WORKING STATE)`,
      `- Working Tree: ${cortexContext.workingDirectory} (Fingerprint: ${cortexContext.fingerprint})`,
      `- Graph Metrics: ${cortexContext.indexedFilesCount} source files indexed (${cortexContext.totalSymbolsCount} symbols)`,
    ];

    if (cortexContext.fileWiringSummary.length > 0) {
      lines.push(`\n#### FILE WIRING CARDS:`);
      for (const w of cortexContext.fileWiringSummary) {
        lines.push(`- ${w}`);
      }
    }

    if (cortexContext.relevantExcerpts.length > 0) {
      lines.push(`\n#### CRUX CODE EXCERPTS & SYMBOLS:`);
      for (const ex of cortexContext.relevantExcerpts) {
        lines.push(`- **${ex.symbolName}** (\`${ex.kind}\` in \`${ex.filePath}\` | score: ${ex.relevanceScore}):`);
        if (ex.signature) {
          lines.push(`  \`\`\`ts\n  ${ex.signature}\n  \`\`\``);
        }
        if (ex.cruxCode && ex.cruxCode !== ex.signature) {
          const indented = ex.cruxCode.split('\n').map((l) => `    ${l}`).join('\n');
          lines.push(`  Crux Excerpt:\n${indented}`);
        }
      }
    }

    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // PARSER & AST EXTRACTION INTERNALS
  // --------------------------------------------------------------------------

  private parseFileContent(
    relPath: string,
    content: string,
    mtimeMs: number,
    sizeBytes: number
  ): CodebaseFileNode {
    const lines = content.split('\n');
    const symbols: CodebaseSymbol[] = [];
    const imports: string[] = [];
    const exportsList: string[] = [];

    // Regex patterns for key structural symbols
    const importRegex = /import\s+(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    const exportClassRegex = /export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g;
    const exportInterfaceRegex = /export\s+interface\s+(\w+)(?:\s+extends\s+([^{]+))?/g;
    const exportTypeRegex = /export\s+type\s+(\w+)\s*=/g;
    const exportFuncRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?::\s*([^{]+))?/g;
    const exportConstRegex = /export\s+const\s+(\w+)(?::\s*([^\s=]+))?\s*=/g;

    // Scan line by line for imports and symbols
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];

      // Imports
      let impMatch: RegExpExecArray | null;
      while ((impMatch = importRegex.exec(lineText)) !== null) {
        imports.push(impMatch[4]);
      }

      // Export Class
      let classMatch: RegExpExecArray | null;
      while ((classMatch = exportClassRegex.exec(lineText)) !== null) {
        const name = classMatch[1];
        exportsList.push(name);
        const crux = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
        symbols.push({
          name,
          kind: 'class',
          filePath: relPath,
          signature: classMatch[0].trim(),
          cruxCode: crux,
          dependencies: [classMatch[2], classMatch[3]].filter(Boolean) as string[],
          line: i + 1,
        });
      }

      // Export Interface
      let ifaceMatch: RegExpExecArray | null;
      while ((ifaceMatch = exportInterfaceRegex.exec(lineText)) !== null) {
        const name = ifaceMatch[1];
        exportsList.push(name);
        const crux = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
        symbols.push({
          name,
          kind: 'interface',
          filePath: relPath,
          signature: ifaceMatch[0].trim(),
          cruxCode: crux,
          dependencies: ifaceMatch[2] ? [ifaceMatch[2].trim()] : [],
          line: i + 1,
        });
      }

      // Export Type
      let typeMatch: RegExpExecArray | null;
      while ((typeMatch = exportTypeRegex.exec(lineText)) !== null) {
        const name = typeMatch[1];
        exportsList.push(name);
        const crux = lines.slice(i, Math.min(lines.length, i + 4)).join('\n');
        symbols.push({
          name,
          kind: 'type',
          filePath: relPath,
          signature: lineText.trim(),
          cruxCode: crux,
          dependencies: [],
          line: i + 1,
        });
      }

      // Export Function
      let funcMatch: RegExpExecArray | null;
      while ((funcMatch = exportFuncRegex.exec(lineText)) !== null) {
        const name = funcMatch[1];
        exportsList.push(name);
        const crux = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
        symbols.push({
          name,
          kind: 'function',
          filePath: relPath,
          signature: funcMatch[0].trim(),
          cruxCode: crux,
          dependencies: [],
          line: i + 1,
        });
      }

      // Export Const / Variable
      let constMatch: RegExpExecArray | null;
      while ((constMatch = exportConstRegex.exec(lineText)) !== null) {
        const name = constMatch[1];
        exportsList.push(name);
        symbols.push({
          name,
          kind: 'export',
          filePath: relPath,
          signature: lineText.trim(),
          cruxCode: lineText.trim(),
          dependencies: [],
          line: i + 1,
        });
      }
    }

    return {
      relativePath: relPath,
      mtimeMs,
      sizeBytes,
      symbols,
      imports: Array.from(new Set(imports)),
      exports: Array.from(new Set(exportsList)),
    };
  }

  private walkDirectory(currentDir: string, filePaths: string[]): void {
    if (!existsSync(currentDir) || filePaths.length >= this.maxFilesToScan) return;

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (filePaths.length >= this.maxFilesToScan) break;

        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!this.excludeDirs.has(entry.name)) {
            this.walkDirectory(fullPath, filePaths);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (this.includeExtensions.has(ext)) {
            filePaths.push(fullPath);
          }
        }
      }
    } catch {}
  }
}
