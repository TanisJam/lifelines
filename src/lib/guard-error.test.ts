import { describe, expect, it } from "vitest";
import { en } from "@/i18n/dictionaries/en";
import { guardErrorMessage, resolveGuardedResponseError, SimulationGuardError } from "./guard-error";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("resolveGuardedResponseError", () => {
  it("recognizes a 429 rate_limited body as a SimulationGuardError carrying retryAfterSeconds", async () => {
    const error = await resolveGuardedResponseError(jsonResponse({ error: "rate_limited", retryAfterSeconds: 42 }, 429));
    expect(error).toBeInstanceOf(SimulationGuardError);
    const guardError = error as SimulationGuardError;
    expect(guardError.code).toBe("rate_limited");
    expect(guardError.retryAfterSeconds).toBe(42);
  });

  it("recognizes a 403 verification_failed body as a SimulationGuardError", async () => {
    const error = await resolveGuardedResponseError(jsonResponse({ error: "verification_failed" }, 403));
    expect(error).toBeInstanceOf(SimulationGuardError);
    expect((error as SimulationGuardError).code).toBe("verification_failed");
  });

  it("falls back to a plain Error for an unrelated failure", async () => {
    const error = await resolveGuardedResponseError(jsonResponse({ error: "Life not found." }, 404));
    expect(error).not.toBeInstanceOf(SimulationGuardError);
    expect(error.message).toBe("Life not found.");
  });

  it("falls back to a generic message when the body isn't JSON", async () => {
    const res = new Response("not json", { status: 500 });
    const error = await resolveGuardedResponseError(res);
    expect(error).not.toBeInstanceOf(SimulationGuardError);
    expect(error.message).toBe("Request failed (500)");
  });
});

describe("guardErrorMessage", () => {
  it("localizes a rate_limited error using dict.guard.rateLimited, with a minutes label for a long retry", () => {
    const message = guardErrorMessage(new SimulationGuardError("rate_limited", 125), en, "fallback");
    expect(message).toBe(en.guard.rateLimited(en.guard.retryMinutes(3)));
  });

  it("uses a seconds label for a short retry", () => {
    const message = guardErrorMessage(new SimulationGuardError("rate_limited", 10), en, "fallback");
    expect(message).toBe(en.guard.rateLimited(en.guard.retrySeconds(10)));
  });

  it("localizes a verification_failed error using dict.guard.verificationFailed", () => {
    const message = guardErrorMessage(new SimulationGuardError("verification_failed", undefined), en, "fallback");
    expect(message).toBe(en.guard.verificationFailed);
  });

  it("falls back to the plain Error message for an unrelated error", () => {
    expect(guardErrorMessage(new Error("boom"), en, "fallback")).toBe("boom");
  });

  it("falls back to the fallback string for a non-Error value", () => {
    expect(guardErrorMessage("not an error", en, "fallback")).toBe("fallback");
  });
});
