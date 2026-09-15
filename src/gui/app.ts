import { readFileSync } from 'fs';
import { join } from 'path';

let cachedHtml: string | null = null;

export function renderYodaGuiHtml(): string {
  if (!cachedHtml) {
    try {
      const htmlPath = join(import.meta.dir, 'index.html');
      cachedHtml = readFileSync(htmlPath, 'utf-8');
    } catch (err) {
      cachedHtml = `<!DOCTYPE html><html><body><h1>YODA GUI</h1><p>Failed to load UI template: ${String(err)}</p></body></html>`;
    }
  }
  return cachedHtml;
}
