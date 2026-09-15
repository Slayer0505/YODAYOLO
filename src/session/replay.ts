import type { SessionManager, SessionRecord } from './manager';
import type { L0EventLedger } from '../db/ledger';
import type { L1ExperienceManager } from '../l1/experience';
import type { L2KnowledgeStore } from '../l2/store';
import type { L0Event } from '../types';

export interface ReplayTimelineEntry {
  step: number;
  timestamp: string;
  actor: 'human' | 'agent' | 'environment';
  eventType: string;
  source?: string;
  summary: string;
  rawEventId: string;
  payload: unknown;
}

export interface ReconstructedSessionReplay {
  sessionId: string;
  projectId: string;
  goal: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  modelsUsed: string[];
  toolsUsed: string[];
  timeline: ReplayTimelineEntry[];
  humanInterventionsCount: number;
  failuresCount: number;
  outcomeStatus: string;
  lessonsLearned: string[];
}

export class SessionReplayEngine {
  private sessionManager: SessionManager;
  private ledger: L0EventLedger;
  private expManager?: L1ExperienceManager;
  private l2Store?: L2KnowledgeStore;

  constructor(options: {
    sessionManager: SessionManager;
    ledger: L0EventLedger;
    expManager?: L1ExperienceManager;
    l2Store?: L2KnowledgeStore;
  }) {
    this.sessionManager = options.sessionManager;
    this.ledger = options.ledger;
    this.expManager = options.expManager;
    this.l2Store = options.l2Store;
  }

  public reconstructSession(sessionId: string): ReconstructedSessionReplay | null {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return null;

    const events = this.sessionManager.getSessionEvents(sessionId);
    const timeline: ReplayTimelineEntry[] = [];
    let humanInterventions = 0;
    let failures = 0;
    const lessons: string[] = [];

    events.forEach((evt, idx) => {
      let actorCategory: 'human' | 'agent' | 'environment' = 'environment';
      if (evt.metadata?.raw_actor) {
        actorCategory = evt.metadata.raw_actor as any;
      } else if (evt.actor === 'user') {
        actorCategory = 'human';
      } else if (evt.actor === 'provider') {
        actorCategory = 'agent';
      }

      if (actorCategory === 'human' && (evt.event_type === 'user_correction' || evt.event_type === 'human_override')) {
        humanInterventions++;
      }

      if (evt.event_type === 'tool_error' || evt.event_type === 'system_error' || evt.event_type === 'test_fail') {
        failures++;
      }

      let summary = `${evt.event_type}`;
      if (typeof evt.payload === 'object' && evt.payload !== null) {
        const p = evt.payload as Record<string, any>;
        if (p.prompt) summary = `Human prompt: "${p.prompt.slice(0, 60)}"`;
        else if (p.tool_name) summary = `Tool invoked: ${p.tool_name}`;
        else if (p.response) summary = `Model response generated`;
        else if (p.correction) summary = `Human correction: "${p.correction.slice(0, 60)}"`;
      }

      timeline.push({
        step: idx + 1,
        timestamp: evt.timestamp,
        actor: actorCategory,
        eventType: evt.event_type,
        source: evt.metadata?.source as string,
        summary,
        rawEventId: evt.event_id,
        payload: evt.payload,
      });
    });

    // Extract lessons learned
    if (this.l2Store) {
      const allRules = this.l2Store.getAllRules();
      for (const rule of allRules) {
        lessons.push(rule.content);
      }
    }

    return {
      sessionId: session.session_id,
      projectId: session.project_id,
      goal: session.active_task || 'General work session',
      status: session.status,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      modelsUsed: session.active_models,
      toolsUsed: session.active_tools,
      timeline,
      humanInterventionsCount: humanInterventions,
      failuresCount: failures,
      outcomeStatus: session.status === 'COMPLETED' ? 'SUCCESS' : 'IN_PROGRESS',
      lessonsLearned: lessons,
    };
  }
}
