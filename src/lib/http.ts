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
