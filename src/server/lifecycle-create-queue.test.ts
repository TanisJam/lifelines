import { afterEach, describe, expect, it } from "vitest";
import {
  LIFECYCLE_CREATE_CONCURRENCY,
  LIFECYCLE_CREATE_QUEUE_LIMIT,
  LifecycleCreateAbortedError,
  LifecycleQueueFullError,
  lifecycleCreateQueueState,
  requestLifecycleCreateSlot,
  type LifecycleCreateTicket,
} from "./lifecycle-create-queue";

/**
 * The gate that keeps two 2.07 GiB creates from killing the container. It must serialize, bound the
 * waiting list, free the slot on abort or throw, and never leak a slot.
 */
const opened: LifecycleCreateTicket[] = [];
function open(): LifecycleCreateTicket {
  const ticket = requestLifecycleCreateSlot();
  opened.push(ticket);
  return ticket;
}
afterEach(() => {
  for (const ticket of opened.splice(0)) ticket.release();
  expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
});

describe("lifecycle create queue", () => {
  it("runs exactly one create at a time", async () => {
    expect(LIFECYCLE_CREATE_CONCURRENCY).toBe(1);
    const first = open();
    await first.ready(new AbortController().signal);
    const second = open();
    let secondStarted = false;
    const started = second.ready(new AbortController().signal).then(() => { secondStarted = true; });
    // Let every microtask settle: the second must still be waiting.
    await Promise.resolve();
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 1 });

    first.release();
    await started;
    expect(secondStarted).toBe(true);
    // The slot transferred rather than being freed and re-taken.
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 0 });
  });

  it("refuses with a full queue instead of growing without bound", () => {
    open();
    for (let index = 0; index < LIFECYCLE_CREATE_QUEUE_LIMIT; index++) open();
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: LIFECYCLE_CREATE_QUEUE_LIMIT });
    expect(() => open()).toThrow(LifecycleQueueFullError);
    // The refusal did not consume a slot.
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: LIFECYCLE_CREATE_QUEUE_LIMIT });
  });

  it("leaves the waiting list on abort without stealing the running slot", async () => {
    const first = open();
    await first.ready(new AbortController().signal);
    const controller = new AbortController();
    const queued = open();
    const waiting = queued.ready(controller.signal);
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 1 });

    controller.abort();
    await expect(waiting).rejects.toThrow(LifecycleCreateAbortedError);
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 0 });

    // A later release frees the real slot, and the aborted ticket cannot free it twice.
    queued.release();
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 0 });
    first.release();
    expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
  });

  it("rejects immediately when the request was already aborted", async () => {
    open();
    const controller = new AbortController();
    controller.abort();
    const queued = open();
    await expect(queued.ready(controller.signal)).rejects.toThrow(LifecycleCreateAbortedError);
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 0 });
  });

  it("frees the slot when the create throws, and release is idempotent", async () => {
    const first = open();
    await first.ready(new AbortController().signal);
    expect(lifecycleCreateQueueState()).toEqual({ active: 1, waiting: 0 });
    try {
      await (async () => { throw new Error("create failed"); })();
    } catch {
      first.release();
      first.release();
    }
    expect(lifecycleCreateQueueState()).toEqual({ active: 0, waiting: 0 });
  });
});
