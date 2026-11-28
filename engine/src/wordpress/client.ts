export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

/** Minimal read-only WordPress REST client with pagination. */
export class WpClient {
  constructor(
    private baseUrl: string,
    private fetchFn: FetchFn = (url) => fetch(url, { headers: { accept: "application/json" } }),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  url(path: string, params: Record<string, string | number | undefined> = {}): string {
    const u = new URL(`${this.baseUrl}/wp-json/wp/v2/${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    // ruralgreece.gr sits behind a page cache (Varnish) that keeps REST responses for up to a week,
    // so list queries came back stale. A unique query value makes every read go to WordPress.
    u.searchParams.set("_rve", Date.now().toString(36));
    return u.toString();
  }

  async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<{ body: T; totalPages: number }> {
    const res = await this.fetchFn(this.url(path, params));
    if (!res.ok) throw new Error(`WordPress ${path} returned HTTP ${res.status}`);
    return { body: (await res.json()) as T, totalPages: Number(res.headers.get("x-wp-totalpages") ?? 1) || 1 };
  }

  /** Fetch every page of a collection. */
  async *all<T>(path: string, params: Record<string, string | number | undefined> = {}): AsyncGenerator<T> {
    for (let page = 1; ; page++) {
      const { body, totalPages } = await this.get<T[]>(path, { per_page: 100, ...params, page });
      for (const item of body) yield item;
      if (page >= totalPages || body.length === 0) return;
    }
  }
}
