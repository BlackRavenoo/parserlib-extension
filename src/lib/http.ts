export class RequestsBlockedByRateLimit extends Error {
  constructor(url: string) {
    super(`HTTP 429 получен для ${url}. Ретраи исчерпаны.`);
    this.name = "RequestsBlockedByRateLimit";
  }
}

export interface RateProfile {
  requestsPerMinute: number;
  rateLimitRetries: number;
  rateLimitRetryDelaySeconds: number;
}

export interface HttpClientConfig {
  anonymous: RateProfile;
  authenticated: RateProfile;
  serverRetries: number;
  serverRetryDelaySeconds: number;
}

class RateLimiter {
  private capacity: number;
  private refillPerMs: number;
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    limit: number,
    private readonly intervalMs: number
  ) {
    this.capacity = limit;
    this.refillPerMs = limit / intervalMs;
    this.tokens = limit;
    this.lastRefill = Date.now();
  }

  setLimit(limit: number): void {
    this.capacity = limit;
    this.refillPerMs = limit / this.intervalMs;
    this._refill();
    this.tokens = Math.min(this.tokens, limit);
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length > 0) this._schedule();
  }

  private _refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.lastRefill) * this.refillPerMs);
    this.lastRefill = now;
  }

  acquire(): Promise<void> {
    this._refill();
    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
      if (this.timer === null) this._schedule();
    });
  }

  private _schedule(): void {
    const waitMs = Math.max(Math.ceil((1 - this.tokens) / this.refillPerMs), 1);
    this.timer = setTimeout(() => {
      this.timer = null;
      this._pump();
    }, waitMs);
  }

  private _pump(): void {
    this._refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length > 0) this._schedule();
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

export class HttpClient {
  private readonly limiter: RateLimiter;
  private authToken: string | null = null;

  constructor(private readonly config: HttpClientConfig) {
    this.limiter = new RateLimiter(config.anonymous.requestsPerMinute, 60_000);
  }

  private get profile(): RateProfile {
    return this.authToken ? this.config.authenticated : this.config.anonymous;
  }

  setAuth(token: string | null): void {
    this.authToken = token;
    this.limiter.setLimit(this.profile.requestsPerMinute);
  }

  private headersForRequest(headers: Record<string, string>): Record<string, string> {
    if (!this.authToken) return headers;
    return { ...headers, Authorization: `Bearer ${this.authToken}` };
  }

  async requestBytes(url: string, headers: Record<string, string>): Promise<Uint8Array> {
    return (await this.requestBinary(url, headers)).data;
  }

  async requestBinary(
    url: string,
    headers: Record<string, string>
  ): Promise<{ data: Uint8Array; mime: string }> {
    const profile = this.profile;

    let serverRetries = 0;
    let throttleRetries = 0;

    for (;;) {
      await this.limiter.acquire();

      let res: Response;
      try {
        res = await fetch(url, { headers: this.headersForRequest(headers) });
      } catch {
        if (serverRetries >= this.config.serverRetries) {
          throw new Error(`Сеть недоступна: ${url}`);
        }
        serverRetries++;
        await sleep(this.config.serverRetryDelaySeconds * 1000 * serverRetries);
        continue;
      }

      if (res.status === 429) {
        if (throttleRetries >= profile.rateLimitRetries) {
          throw new RequestsBlockedByRateLimit(url);
        }
        throttleRetries++;
        await sleep(
          retryAfterMs(res) ?? profile.rateLimitRetryDelaySeconds * 1000 * throttleRetries
        );
        continue;
      }

      if (res.status === 403) {
        if (throttleRetries >= profile.rateLimitRetries) {
          throw new Error("CDN не пропускает запросы (403). Попробуй позже — подожди несколько минут.");
        }
        throttleRetries++;
        await sleep(profile.rateLimitRetryDelaySeconds * 1000 * throttleRetries);
        continue;
      }

      if (res.status >= 500) {
        if (serverRetries >= this.config.serverRetries) {
          throw new Error(`Запрос провалился со статусом ${res.status}: ${url}`);
        }
        serverRetries++;
        await sleep(this.config.serverRetryDelaySeconds * 1000 * serverRetries);
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
