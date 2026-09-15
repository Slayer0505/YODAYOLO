import { randomUUID } from 'crypto';
import type { L0Ledger } from '../db/ledger';
import type { ConsolidationReport, DreamSchedulerConfig, DreamSchedulerStatus } from '../types';
import type { DreamingConsolidator } from './dreaming';

export class DreamScheduler {
  private consolidator: DreamingConsolidator;
  private ledger?: L0Ledger;
  private intervalMs: number;
  private idleThresholdMs: number;
  private coldDays: number;
  private archiveDays: number;
  private settledThreshold: number;

  private timer: any = null;
  private isRunning: boolean = false;
  private isConsolidating: boolean = false;
  private lastActivityTimestamp: number = Date.now();
  private lastRunTimestamp: string | null = null;
  private totalRuns: number = 0;
  private settledEventCount: number = 0;
  private lastError: string | null = null;

  constructor(
    consolidator: DreamingConsolidator,
    ledger?: L0Ledger,
    config: DreamSchedulerConfig = {}
  ) {
    this.consolidator = consolidator;
    this.ledger = ledger;
    this.intervalMs = config.intervalMs || 60000; // 1 min check default
    this.idleThresholdMs = config.idleThresholdMs || 30000; // 30s idle threshold
    this.coldDays = config.coldOlderThanDays || 7;
    this.archiveDays = config.archiveOlderThanDays || 30;
    this.settledThreshold = config.settledThreshold || 5;

    this.initPersistence();

    if (config.autoStart) {
      this.start();
    }
  }

  private initPersistence(): void {
    if (!this.ledger) return;
    try {
      const db = this.ledger.getDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS dream_scheduler_state (
          id TEXT PRIMARY KEY DEFAULT 'singleton',
          total_runs INTEGER NOT NULL DEFAULT 0,
          last_run_timestamp TEXT,
          last_updated TEXT NOT NULL
        );
      `);

      const row = db.prepare(`SELECT * FROM dream_scheduler_state WHERE id = 'singleton'`).get() as any;
      if (row) {
        this.totalRuns = row.total_runs || 0;
        this.lastRunTimestamp = row.last_run_timestamp || null;
      }
    } catch {}
  }

  private persistState(): void {
    if (!this.ledger) return;
    try {
      const db = this.ledger.getDatabase();
      db.prepare(`
        INSERT INTO dream_scheduler_state (id, total_runs, last_run_timestamp, last_updated)
        VALUES ('singleton', $total_runs, $last_run_timestamp, $last_updated)
        ON CONFLICT(id) DO UPDATE SET
          total_runs = excluded.total_runs,
          last_run_timestamp = excluded.last_run_timestamp,
          last_updated = excluded.last_updated
      `).run({
        $total_runs: this.totalRuns,
        $last_run_timestamp: this.lastRunTimestamp,
        $last_updated: new Date().toISOString(),
      });
    } catch {}
  }

  public recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Event-driven wake trigger: called when an experience is settled in L1.
   * If threshold is reached and system is not consolidating, triggers consolidation.
   */
  public onExperienceSettled(): void {
    this.recordActivity();
    this.settledEventCount++;
    if (this.settledEventCount >= this.settledThreshold && !this.isConsolidating) {
      this.settledEventCount = 0;
      this.executeDreamCycle('settled_batch_threshold').catch((err) => {
        this.lastError = err.message;
      });
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.checkAndDream();
    }, this.intervalMs);
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async triggerNow(): Promise<ConsolidationReport> {
    return this.executeDreamCycle('manual_trigger');
  }

  public getStatus(): DreamSchedulerStatus {
    const isIdle = Date.now() - this.lastActivityTimestamp >= this.idleThresholdMs;
    return {
      active: this.isRunning,
      intervalMs: this.intervalMs,
      idleThresholdMs: this.idleThresholdMs,
      lastRunTimestamp: this.lastRunTimestamp,
      totalRuns: this.totalRuns,
      isIdle,
      lastError: this.lastError,
      settledEventCount: this.settledEventCount,
    };
  }

  private async checkAndDream(): Promise<void> {
    const idleDuration = Date.now() - this.lastActivityTimestamp;
    if (idleDuration >= this.idleThresholdMs && !this.isConsolidating) {
      try {
        await this.executeDreamCycle('idle_schedule');
      } catch (err: any) {
        this.lastError = err.message;
        console.warn(`[DreamScheduler] Background consolidation failed:`, err);
      }
    }
  }

  private async executeDreamCycle(triggerReason: string): Promise<ConsolidationReport> {
    if (this.isConsolidating) {
      throw new Error('Dream consolidation already in progress');
    }

    this.isConsolidating = true;
    try {
      const report = await this.consolidator.consolidate({
        coldOlderThanDays: this.coldDays,
        archiveOlderThanDays: this.archiveDays,
      });

      this.lastRunTimestamp = new Date().toISOString();
      this.totalRuns++;
      this.lastError = null;
      this.persistState();

      if (this.ledger) {
        this.ledger.appendEvent({
          correlation_id: `corr-dream-${randomUUID()}`,
          actor: 'system',
          event_type: 'evidence_ingested',
          payload: {
            trigger: triggerReason,
            report,
          },
          metadata: {
            scheduler_runs: this.totalRuns,
            duration_ms: report.duration_ms,
          },
        });
      }

      return report;
    } catch (err: any) {
      this.lastError = err.message;
      if (this.ledger) {
        this.ledger.appendEvent({
          correlation_id: `corr-dream-err-${randomUUID()}`,
          actor: 'system',
          event_type: 'system_error',
          payload: {
            trigger: triggerReason,
            error: err.message,
            stack: err.stack,
          },
        });
      }
      throw err;
    } finally {
      this.isConsolidating = false;
    }
  }
}
