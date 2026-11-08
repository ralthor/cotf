export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ImportError extends Error {
  readonly kind: 'network' | 'not-found' | 'rate-limited' | 'http' | 'invalid-input' | 'invalid-data' | 'unsupported';
  readonly status?: number;
  constructor(kind: ImportError['kind'], message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

type CacheEntry = { etag?: string; lastModified?: string; body: string; fetchedAt: number };

export type HttpClientOptions = {
  fetch?: FetchLike;
  /** Back-off after HTTP 429, in ms. Lichess asks for at least 60 s. */
  rateLimitBackoffMs: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between requests to the same provider. */
  minIntervalMs?: number;
  /**
   * Send If-None-Match / If-Modified-Since ourselves. Off by default in browsers: these are not
   * CORS-safelisted headers (Lichess's preflight rejects If-None-Match) and the browser's HTTP
   * cache already revalidates with ETag/Last-Modified transparently.
   */
  manualConditional?: boolean;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Per-provider HTTP client: one request at a time, conditional requests (ETag /
 * Last-Modified → 304 reuse), and back-off with retry on 429.
 * Browsers do not allow setting User-Agent; we don't try.
 */
export class ProviderHttpClient {
  private queue: Promise<unknown> = Promise.resolve();
  private cache = new Map<string, CacheEntry>();
  private lastRequestAt = 0;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly provider: string,
    private readonly opts: HttpClientOptions,
  ) {
    this.fetchImpl = opts.fetch ?? ((i, init) => globalThis.fetch(i, init));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Serialised GET returning the body text. */
  getText(url: string, accept: string, signal?: AbortSignal): Promise<string> {
    const run = this.queue.then(
      () => this.doGet(url, accept, signal),
      () => this.doGet(url, accept, signal),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Serialised GET that hands the raw Response to `consume` (for streaming bodies). */
  stream<T>(url: string, accept: string, consume: (r: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const run = this.queue.then(async () => consume(await this.request(url, accept, signal, false)));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doGet(url: string, accept: string, signal?: AbortSignal): Promise<string> {
    const res = await this.request(url, accept, signal, true);
    if (res.status === 304) {
      const cached = this.cache.get(url);
      if (cached) return cached.body;
    }
    const body = await res.text();
    this.cache.set(url, {
      etag: res.headers.get('ETag') ?? undefined,
      lastModified: res.headers.get('Last-Modified') ?? undefined,
      body,
      fetchedAt: Date.now(),
    });
    return body;
  }

  private async request(url: string, accept: string, signal: AbortSignal | undefined, conditional: boolean): Promise<Response> {
    const maxRetries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const gap = (this.opts.minIntervalMs ?? 0) - (Date.now() - this.lastRequestAt);
      if (gap > 0) await this.sleep(gap);
      const headers: Record<string, string> = { Accept: accept };
      const cached = conditional && this.opts.manualConditional ? this.cache.get(url) : undefined;
      if (cached?.etag) headers['If-None-Match'] = cached.etag;
      if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
      let res: Response;
      try {
        this.lastRequestAt = Date.now();
        res = await this.fetchImpl(url, { headers, signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new ImportError(
          'network',
          `Could not reach ${this.provider}. This may be a network problem or the browser blocked the cross-origin request (CORS). You can still paste or upload a PGN.`,
        );
      }
      if (res.status === 429) {
        if (attempt >= maxRetries) {
          throw new ImportError('rate-limited', `${this.provider} is rate-limiting requests. Try again in a minute.`, 429);
        }
        await this.sleep(this.opts.rateLimitBackoffMs * (attempt + 1));
        continue;
      }
      if (res.status === 304) return res;
      if (res.status === 404 || res.status === 410) {
        throw new ImportError('not-found', `${this.provider}: not found (${res.status}).`, res.status);
      }
      if (!res.ok) {
        if (res.status >= 500 && attempt < maxRetries) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ImportError('http', `${this.provider} responded with HTTP ${res.status}.`, res.status);
      }
      return res;
    }
  }
}

/** Parses an NDJSON body as a stream, yielding one object per line (tolerates a partial last line). */
export async function* readNdjson(res: Response, signal?: AbortSignal): AsyncGenerator<unknown> {
  if (!res.body) {
    for (const line of (await res.text()).split('\n')) {
      const t = line.trim();
      if (t) yield JSON.parse(t);
    }
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line);
      }
    }
    buffer += decoder.decode();
    const rest = buffer.trim();
    if (rest) {
      try {
        yield JSON.parse(rest);
      } catch {
        // Truncated final line: ignore rather than fail the whole import.
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
