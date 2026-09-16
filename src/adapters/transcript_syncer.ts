import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Database } from 'bun:sqlite';

interface SyncState {
  processedFiles: Record<string, number>; // path -> last processed line number
  lastOpenCodeMessageTime: number;        // timestamp watermark for OpenCode messages
}

const STATE_FILE = join(homedir(), '.gemini', 'antigravity-cli', '.yoda_sync_state.json');
const YODA_API_URL = process.env.YODA_API_URL || 'http://127.0.0.1:8080/api/adapters/capture';

function loadState(): SyncState {
  if (existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      return {
        processedFiles: parsed.processedFiles || {},
        lastOpenCodeMessageTime: parsed.lastOpenCodeMessageTime || 0,
      };
    } catch {
      return { processedFiles: {}, lastOpenCodeMessageTime: 0 };
    }
  }
  return { processedFiles: {}, lastOpenCodeMessageTime: 0 };
}

function saveState(state: SyncState) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[YODA Syncer] Failed to save state:', err);
  }
}

/**
 * Ingests Antigravity session transcript logs
 */
export async function syncAntigravityTranscripts(options: { verbose?: boolean } = {}) {
  const state = loadState();
  const brainDir = join(homedir(), '.gemini', 'antigravity-cli', 'brain');

  if (!existsSync(brainDir)) {
    if (options.verbose) console.log('[YODA Syncer] No Antigravity brain directory found.');
    return { syncedSteps: 0, sessionsScanned: 0 };
  }

  let totalSynced = 0;
  const sessions = readdirSync(brainDir);

  for (const sessionId of sessions) {
    const transcriptPath = join(brainDir, sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!existsSync(transcriptPath)) continue;

    const lastLine = state.processedFiles[transcriptPath] || 0;
    const content = readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    if (lines.length <= lastLine) continue;

    if (options.verbose) {
      console.log(`[YODA Syncer:Antigravity] Ingesting session ${sessionId.slice(0, 8)}... (${lines.length - lastLine} new steps)`);
    }

    let currentCorrelationId = `corr-agy-${sessionId.slice(0, 8)}`;

    for (let i = lastLine; i < lines.length; i++) {
      try {
        const step = JSON.parse(lines[i]);
        currentCorrelationId = `corr-agy-${sessionId.slice(0, 8)}-step-${step.step_index || i}`;

        if (step.type === 'USER_INPUT') {
          const cleanPrompt = (step.content || '')
            .replace(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/, '$1')
            .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/, '')
            .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/, '')
            .trim();

          await fetch(YODA_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'prompt',
              client_type: 'antigravity',
              correlation_id: currentCorrelationId,
              session_id: sessionId,
              project_id: 'Documents',
              prompt: cleanPrompt || step.content,
              metadata: { created_at: step.created_at, step_index: step.step_index },
            }),
          });
          totalSynced++;
        } else if (step.type === 'PLANNER_RESPONSE') {
          if (step.content) {
            await fetch(YODA_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'response',
                client_type: 'antigravity',
                correlation_id: currentCorrelationId,
                response: step.content,
                metadata: { created_at: step.created_at, thinking: step.thinking },
              }),
            });
            totalSynced++;
          }

          if (step.tool_calls && Array.isArray(step.tool_calls)) {
            for (const tool of step.tool_calls) {
              await fetch(YODA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'tool_call',
                  client_type: 'antigravity',
                  correlation_id: currentCorrelationId,
                  tool_name: tool.name,
                  args: tool.args,
                }),
              });
              totalSynced++;
            }
          }
        } else if (step.type === 'GENERIC' && step.content) {
          await fetch(YODA_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'tool_result',
              client_type: 'antigravity',
              correlation_id: currentCorrelationId,
              tool_name: 'tool_execution',
              result: step.content.slice(0, 1500),
              success: !step.content.includes('error') && !step.content.includes('failed'),
            }),
          });
          totalSynced++;
        }
      } catch (err) {
        // Skip malformed line
      }
    }

    state.processedFiles[transcriptPath] = lines.length;
  }

  saveState(state);
  return { syncedSteps: totalSynced, sessionsScanned: sessions.length };
}

/**
 * Ingests OpenCode database sessions & messages
 */
