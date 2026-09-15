import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';

export interface FileSystemToolResult {
  success: boolean;
  action: 'read' | 'write' | 'list' | 'delete' | 'exists';
  path: string;
  data?: unknown;
  error?: string;
}

export class FileSystemAdapter {
  private baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = resolve(baseDir);
  }

  private resolvePath(targetPath: string): string {
    if (isAbsolute(targetPath)) return resolve(targetPath);
    return resolve(join(this.baseDir, targetPath));
  }

  public readFile(filePath: string): FileSystemToolResult {
    const fullPath = this.resolvePath(filePath);
    try {
      if (!existsSync(fullPath)) {
        return { success: false, action: 'read', path: fullPath, error: `File not found: ${filePath}` };
      }
      const content = readFileSync(fullPath, 'utf8');
      return { success: true, action: 'read', path: fullPath, data: content };
    } catch (err: any) {
      return { success: false, action: 'read', path: fullPath, error: err.message };
    }
  }

  public writeFile(filePath: string, content: string): FileSystemToolResult {
    const fullPath = this.resolvePath(filePath);
    try {
      writeFileSync(fullPath, content, 'utf8');
      return { success: true, action: 'write', path: fullPath, data: { bytesWritten: Buffer.byteLength(content) } };
    } catch (err: any) {
      return { success: false, action: 'write', path: fullPath, error: err.message };
    }
  }

  public listDirectory(dirPath: string = '.'): FileSystemToolResult {
    const fullPath = this.resolvePath(dirPath);
    try {
      if (!existsSync(fullPath)) {
        return { success: false, action: 'list', path: fullPath, error: `Directory not found: ${dirPath}` };
      }
      const entries = readdirSync(fullPath, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
      return { success: true, action: 'list', path: fullPath, data: items };
    } catch (err: any) {
      return { success: false, action: 'list', path: fullPath, error: err.message };
    }
  }

  public deleteFile(filePath: string): FileSystemToolResult {
    const fullPath = this.resolvePath(filePath);
    try {
      if (!existsSync(fullPath)) {
        return { success: false, action: 'delete', path: fullPath, error: `File not found: ${filePath}` };
      }
      unlinkSync(fullPath);
      return { success: true, action: 'delete', path: fullPath, data: { deleted: true } };
    } catch (err: any) {
      return { success: false, action: 'delete', path: fullPath, error: err.message };
    }
  }

  public pathExists(filePath: string): FileSystemToolResult {
    const fullPath = this.resolvePath(filePath);
    const exists = existsSync(fullPath);
    return { success: true, action: 'exists', path: fullPath, data: { exists } };
  }
}
