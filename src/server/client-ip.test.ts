import { describe, expect, it } from "vitest";
import { getClientIp } from "./client-ip";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/lives/stream", { method: "POST", headers });
}

describe("getClientIp (precedence: CF-Connecting-IP > X-Forwarded-For > \"unknown\")", () => {
  it("prefers CF-Connecting-IP when present", () => {
    const request = requestWithHeaders({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" });
    expect(getClientIp(request)).toBe("203.0.113.9");
  });

  it("falls back to the first X-Forwarded-For entry when CF-Connecting-IP is absent", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "198.51.100.1, 10.0.0.1, 10.0.0.2" });
    expect(getClientIp(request)).toBe("198.51.100.1");
  });

  it("trims whitespace around the first X-Forwarded-For entry", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "  198.51.100.7  , 10.0.0.1" });
    expect(getClientIp(request)).toBe("198.51.100.7");
  });

  it("falls back to \"unknown\" when neither header is present", () => {
    const request = requestWithHeaders({});
    expect(getClientIp(request)).toBe("unknown");
  });

  it("falls back to \"unknown\" when both headers are present but blank", () => {
    const request = requestWithHeaders({ "cf-connecting-ip": "   ", "x-forwarded-for": "   " });
    expect(getClientIp(request)).toBe("unknown");
  });

  it("ignores a blank CF-Connecting-IP and uses X-Forwarded-For instead", () => {
    const request = requestWithHeaders({ "cf-connecting-ip": "", "x-forwarded-for": "192.0.2.5" });
    expect(getClientIp(request)).toBe("192.0.2.5");
  });
});
