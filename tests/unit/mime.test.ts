import { describe, expect, it } from "vitest";
import { normalizeMimeType, servingPolicy } from "@/lib/mime";

describe("normalizeMimeType", () => {
  it("normalise casse et parametres", () => {
    expect(normalizeMimeType("Text/Plain; charset=latin1")).toBe("text/plain");
    expect(normalizeMimeType("image/svg+xml")).toBe("image/svg+xml");
  });

  it("refuse les valeurs invalides", () => {
    for (const bad of [null, "", "html", "<script>/x", "a/b/c", `a/${"b".repeat(200)}`]) {
      expect(normalizeMimeType(bad)).toBeNull();
    }
  });
});

describe("servingPolicy", () => {
  it.each([
    ["video/mp4", "video/mp4", false],
    ["audio/mpeg", "audio/mpeg", false],
    ["image/png", "image/png", false],
    ["application/pdf", "application/pdf", false],
    ["text/html", "text/plain; charset=utf-8", false],
    ["application/json", "text/plain; charset=utf-8", false],
    ["application/xhtml+xml", "text/plain; charset=utf-8", false],
    ["image/svg+xml", "image/svg+xml", true],
    ["application/x-msdownload", "application/octet-stream", true],
    [null, "application/octet-stream", true],
  ] as const)("%s -> %s (attachment force: %s)", (input, type, attach) => {
    expect(servingPolicy(input)).toEqual({ contentType: type, forceAttachment: attach });
  });

  it("n'expose jamais un type interpretable comme HTML", () => {
    for (const t of ["text/html", "application/xhtml+xml", "text/xml", "image/svg+xml"]) {
      const p = servingPolicy(t);
      expect(p.contentType === "text/plain; charset=utf-8" || p.forceAttachment).toBe(true);
    }
  });
});
