export class RequestsBlockedByRateLimit extends Error {
  constructor(url: string) {
    super(`HTTP 429 получен для ${url}. Ретраи исчерпаны.`);
    this.name = "RequestsBlockedByRateLimit";
  }
}

class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private limit: number,
    private readonly intervalMs: number
  ) {}

  setLimit(limit: number): void {
    this.limit = limit;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const cutoff = now - this.intervalMs;
      this.timestamps = this.timestamps.filter((t) => t > cutoff);

      if (this.timestamps.length < this.limit) {
        this.timestamps.push(now);
        return;
      }

      const oldest = this.timestamps[0]!;
      await sleep(Math.max(oldest + this.intervalMs - now, 2));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, 120_000);
}

export interface HttpClientOptions {
  headers: Record<string, string>;
  anonymousRequestsPerMinute?: number;
  authenticatedRequestsPerMinute?: number;
  retries?: number;
  retryDelaySeconds?: number;
  anonymousRateLimitRetries?: number;
  authenticatedRateLimitRetries?: number;
  rateLimitRetryDelaySeconds?: number;
}

export class HttpClient {
  private readonly limiter: RateLimiter;
  private readonly retries: number;
  private readonly retryDelaySeconds: number;
  private readonly rateLimitRetryDelaySeconds: number;
  private readonly anonymousRateLimitRetries: number;
  private readonly authenticatedRateLimitRetries: number;
  private readonly anonymousLimit: number;
  private readonly authenticatedLimit: number;
  private authToken: string | null = null;

  constructor(
    private readonly headers: Record<string, string>,
    options: Omit<HttpClientOptions, "headers"> = {}
  ) {
    this.anonymousLimit = options.anonymousRequestsPerMinute ?? 90;
    this.authenticatedLimit = options.authenticatedRequestsPerMinute ?? 600;
    this.limiter = new RateLimiter(this.anonymousLimit, 60_000);
    this.retries = options.retries ?? 3;
    this.retryDelaySeconds = options.retryDelaySeconds ?? 1.0;
    this.rateLimitRetryDelaySeconds = options.rateLimitRetryDelaySeconds ?? 5.0;
    this.anonymousRateLimitRetries = options.anonymousRateLimitRetries ?? 2;
    this.authenticatedRateLimitRetries = options.authenticatedRateLimitRetries ?? 8;
  }

  setAuth(token: string | null): void {
    this.authToken = token;
    this.limiter.setLimit(token ? this.authenticatedLimit : this.anonymousLimit);
  }

  private headersForRequest(): Record<string, string> {
    if (!this.authToken) return this.headers;
    return { ...this.headers, Authorization: `Bearer ${this.authToken}` };
  }

  async requestBytes(url: string): Promise<Uint8Array> {
    return (await this.requestBinary(url)).data;
  }

  async requestBinary(url: string): Promise<{ data: Uint8Array; mime: string }> {
    let serverRetries = 0;
    let rateLimitRetries = 0;
    const maxRateLimitRetries = this.authToken
      ? this.authenticatedRateLimitRetries
      : this.anonymousRateLimitRetries;

    for (;;) {
      await this.limiter.acquire();

      let res: Response;
      try {
        res = await fetch(url, { headers: this.headersForRequest() });
      } catch {
        if (serverRetries >= this.retries) throw new Error(`Сеть недоступна: ${url}`);
        serverRetries++;
        await sleep(this.retryDelaySeconds * 1000 * serverRetries);
        continue;
      }

      if (res.status === 429) {
        if (rateLimitRetries >= maxRateLimitRetries) {
          throw new RequestsBlockedByRateLimit(url);
        }
        rateLimitRetries++;
        await sleep(retryAfterMs(res) ?? this.rateLimitRetryDelaySeconds * 1000 * rateLimitRetries);
        continue;
      }

      if (res.status >= 500) {
        if (serverRetries >= this.retries) {
          throw new Error(`Запрос провалился со статусом ${res.status}: ${url}`);
        }
        serverRetries++;
        await sleep(this.retryDelaySeconds * 1000 * serverRetries);
        continue;
      }

      if (res.status === 403) {
        if (rateLimitRetries >= maxRateLimitRetries) {
          throw new Error(
            `CDN не пропускает запросы (403). Попробуй позже — подожди несколько минут.`
          );
        }
        rateLimitRetries++;
        await sleep(this.rateLimitRetryDelaySeconds * 1000 * rateLimitRetries);
        continue;
      }

      if (res.status >= 400) {
        throw new Error(`Запрос провалился со статусом ${res.status}: ${url}`);
      }

      return {
        data: new Uint8Array(await res.arrayBuffer()),
        mime: res.headers.get("content-type") ?? "image/jpeg",
      };
    }
  }
}
