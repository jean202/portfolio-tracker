import type { RawThread } from "./ProjectModel.js";

export class ThreadKeeperClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 2000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async fetchAllThreads(): Promise<RawThread[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/threads`;
      const res = await this.fetchFn(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`ThreadKeeper responded with ${res.status}`);
      }
      return (await res.json()) as RawThread[];
    } finally {
      clearTimeout(timer);
    }
  }
}
