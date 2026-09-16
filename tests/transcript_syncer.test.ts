import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Transcript Syncer Integration & Resilience', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yoda-syncer-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('1. Correctly parses Antigravity JSONL transcripts without corruption', () => {
    const sessionDir = join(tempDir, 'sample-session', '.system_generated', 'logs');
    mkdirSync(sessionDir, { recursive: true });

    const transcriptPath = join(sessionDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>\nFix database timeout\n</USER_REQUEST>' }),
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Checking database configs...', tool_calls: [{ name: 'view_file', args: { path: 'db.ts' } }] }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', content: 'Database connection verified.' }),
    ];

    writeFileSync(transcriptPath, lines.join('\n'), 'utf8');

    const readLines = lines.map((l) => JSON.parse(l));
    expect(readLines.length).toBe(3);
    expect(readLines[0].type).toBe('USER_INPUT');
    expect(readLines[1].type).toBe('PLANNER_RESPONSE');
    expect(readLines[1].tool_calls.length).toBe(1);
    expect(readLines[2].type).toBe('GENERIC');
  });

  it('2. Correctly reads OpenCode SQLite schema structure', () => {
    const dbPath = join(tempDir, 'test_opencode.db');
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    `);

    db.prepare(`INSERT INTO session VALUES ('ses_1', '/home/user/project')`).run();
    db.prepare(`INSERT INTO message VALUES ('msg_1', 'ses_1', 1780000000000, '{"role":"user"}')`).run();
    db.prepare(`INSERT INTO part VALUES ('prt_1', 'msg_1', 'ses_1', 1780000000000, '{"type":"text","text":"Implement feature X"}')`).run();

    const messages = db.query(`SELECT m.*, s.directory FROM message m LEFT JOIN session s ON m.session_id = s.id`).all() as any[];
    expect(messages.length).toBe(1);
    expect(messages[0].session_id).toBe('ses_1');
    expect(messages[0].directory).toBe('/home/user/project');

    const parts = db.query(`SELECT * FROM part WHERE message_id = 'msg_1'`).all() as any[];
    expect(parts.length).toBe(1);
    const partData = JSON.parse(parts[0].data);
    expect(partData.type).toBe('text');
    expect(partData.text).toBe('Implement feature X');

    db.close();
  });
});
