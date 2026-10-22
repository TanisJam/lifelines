/**
 * The single-process gate around lifecycle creation.
 *
 * A full lifecycle create - the protagonist's whole life, 57 years at seed `cap-0` - needs ~1.51 GiB of
 * RSS and ~507 s (measured; see `odd/tasks/lifecycle-full-lifetime.md` L6). The deployed container is
 * bounded at `mem_limit: 2560m`,
 * so a SECOND concurrent create exceeds the cgroup and the kernel kills the whole process - taking every
 * in-flight read down with it. This gate is therefore a memory guardrail, not a scheduler: at most ONE
 * create runs, and at most `LIFECYCLE_CREATE_QUEUE_LIMIT` more wait behind it. Anything beyond that is
 * refused with 429 rather than queued.
 *
 * IN-PROCESS ONLY. The deploy is a single container, so one Node process owns every create. A second
 * replica would need a shared gate (a DB lease), and this module would silently stop being a bound.
 *
 * A queued request holds no slot and no memory: it waits on a promise and can be aborted by its client
 * at any time without leaking the slot.
 */

/** Two concurrent creates exceed `mem_limit: 2560m`. One is the bound, not a tuning knob. */
export const LIFECYCLE_CREATE_CONCURRENCY = 1;
/** Bounded waiting list: a 4-minute create behind one running plus four queued is already ~20 minutes. */
export const LIFECYCLE_CREATE_QUEUE_LIMIT = 4;

export class LifecycleQueueFullError extends Error {
  constructor() {
    super("Another life is being created right now and the waiting list is full. Try again in a few minutes.");
    this.name = "LifecycleQueueFullError";
  }
}
export class LifecycleCreateAbortedError extends Error {
  constructor() {
    super("The create request was aborted before it could start.");
    this.name = "LifecycleCreateAbortedError";
  }
}

type State = "waiting" | "granted" | "cancelled";
interface Slot { state: State; grant: () => void; }

let active = 0;
const waiting: Slot[] = [];

export interface LifecycleCreateTicket {
  /** Resolves once this request owns the create slot. Rejects only while still waiting, on abort. */
  ready(signal: AbortSignal): Promise<void>;
  /** Frees the slot, or leaves the waiting list if it was never granted. Idempotent, abort-safe. */
  release(): void;
}

/** Diagnostics and tests only: the live shape of the gate. */
export function lifecycleCreateQueueState(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next !== undefined) {
    // Ownership transfers to the next waiter: `active` stays at the limit.
    next.state = "granted";
    next.grant();
    return;
  }
  active = Math.max(0, active - 1);
}

function detach(slot: Slot): void {
  const index = waiting.indexOf(slot);
  if (index !== -1) waiting.splice(index, 1);
}

/**
 * Claims a create slot, or a place in the bounded queue. Throws `LifecycleQueueFullError` when the
 * queue is full - the caller must answer 429 BEFORE starting a stream it cannot serve.
 */
export function requestLifecycleCreateSlot(): LifecycleCreateTicket {
  let grant = (): void => {};
  const granted = new Promise<void>((resolve) => { grant = resolve; });
  const slot: Slot = { state: "waiting", grant };

  if (active < LIFECYCLE_CREATE_CONCURRENCY) {
    active++;
    slot.state = "granted";
    grant();
  } else {
    if (waiting.length >= LIFECYCLE_CREATE_QUEUE_LIMIT) throw new LifecycleQueueFullError();
    waiting.push(slot);
  }

  let released = false;
  return {
    ready(signal: AbortSignal): Promise<void> {
      if (slot.state === "cancelled") return Promise.reject(new LifecycleCreateAbortedError());
      if (slot.state === "granted") return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const onAbort = (): void => {
          // A disconnect after the grant is the runner's problem (it aborts its own work); it must
          // not steal the slot back out from under a create that is already running.
          if (slot.state !== "waiting") return;
          slot.state = "cancelled";
          detach(slot);
          reject(new LifecycleCreateAbortedError());
        };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
        void granted.then(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      });
    },
    release(): void {
      if (released) return;
      released = true;
      if (slot.state === "granted") { releaseSlot(); return; }
      if (slot.state === "waiting") { slot.state = "cancelled"; detach(slot); }
    },
  };
}