export async function syncOpenCodeSessions(options: { verbose?: boolean } = {}) {
  const state = loadState();
  const dbPath = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

  if (!existsSync(dbPath)) {
    if (options.verbose) console.log('[YODA Syncer:OpenCode] No OpenCode SQLite DB found.');
    return { syncedMessages: 0 };
  }

  let db: Database | null = null;
  let totalSynced = 0;

  try {
    db = new Database(dbPath, { readonly: true });
    const lastTime = state.lastOpenCodeMessageTime || 0;

    const messages = db.query(`
      SELECT m.id, m.session_id, m.time_created, m.data, s.directory
      FROM message m
      LEFT JOIN session s ON m.session_id = s.id
      WHERE m.time_created > $lastTime
      ORDER BY m.time_created ASC
      LIMIT 1000
    `).all({ $lastTime: lastTime }) as any[];

    if (messages.length === 0) {
      return { syncedMessages: 0 };
    }

    if (options.verbose) {
      console.log(`[YODA Syncer:OpenCode] Ingesting ${messages.length} new OpenCode messages since ${new Date(lastTime).toISOString()}...`);
    }

    let maxTime = lastTime;

    for (const msg of messages) {
      try {
        const msgData = JSON.parse(msg.data || '{}');
        const role = msgData.role || 'user';
        const correlationId = `corr-opencode-${msg.session_id.slice(0, 8)}-${msg.id.slice(0, 8)}`;
        const projectId = msg.directory ? msg.directory.split('/').pop() : 'opencode';

        // Retrieve message parts
        const parts = db.query(`
          SELECT id, data FROM part WHERE message_id = $msgId ORDER BY time_created ASC
        `).all({ $msgId: msg.id }) as any[];

        let messageText = '';
        const toolCalls: any[] = [];
        const toolResults: any[] = [];

        for (const p of parts) {
          try {
            const pData = JSON.parse(p.data || '{}');
            if (pData.type === 'text' && pData.text) {
              messageText += (messageText ? '\n' : '') + pData.text;
            } else if (pData.type === 'tool') {
              toolCalls.push({
                tool: pData.tool,
                args: pData.state?.input || {},
                callID: pData.callID,
              });
              if (pData.state?.output) {
                toolResults.push({
                  tool: pData.tool,
                  result: typeof pData.state.output === 'string' ? pData.state.output.slice(0, 1500) : JSON.stringify(pData.state.output).slice(0, 1500),
                  success: pData.state.status === 'completed',
                });
              }
            }
          } catch {}
        }

        if (role === 'user') {
          await fetch(YODA_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'prompt',
              client_type: 'opencode',
              correlation_id: correlationId,
              session_id: msg.session_id,
              project_id: projectId,
              prompt: messageText || JSON.stringify(msgData),
              metadata: { time_created: msg.time_created, opencode_msg_id: msg.id },
            }),
          });
          totalSynced++;
        } else if (role === 'assistant') {
          if (messageText) {
            await fetch(YODA_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'response',
                client_type: 'opencode',
                correlation_id: correlationId,
                response: messageText,
                metadata: { time_created: msg.time_created },
              }),
            });
            totalSynced++;
          }

          for (const tc of toolCalls) {
            await fetch(YODA_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'tool_call',
                client_type: 'opencode',
                correlation_id: correlationId,
                tool_name: tc.tool,
                args: tc.args,
              }),
            });
            totalSynced++;
          }

          for (const tr of toolResults) {
            await fetch(YODA_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'tool_result',
                client_type: 'opencode',
                correlation_id: correlationId,
                tool_name: tr.tool,
                result: tr.result,
                success: tr.success,
              }),
            });
            totalSynced++;
          }
        }

        if (msg.time_created > maxTime) {
          maxTime = msg.time_created;
        }
      } catch (err) {}
    }

    state.lastOpenCodeMessageTime = maxTime;
    saveState(state);
  } finally {
    if (db) db.close();
  }

  return { syncedMessages: totalSynced };
}

/**
 * Unified sync across both Antigravity and OpenCode
 */
export async function syncAllClientTranscripts(options: { verbose?: boolean } = {}) {
  const agyRes = await syncAntigravityTranscripts(options);
  const openRes = await syncOpenCodeSessions(options);
  return {
    antigravity: agyRes,
    opencode: openRes,
  };
}

if (import.meta.main) {
  console.log('[YODA Syncer] Starting unified cross-agent transcript sync (Antigravity + OpenCode)...');
  syncAllClientTranscripts({ verbose: true }).then((res) => {
    console.log('[YODA Syncer] Sync finished:', JSON.stringify(res, null, 2));
  });
}
