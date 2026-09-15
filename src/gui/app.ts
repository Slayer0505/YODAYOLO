import { readFileSync } from 'fs';
import { join } from 'path';

export function renderYodaGuiHtml(): string {
  try {
    const htmlPath = join(import.meta.dir, 'index.html');
    return readFileSync(htmlPath, 'utf-8');
  } catch (err) {
    return `<!DOCTYPE html><html><body><h1>YODA GUI</h1><p>Failed to load UI template: ${String(err)}</p></body></html>`;
  }
}
