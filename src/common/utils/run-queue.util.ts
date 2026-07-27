/**
 * Serializes async work with "run again when done if requested while busy".
 * Used by ModemManager discover loop so overlapping ticks queue instead of stacking.
 */
export class RunQueue {
  private running = false;
  private queued = false;
  private pendingTask: (() => Promise<void>) | null = null;

  async schedule(task: () => Promise<void>): Promise<void> {
    this.pendingTask = task;

    if (this.running) {
      this.queued = true;
      return;
    }

    this.running = true;
    try {
      do {
        this.queued = false;
        const toRun = this.pendingTask;
        this.pendingTask = null;
        if (toRun) {
          await toRun();
        }
      } while (this.queued);
    } finally {
      this.running = false;
    }
  }

  /** Test/diagnostics helper */
  get isRunning(): boolean {
    return this.running;
  }
}
