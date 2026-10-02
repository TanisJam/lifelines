import { describe, expect, it } from "vitest";
import { fixtureChronicle } from "@/lib/fixtures";
import type { LifeStreamEvent } from "@/contracts/life";
import type { RewriteAction } from "./rewrite";
import { runRewrite, type RewriteRun } from "./rewrite-run";

const chronicle = fixtureChronicle("life-elin");
const messages = { incomplete: "INCOMPLETE", failed: (err: unknown) => `FAILED:${err instanceof Error ? err.message : "?"}` };

function setup(events: readonly LifeStreamEvent[] | Error, over: Partial<RewriteRun> = {}) {
  const dispatched: RewriteAction[] = [];
  const done: string[] = [];
  const controller = new AbortController();
  const run: RewriteRun = {
    signal: controller.signal,
    sleep: async () => {},
    dispatch: (a) => dispatched.push(a),
    from: chronicle,
    stream: async (onEvent) => {
      if (events instanceof Error) throw events;
      for (const e of events) onEvent(e);
    },
    onDone: (c) => done.push(c.branchId),
    messages,
    ...over,
  };
  return { run, dispatched, done, controller };
}

const doneEvent = { type: "done", chronicle, ghosts: { a: "g" } } as unknown as LifeStreamEvent;
const errorEvent = { type: "error", message: "Verification failed" } as unknown as LifeStreamEvent;
const types = (d: readonly RewriteAction[]) => d.map((a) => a.type);

describe("runRewrite", () => {
  it("runs the phases in order and finishes on done", async () => {
    const { run, dispatched, done } = setup([doneEvent]);
    await runRewrite(run);
    expect(types(dispatched)).toEqual(["hold", "stream", "done"]);
    expect(done).toEqual([chronicle.branchId]);
  });

  it("surfaces the server's own message from an error event", async () => {
    const { run, dispatched } = setup([errorEvent]);
    await runRewrite(run);
    expect(dispatched.at(-1)).toEqual({ type: "fail", message: "Verification failed" });
  });

  it("an error event wins over a later done", async () => {
    const { run, dispatched, done } = setup([errorEvent, doneEvent]);
    await runRewrite(run);
    expect(types(dispatched)).not.toContain("done");
    expect(done).toEqual([]);
    expect(dispatched.at(-1)).toEqual({ type: "fail", message: "Verification failed" });
  });

  it("a stream that ends without done is rewriteIncomplete", async () => {
    const { run, dispatched } = setup([]);
    await runRewrite(run);
    expect(dispatched.at(-1)).toEqual({ type: "fail", message: "INCOMPLETE" });
  });

  it("a thrown stream error goes through the failed message", async () => {
    const { run, dispatched } = setup(new Error("boom"));
    await runRewrite(run);
    expect(dispatched.at(-1)).toEqual({ type: "fail", message: "FAILED:boom" });
  });

  it("an error event followed by a throw still reports the server's message", async () => {
    const { run, dispatched } = setup([], {
      stream: async (onEvent) => {
        onEvent(errorEvent);
        throw new Error("socket closed");
      },
    });
    await runRewrite(run);
    expect(dispatched.at(-1)).toEqual({ type: "fail", message: "Verification failed" });
  });

  it("aborted during the first hold dispatches nothing more", async () => {
    const { run, dispatched, controller } = setup([doneEvent], { sleep: async () => controller.abort() });
    await runRewrite(run);
    expect(dispatched).toEqual([]);
  });

  it("aborted during the second hold dispatches only hold", async () => {
    let n = 0;
    const { run, dispatched, controller } = setup([doneEvent], { sleep: async () => void (++n === 2 && controller.abort()) });
    await runRewrite(run);
    expect(types(dispatched)).toEqual(["hold"]);
  });

  it("aborted mid-stream reports no failure", async () => {
    const { run, dispatched, controller } = setup([], {
      stream: async () => {
        controller.abort();
        throw new Error("aborted");
      },
    });
    await runRewrite(run);
    expect(types(dispatched)).toEqual(["hold", "stream"]);
  });
});
