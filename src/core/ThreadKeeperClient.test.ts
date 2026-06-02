import { describe, it, expect, vi } from "vitest";
import { ThreadKeeperClient } from "./ThreadKeeperClient.js";

describe("ThreadKeeperClient", () => {
  it("fetches and returns the threads array from /api/v1/threads", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, projectKey: "pt", title: "t", status: "ACTIVE", priority: "HIGH" }],
    });
    const client = new ThreadKeeperClient("http://localhost:8080", 2000, fetchFn as unknown as typeof fetch);
    const threads = await client.fetchAllThreads();
    expect(threads).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/threads",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
    const client = new ThreadKeeperClient("http://localhost:8080/", 2000, fetchFn as unknown as typeof fetch);
    await client.fetchAllThreads();
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/threads",
      expect.anything(),
    );
  });

  it("throws on a non-2xx response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const client = new ThreadKeeperClient("http://localhost:8080", 2000, fetchFn as unknown as typeof fetch);
    await expect(client.fetchAllThreads()).rejects.toThrow("503");
  });

  it("throws when fetch rejects (connection refused)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ThreadKeeperClient("http://localhost:8080", 2000, fetchFn as unknown as typeof fetch);
    await expect(client.fetchAllThreads()).rejects.toThrow();
  });
});
