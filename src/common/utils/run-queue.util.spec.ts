import { RunQueue } from './run-queue.util';

describe('RunQueue', () => {
  it('queues a second call to run after the first finishes', async () => {
    const queue = new RunQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.schedule(async () => {
      order.push('start-1');
      await gate;
      order.push('end-1');
    });

    const second = queue.schedule(async () => {
      order.push('run-2');
    });

    expect(queue.isRunning).toBe(true);
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['start-1', 'end-1', 'run-2']);
    expect(queue.isRunning).toBe(false);
  });

  it('coalesces multiple queued requests into one follow-up run', async () => {
    const queue = new RunQueue();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = queue.schedule(async () => {
      runs += 1;
      await gate;
    });
    void queue.schedule(async () => {
      runs += 1;
    });
    void queue.schedule(async () => {
      runs += 1;
    });

    release();
    await first;
    // Allow the follow-up loop iteration to finish
    await new Promise((r) => setImmediate(r));

    expect(runs).toBe(2);
  });
});
