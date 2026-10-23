import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAnnual, type AnnualExecutionOutput } from "./annual-execution";
import { createAnnualRuntime, type AnnualPlan } from "../domain/e-runtime";
import { initializeWorld } from "../domain/world-initialization";
import { sseResponse, yieldToEventLoop } from "./sse";

vi.mock("./sse", async importOriginal => {
  const original = await importOriginal<typeof import("./sse")>();
  return { ...original, yieldToEventLoop: vi.fn(original.yieldToEventLoop) };
});

const initialization = { seed: "verify-1", startYear: 1327, endYear: 1335, founderCount: 6 };
function fixture() {
  const { world } = initializeWorld(initialization);
  const [creditor, debtor] = Object.values(world.people)
    .filter(p => p.birthYear < 1327 && p.deathYear === undefined && !p.away).map(p => p.id);
  const resources = Object.fromEntries(Object.keys(world.people).map(id => [id, { grain: 2, effort: 1, need: 1 }]));
  return { creditor, debtor, resources };
}
function quiet(year: number): AnnualPlan {
  return { year, physical: [], resources: [], grants: [], requests: [] };
}
function favorPlans(): AnnualPlan[] {
  const { creditor, debtor } = fixture();
  return [
    { ...quiet(1327), grants: [{ id: "grant", creditor, debtor, causes: [] }] },
    { ...quiet(1328), requests: [{ id: "request", obligation: "grant/help", noise: 0 }] },
    quiet(1335),
  ];
}
function assertFrozen(value: unknown): void {
  if (value !== null && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(assertFrozen);
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(yieldToEventLoop).mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network prohibited"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("annual execution admission and parity", () => {
  it("returns the admitted initial output for an explicit empty array", async () => {
    const { resources } = fixture();
    const onYear = vi.fn();
    const output = await executeAnnual(initialization, resources, [], { onYear });
    expect(output).toEqual(createAnnualRuntime(initialization, resources).final());
    assertFrozen(output);
    expect(onYear).not.toHaveBeenCalled();
    expect(yieldToEventLoop).not.toHaveBeenCalled();
  });

  it("matches direct E2a advances, quiet gaps, origin, resources and complete history", async () => {
    const { resources, debtor, creditor } = fixture();
    const plans = favorPlans();
    const untouched = structuredClone(plans);
    const runtime = createAnnualRuntime(initialization, resources);
    const expected = plans.map(plan => runtime.advance(plan));
    const received: AnnualExecutionOutput[] = [];
    const output = await executeAnnual(initialization, resources, plans, { onYear: year => { received.push(year); } });
    expect(received).toEqual(expected);
    expect(output).toEqual(runtime.final());
    expect(plans).toEqual(untouched);
    expect(output.journal.map(year => year.plan.year)).toEqual([1327, 1328, 1335]);
    expect(output.state.grain[creditor]).toBe(1);
    expect(output.state.grain[debtor]).toBe(3);
    expect(output.state.assistance[debtor]).toBe(0);
    expect(output.state.need[creditor]).toBe(0);
    expect(output.state).toEqual(received[1].state); // no quiet-year refill or biological changes
    expect(yieldToEventLoop).toHaveBeenCalledTimes(3);
  });

  it("returns detached deeply frozen full year and final outputs", async () => {
    const { resources, creditor } = fixture();
    const received: AnnualExecutionOutput[] = [];
    const output = await executeAnnual(initialization, resources, favorPlans(), {
      onYear: year => {
        assertFrozen(year);
        expect(() => Reflect.set(year.state.grain, creditor, 99)).not.toThrow();
        expect(Reflect.set(year.state.grain, creditor, 99)).toBe(false);
        received.push(year);
      },
    });
    assertFrozen(output);
    expect(output).not.toBe(received[2]);
    expect(output.state).not.toBe(received[2].state);
    expect(received[0].state.obligations[0].status).toBe("open");
    expect(received[1].state.obligations[0].status).toBe("fulfilled");
    resources[creditor].grain = 100;
    expect(output.genesis.resources[creditor].grain).toBe(2);
  });

  it.each([undefined, null, {}, new Set(), { [Symbol.iterator]: function* () { yield quiet(1327); } }])(
    "rejects a non-array consumer container: %s", async plans => {
      await expect(executeAnnual(initialization, fixture().resources, plans as unknown as AnnualPlan[]))
        .rejects.toThrow("Annual plans must be an array");
    },
  );

  it("does not default missing initialization or resources", async () => {
    await expect(executeAnnual(undefined, fixture().resources, [])).rejects.toThrow();
    await expect(executeAnnual(initialization, undefined, [])).rejects.toThrow();
    await expect(executeAnnual(initialization, {}, [])).rejects.toThrow();
  });

  it("leaves descriptor-first domain admission ahead of authority invocation", async () => {
    const sentinel = new Error("Getter must not execute");
    const getter = vi.fn(() => { throw sentinel; });
    const invalid = Object.defineProperty({}, "seed", { enumerable: true, get: getter });
    const authority = vi.fn(() => ({ source: "human", selected: "help" }));
    await expect(executeAnnual(invalid, fixture().resources, favorPlans(), { authority })).rejects.toThrow();
    await expect(executeAnnual(initialization, {}, favorPlans(), { authority })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(authority).not.toHaveBeenCalled();
  });

  it("preserves the domain's original initialization and declaration error messages", async () => {
    const { resources } = fixture();
    let initializationError: unknown;
    try { createAnnualRuntime(undefined, resources); } catch (error) { initializationError = error; }
    await expect(executeAnnual(undefined, resources, [])).rejects.toThrow((initializationError as Error).message);
    let declarationError: unknown;
    try { createAnnualRuntime(initialization, resources).advance(quiet(1326)); } catch (error) { declarationError = error; }
    await expect(executeAnnual(initialization, resources, [quiet(1326)])).rejects.toThrow((declarationError as Error).message);
  });

  it.each([[1327, 1327], [1328, 1327], [1326], [1336]])(
    "delegates monotonic range admission without emitting a failed year: %s", async (...years: number[]) => {
      const onYear = vi.fn();
      const plans = years.map(quiet);
      await expect(executeAnnual(initialization, fixture().resources, plans, { onYear })).rejects.toThrow("Invalid year frontier");
      expect(onYear).toHaveBeenCalledTimes(years.length === 2 ? 1 : 0);
    },
  );

  it("rejects a malformed year through domain admission without callback or authority", async () => {
    const onYear = vi.fn();
    const authority = vi.fn();
    const getter = vi.fn(() => 1327);
    const plan = Object.defineProperty(quiet(1327), "year", { enumerable: true, get: getter });
    await expect(executeAnnual(initialization, fixture().resources, [plan], { onYear, authority })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(onYear).not.toHaveBeenCalled();
    expect(authority).not.toHaveBeenCalled();
  });

  it("does not pre-read future years before an awaited callback", async () => {
    const later = quiet(1328);
    const getter = vi.fn(() => { throw new Error("Future read"); });
    Object.defineProperty(later, "year", { enumerable: true, get: getter });
    const stop = new Error("Stop in callback");
    await expect(executeAnnual(initialization, fixture().resources, [quiet(1327), later], {
      onYear: () => { throw stop; },
    })).rejects.toBe(stop);
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("ordered callbacks and error propagation", () => {
  it("awaits each callback before yield and the next advance", async () => {
    const gate = deferred();
    const entered = deferred();
    const order: string[] = [];
    vi.mocked(yieldToEventLoop).mockImplementation(async () => { order.push("yield"); });
    const work = executeAnnual(initialization, fixture().resources, [quiet(1327), quiet(1328)], {
      onYear: async output => {
        order.push(`start:${output.frontier}`);
        if (output.frontier === 1327) { entered.resolve(); await gate.promise; }
        order.push(`end:${output.frontier}`);
      },
    });
    await entered.promise;
    expect(order).toEqual(["start:1327"]);
    gate.resolve();
    await work;
    expect(order).toEqual(["start:1327", "end:1327", "yield", "start:1328", "end:1328", "yield"]);
  });

  it("borrows synchronous human authority unchanged after origin admission", async () => {
    const authority = vi.fn(() => ({ source: "human", selected: "refuse" }));
    const { resources } = fixture();
    const runtime = createAnnualRuntime(initialization, resources, authority);
    favorPlans().forEach(plan => runtime.advance(plan));
    const output = await executeAnnual(initialization, resources, favorPlans(), { authority });
    expect(output).toEqual(runtime.final());
    expect(output.state.obligations[0].status).toBe("broken");
    expect(authority).toHaveBeenCalledTimes(2);
  });

  it("propagates the exact authority error with no failed-year callback or retry", async () => {
    const sentinel = { failure: "authority" };
    const authority = vi.fn(() => { throw sentinel; });
    const onYear = vi.fn();
    await expect(executeAnnual(initialization, fixture().resources, favorPlans(), { authority, onYear })).rejects.toBe(sentinel);
    expect(authority).toHaveBeenCalledTimes(1);
    expect(onYear).toHaveBeenCalledTimes(1);
    expect(onYear.mock.calls[0][0].frontier).toBe(1327);
  });

  it.each([false, true])("propagates exact callback errors (async: %s) and stops", async asynchronous => {
    const sentinel = { failure: "callback" };
    const onYear = vi.fn(() => {
      if (asynchronous) return Promise.reject(sentinel);
      throw sentinel;
    });
    await expect(executeAnnual(initialization, fixture().resources, favorPlans(), { onYear })).rejects.toBe(sentinel);
    expect(onYear).toHaveBeenCalledTimes(1);
    expect(yieldToEventLoop).not.toHaveBeenCalled();
  });
});

describe("cooperative cancellation boundaries", () => {
  it("rejects pre-abort before initialization, even with a custom reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Custom reason"));
    const onYear = vi.fn();
    await expect(executeAnnual(undefined, undefined, [], { signal: controller.signal, onYear }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(onYear).not.toHaveBeenCalled();
  });

  it("checks abort after synchronous advance before invoking callback", async () => {
    const controller = new AbortController();
    const authority = vi.fn(() => {
      controller.abort();
      return { source: "human", selected: "help" };
    });
    const onYear = vi.fn();
    await expect(executeAnnual(initialization, fixture().resources, favorPlans(), {
      signal: controller.signal, authority, onYear,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(authority).toHaveBeenCalledTimes(1);
    expect(onYear).toHaveBeenCalledTimes(1); // grant callback only, help already committed in memory
  });

  it.each([1, 2])("rejects abort inside callback including the final one (plans: %s)", async count => {
    const controller = new AbortController();
    const received: AnnualExecutionOutput[] = [];
    await expect(executeAnnual(initialization, fixture().resources, [quiet(1327), quiet(1328)].slice(0, count), {
      signal: controller.signal,
      onYear: async output => {
        received.push(output);
        await Promise.resolve();
        if (received.length === count) controller.abort();
      },
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(received).toHaveLength(count);
    expect(received.at(-1)!.frontier).toBe(1326 + count);
    expect(yieldToEventLoop).toHaveBeenCalledTimes(count - 1);
  });

  it("awaits an in-flight callback even when cancellation occurs while it is pending", async () => {
    const controller = new AbortController();
    const entered = deferred();
    const gate = deferred();
    let finished = false;
    let settled = false;
    const onYear = vi.fn(async () => {
      entered.resolve();
      await gate.promise;
      finished = true;
    });
    const work = executeAnnual(initialization, fixture().resources, [quiet(1327), quiet(1328)], {
      signal: controller.signal, onYear,
    });
    const rejection = expect(work).rejects.toMatchObject({ name: "AbortError" });
    void work.then(() => { settled = true; }, () => { settled = true; });
    await entered.promise;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    await rejection;
    expect(finished).toBe(true);
    expect(onYear).toHaveBeenCalledTimes(1);
    expect(yieldToEventLoop).not.toHaveBeenCalled();
  });

  it.each([1, 2])("rejects scheduled abort at the yield including after the final year (plans: %s)", async count => {
    const controller = new AbortController();
    const onYear = vi.fn();
    vi.mocked(yieldToEventLoop).mockImplementation(async () => { controller.abort(); });
    await expect(executeAnnual(initialization, fixture().resources, [quiet(1327), quiet(1328)].slice(0, count), {
      signal: controller.signal, onYear,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(onYear).toHaveBeenCalledTimes(1);
    expect(yieldToEventLoop).toHaveBeenCalledTimes(1);
  });

  it("real event-loop yield lets an SSE reader cancel before later plans", async () => {
    const original = await vi.importActual<typeof import("./sse")>("./sse");
    vi.mocked(yieldToEventLoop).mockImplementation(original.yieldToEventLoop);
    const settled = deferred();
    const received: number[] = [];
    let failure: unknown;
    let completed = false;
    const response = sseResponse(async (send, signal) => {
      try {
        await executeAnnual(initialization, fixture().resources, [quiet(1327), quiet(1328), quiet(1329)], {
          signal,
          onYear: output => { received.push(output.frontier!); send("year", { year: output.frontier }); },
        });
        completed = true;
      } catch (error) {
        failure = error;
        throw error; // SSE owns transport handling; consumer rejects unchanged
      } finally { settled.resolve(); }
    });
    const reader = response.body!.getReader();
    const frame = await reader.read();
    expect(new TextDecoder().decode(frame.value)).toContain('data: {"year":1327}');
    await reader.cancel();
    await settled.promise;
    expect(failure).toMatchObject({ name: "AbortError" });
    expect(completed).toBe(false);
    expect(received).toEqual([1327]);
    expect(yieldToEventLoop).toHaveBeenCalledTimes(1);
  });
});
