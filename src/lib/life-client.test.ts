import { describe, expect, it, vi } from "vitest";
import { getChronicle, getPersonSheet, parseLifeStreamFrame } from "./life-client";

describe("parseLifeStreamFrame", () => {
  it("parses a tick frame with an event: line and a data: line", () => {
    const frame = 'event: tick\ndata: {"type":"tick","year":1504,"entries":[]}';
    expect(parseLifeStreamFrame(frame)).toEqual({ type: "tick", year: 1504, entries: [] });
  });

  it("parses a frame with only a data: line, since type lives in the payload", () => {
    const frame = 'data: {"type":"start","lifeId":"life-1","branchId":"branch-original","villageName":"Hallowmere","protagonist":{"name":"Elin Marrow","sex":"f","birthYear":1490}}';
    const parsed = parseLifeStreamFrame(frame);
    expect(parsed).toMatchObject({ type: "start", lifeId: "life-1" });
  });

  it("reassembles a data: payload split across multiple lines", () => {
    const frame = 'event: done\ndata: {"type":"done",\ndata: "chronicle":null,"stats":{"jevCalls":1,"cacheHits":0,"wallTimeMs":10}}';
    expect(parseLifeStreamFrame(frame)).toEqual({ type: "done", chronicle: null, stats: { jevCalls: 1, cacheHits: 0, wallTimeMs: 10 } });
  });

  it("returns null for a frame with no data: line", () => {
    expect(parseLifeStreamFrame("event: tick")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseLifeStreamFrame("data: {not json")).toBeNull();
  });

  it("returns null when the payload has no type field", () => {
    expect(parseLifeStreamFrame('data: {"year":1504}')).toBeNull();
  });

  it("parses an error frame", () => {
    const frame = 'event: error\ndata: {"type":"error","message":"That life could not be found."}';
    expect(parseLifeStreamFrame(frame)).toEqual({ type: "error", message: "That life could not be found." });
  });
});


it("maps the page branch value to branchId on chronicle and person requests", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
  try {
    const pageBranch = new URLSearchParams("branch=child%2Fone").get("branch") ?? undefined;
    await getChronicle("life 1", pageBranch, "es");
    await getPersonSheet("life 1", "person 1", pageBranch, "es");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/lives/life%201?branchId=child%2Fone&lang=es",
      "/api/lives/life%201/people/person%201?branchId=child%2Fone&lang=es",
    ]);
    await getChronicle("life 1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/lives/life%201");
  } finally { fetchMock.mockRestore(); }
});
