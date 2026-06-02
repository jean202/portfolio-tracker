import { describe, it, expect } from "vitest";
import { resolveProjectKey } from "./threadScoring.js";

describe("resolveProjectKey", () => {
  it("defaults to the project directory name", () => {
    expect(
      resolveProjectKey({ name: "threadkeeper", path: "/Users/x/projects/threadkeeper" }),
    ).toBe("threadkeeper");
  });

  it("prefers an override keyed by path", () => {
    expect(
      resolveProjectKey(
        { name: "tk", path: "/Users/x/projects/tk" },
        { "/Users/x/projects/tk": "threadkeeper" },
      ),
    ).toBe("threadkeeper");
  });

  it("falls back to an override keyed by name when path has no override", () => {
    expect(
      resolveProjectKey({ name: "tk", path: "/abs/tk" }, { tk: "threadkeeper" }),
    ).toBe("threadkeeper");
  });
});
