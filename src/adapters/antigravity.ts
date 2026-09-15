import { UniversalYodaAdapter, type UniversalAdapterOptions } from './universal';

export class AntigravityAdapter extends UniversalYodaAdapter {
  constructor(options: Omit<UniversalAdapterOptions, 'clientType' | 'name'>) {
    super({
      ...options,
      name: 'antigravity-adapter',
      clientType: 'antigravity',
      description: 'Antigravity IDE & CLI Pair-Programming Cognitive Adapter',
    });
  }

  /**
   * Settles automated test results emitted by Antigravity commands
   */
  public async captureTestResult(
    correlationId: string,
    passed: boolean,
    testSummary: string,
    files: string[] = []
  ) {
    const active = this.activeCorrelations.get(correlationId);
    const projectId = active?.projectId || 'Documents';

    return this.evidenceBus.emit({
      source: 'test',
      type: passed ? 'test_pass' : 'test_fail',
      correlationId,
      projectId,
      files,
      payload: {
        testSummary,
        passed,
        rule_candidate: {
          category: 'learned_rule',
          taskContext: projectId,
          content: `Verified test status: ${testSummary}`,
          tags: ['test', 'antigravity', passed ? 'pass' : 'fail'],
        },
      },
    });
  }
}
